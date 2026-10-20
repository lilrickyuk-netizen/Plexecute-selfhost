/**
 * Proactive Coach prompts from the saved plan (runs each reminders tick). Handles the "start"
 * stage for plan entries and both stages for fixed commitments (meals, appointments, family,
 * journeys). The "prepare" stage for plan entries and the missed/not-started check-in stay in
 * the intervention engine path in cron.reminders, worded via push-plan.ts — one schedule per item.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { enqueueNotification } from "./notify.server";
import {
  STAGES,
  START_WINDOW_MIN,
  kindAllowed,
  prepareLeadMin,
  pushCopy,
  pushKindForBlock,
  pushKindForCommitment,
  pushLink,
  type PushKind,
  type PushStage,
} from "./push-plan";
import { isoDowOfKey, localDayKey, localHm, zonedInstant } from "./tz";

type Db = SupabaseClient<Database>;
type Prof = {
  id: string;
  timezone: string | null;
  reminders_enabled: boolean | null;
  reminder_lead_min: number | null;
  accountability_level: string | null;
  push_muted_kinds: string[] | null;
  push_motivating: boolean | null;
  coaching_style: string | null;
};

export function toneFor(
  p: Pick<Prof, "push_motivating" | "coaching_style">,
): "calm" | "motivating" {
  return p.push_motivating !== false &&
    ["supportive", "disciplined", "competitive"].includes(String(p.coaching_style ?? ""))
    ? "motivating"
    : "calm";
}
export function promptsOn(p: Pick<Prof, "reminders_enabled" | "accountability_level">): boolean {
  return p.reminders_enabled !== false && p.accountability_level !== "off";
}

/** Which stage (if any) is due now for an item starting at `start`. */
export function dueStage(
  kind: PushKind,
  start: Date,
  now: Date,
  memberLead: number,
): PushStage | null {
  const t = now.getTime(),
    s = start.getTime();
  if (STAGES[kind].start && t >= s && t < s + START_WINDOW_MIN * 60000) return "start";
  if (STAGES[kind].prepare) {
    const lead = prepareLeadMin(kind, memberLead);
    if (t >= s - lead * 60000 && t < s) return "prepare";
  }
  return null;
}

/**
 * Exact-time scheduling: every stage whose target instant falls before `now + lookaheadMs` and
 * whose window hasn't closed, with the instant it should go out (never earlier than its target).
 * Stages are queued ahead with that instant, so delivery doesn't wait for a later scan.
 */
export function stagesToQueue(
  kind: PushKind,
  start: Date,
  now: Date,
  memberLead: number,
  lookaheadMs: number,
): Array<{ stage: PushStage; sendAt: Date }> {
  const t = now.getTime(),
    s = start.getTime();
  const out: Array<{ stage: PushStage; sendAt: Date }> = [];
  if (STAGES[kind].prepare) {
    const target = s - prepareLeadMin(kind, memberLead) * 60000;
    if (t < s && target <= t + lookaheadMs)
      out.push({ stage: "prepare", sendAt: new Date(Math.max(target, t)) });
  }
  if (STAGES[kind].start && t < s + START_WINDOW_MIN * 60000 && s <= t + lookaheadMs)
    out.push({ stage: "start", sendAt: new Date(Math.max(s, t)) });
  return out;
}

/** How far ahead each run queues prompts at their exact time. Runs are every minute. */
export const PROMPT_LOOKAHEAD_MS = 3 * 60000;

export async function queuePlanPrompts(
  db: Db,
  now = new Date(),
  lookaheadMs = PROMPT_LOOKAHEAD_MS,
) {
  const out = { start: 0, commitments: 0 };
  const { data: blocks } = await db
    .from("plan_blocks")
    .select("id,user_id,title,starts_at,status,occurrence_kind,source_type")
    .in("status", ["planned", "scheduled", "upcoming", "due", "snoozed"])
    .gte("starts_at", new Date(now.getTime() - START_WINDOW_MIN * 60000).toISOString())
    .lte("starts_at", new Date(now.getTime() + lookaheadMs).toISOString())
    .limit(2000);
  const { data: comms } = await db
    .from("commitments")
    .select("id,user_id,title,kind,recurrence,days,on_date,start_time,note,active")
    .eq("active", true)
    .not("start_time", "is", null)
    .limit(5000);
  const users = [...new Set([...(blocks ?? []), ...(comms ?? [])].map((r) => r.user_id))];
  if (!users.length) return out;
  const { data: profs } = await db
    .from("profiles")
    .select(
      "id,timezone,reminders_enabled,reminder_lead_min,accountability_level,push_muted_kinds,push_motivating,coaching_style",
    )
    .in("id", users);
  const byId = new Map((profs ?? []).map((p) => [p.id, p as Prof]));

  for (const b of blocks ?? []) {
    const p = byId.get(b.user_id);
    if (!p || !promptsOn(p)) continue;
    const kind = pushKindForBlock(b);
    if (!kindAllowed(kind, p.push_muted_kinds)) continue;
    const start = new Date(b.starts_at);
    const st = stagesToQueue(kind, start, now, p.reminder_lead_min ?? 10, lookaheadMs).find(
      (x) => x.stage === "start",
    );
    if (!st) continue;
    const time = localHm(start, p.timezone);
    const c = pushCopy(kind, "start", { title: b.title, time, minutes: 0 }, toneFor(p));
    const made = await enqueueNotification(db, {
      userId: b.user_id,
      category: "DUE",
      intent: `start_${kind}`,
      kind: "reminder",
      title: c.title,
      body: c.body,
      link: pushLink(kind, { blockId: b.id }),
      blockId: b.id,
      dedupe: ["start", b.id, b.starts_at],
      ref: { t: "block", id: b.id, at: b.starts_at },
      now,
      sendAt: st.sendAt,
    });
    if (made.length) out.start++;
  }

  for (const cm of comms ?? []) {
    const p = byId.get(cm.user_id);
    if (!p || !promptsOn(p) || !cm.start_time) continue;
    const kind = pushKindForCommitment(cm);
    if (!kindAllowed(kind, p.push_muted_kinds)) continue;
    const hm = String(cm.start_time).slice(0, 5);
    const [h, m] = hm.split(":").map(Number);
    // Today and tomorrow (local) cover a long lead that crosses midnight.
    for (const offset of [0, 1]) {
      const key = localDayKey(new Date(now.getTime() + offset * 864e5), p.timezone);
      const occurs =
        cm.recurrence === "weekly"
          ? (cm.days ?? []).includes(isoDowOfKey(key))
          : cm.on_date === key;
      if (!occurs) continue;
      const start = zonedInstant(key, h! * 60 + m!, p.timezone);
      for (const { stage, sendAt } of stagesToQueue(
        kind,
        start,
        now,
        p.reminder_lead_min ?? 10,
        lookaheadMs,
      )) {
        const minutes = Math.max(1, Math.round((start.getTime() - sendAt.getTime()) / 60000));
        const c = pushCopy(kind, stage, { title: cm.title, time: hm, minutes }, toneFor(p));
        const at = start.toISOString();
        const made = await enqueueNotification(db, {
          userId: cm.user_id,
          category: stage === "start" ? "DUE" : "UPCOMING",
          intent: `${stage}_${kind}`,
          kind: "reminder",
          title: c.title,
          body: c.body,
          link: pushLink(kind, { commitmentId: cm.id }),
          // One schedule per occurrence: a stage is sent once per item and instant.
          dedupe: [stage, "c", cm.id, at],
          ref: { t: "commitment", id: cm.id, at, hm },
          now,
          sendAt,
        });
        if (made.length) out.commitments++;
      }
    }
  }
  return out;
}
