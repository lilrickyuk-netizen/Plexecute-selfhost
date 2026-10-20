// "I have too much to do tonight": deterministic triage over the member's real evening. Reads tonight's open plan
// entries, fixed commitments/calendar busy time and goal priorities/deadlines, keeps what fits the actual free
// minutes (highest priority first), moves the rest to tomorrow (status "rescheduled" + new entry + event, never
// deleted) and returns the first action. Writes go server-side scoped to this member (members' clients may not
// change plan status). Material moves need the member's own instruction; otherwise it only previews.
import { canTransition } from "./execution";
import { addDaysKey, diffDaysKey, isoDowOfKey, localDayKey, zonedInstant, zonedParts } from "./tz";
import { rankScore, triageEvening, type TriageItem } from "./evening-triage";

type Ctx = {
  db: any;
  userId: string;
  tz: string | null;
  messageId?: string;
  memberText?: string | null;
};

const OPEN = ["planned", "scheduled", "upcoming", "due", "snoozed"];
const hm = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
export const OVERLOAD_RE =
  /\b(too much (to do|on)|overwhelm\w*|sort (it|this|my (evening|night|day)|tonight) out|reorgani[sz]e|can't fit|cannot fit|swamped|snowed under)\b/i;

export async function triageTonight(ctx: Ctx, a: Record<string, unknown>) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sys = supabaseAdmin as any;
  const now = new Date();
  const today = localDayKey(now, ctx.tz);
  const nowMin = Math.ceil(zonedParts(now, ctx.tz).minutes / 5) * 5;
  const endMin = Math.min(
    1435,
    Math.max(nowMin + 30, Number(a["end_minutes"] ?? 0) || 22 * 60 + 30),
  );
  const startMin = Math.max(nowMin, Number(a["start_minutes"] ?? 0) || 0);

  const [{ data: blocks }, commits, { data: goals }, { data: missions }] = await Promise.all([
    sys
      .from("plan_blocks")
      .select(
        "id,title,starts_at,duration_min,status,goal_id,is_protected,occurrence_kind,source_type,source_ref,evidence_detail,note",
      )
      .eq("user_id", ctx.userId)
      .in("status", OPEN)
      .gte("starts_at", zonedInstant(today, 0, ctx.tz).toISOString())
      .lt("starts_at", zonedInstant(today, 1440, ctx.tz).toISOString())
      .order("starts_at")
      .limit(60),
    (await import("./planning.functions")).loadCommitments(ctx.db, ctx.userId).catch(() => []),
    sys
      .from("goals")
      .select("id,title,priority,deadline,status")
      .eq("user_id", ctx.userId)
      .eq("status", "active"),
    sys.from("goal_missions").select("goal_id,state").eq("user_id", ctx.userId),
  ]);
  const { commitmentBusy } = await import("./scheduler");
  const busy = commitmentBusy(commits as never, isoDowOfKey(today), today);
  const gmap = new Map(((goals ?? []) as any[]).map((g) => [g.id, g]));
  const missionGoals = new Set(
    ((missions ?? []) as any[]).filter((m) => m.goal_id).map((m) => m.goal_id),
  );
  const items: TriageItem[] = ((blocks ?? []) as any[])
    .filter((b) => {
      // Tonight = anything still open this evening, including earlier unstarted items still due today.
      return zonedParts(new Date(b.starts_at), ctx.tz).minutes < endMin;
    })
    .map((b) => {
      const g = b.goal_id ? gmap.get(b.goal_id) : null;
      return {
        id: b.id,
        title: b.title,
        start: zonedParts(new Date(b.starts_at), ctx.tz).minutes,
        minutes: b.duration_min ?? 30,
        isProtected: !!b.is_protected && b.source_type !== "manual",
        goalPriority: g?.priority ?? null,
        deadlineDays: g?.deadline
          ? Math.max(0, diffDaysKey(String(g.deadline).slice(0, 10), today))
          : null,
        onMission: !!(b.goal_id && missionGoals.has(b.goal_id)),
        kind: b.occurrence_kind ?? "session",
      };
    });
  const plan = triageEvening(items, { startMin, endMin, busy });
  const instructed = OVERLOAD_RE.test(String(ctx.memberText ?? "")) || a["apply"] === true;
  const summary = {
    window: `${hm(startMin)}–${hm(endMin)}`,
    free_minutes: plan.freeMinutes,
    planned_minutes: plan.plannedMinutes,
    fixed_commitments: busy
      .filter(([s, e]) => e > startMin && s < endMin)
      .map(([s, e]) => `${hm(Math.max(0, s))}–${hm(Math.min(1439, e))}`),
    existing: items.map((i) => ({ title: i.title, time: hm(i.start), minutes: i.minutes })),
    keep: plan.keep.map((k) => ({
      title: k.title,
      time: hm(k.newStart),
      minutes: k.minutes,
      why: k.reason,
    })),
    move_to_tomorrow: plan.move.map((m) => ({ title: m.title, minutes: m.minutes, why: m.reason })),
    first_action: plan.keep[0] ? `${plan.keep[0].title} at ${hm(plan.keep[0].newStart)}` : null,
    basis: [
      "MEMBER_FACT: tonight's saved plan entries, commitments and calendar busy time",
      "USER_PREFERENCE/MEMBER_FACT: goal priority and deadlines",
      "DETERMINISTIC_PLANNING_RULE: keep by priority (protected, nearest deadline, goal priority, active mission) within real free minutes; nothing deleted",
    ],
  };
  if (!items.length)
    return {
      status: "NOTHING_PLANNED_TONIGHT",
      ...summary,
      next: "Nothing is saved for tonight. Ask what is due tonight (one question) or offer to queue it.",
    };
  if (!instructed) {
    // Already reorganised tonight: explain from the saved decision instead of re-planning the new state.
    const { data: ev } = await sys
      .from("plan_block_events")
      .select("metadata,created_at")
      .eq("user_id", ctx.userId)
      .eq("reason_code", "evening_overload")
      .gte("created_at", zonedInstant(today, 0, ctx.tz).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    const saved = (ev ?? [])[0] as any;
    if (saved?.metadata?.decision)
      return {
        status: "ALREADY_REORGANISED_TONIGHT",
        saved_decision: saved.metadata.decision,
        next: "Explain from saved_decision only (what stayed, what moved and why, free time, commitments, the planning rule vs any knowledge). Do not re-plan.",
      };
    return { status: "PREVIEW", ...summary, next: "Show this and ask whether to apply it." };
  }

  const tomorrow = addDaysKey(today, 1);
  const byId = new Map(((blocks ?? []) as any[]).map((b) => [b.id, b]));
  const moved: unknown[] = [];
  const retimed: unknown[] = [];
  let cursor = 9 * 60;
  // Tomorrow keeps the same priority order: deadline work first.
  for (const m of [...plan.move].sort((x, y) => rankScore(y) - rankScore(x))) {
    const b = byId.get(m.id);
    if (!b || !canTransition(b.status, "rescheduled")) continue;
    const newStart = zonedInstant(tomorrow, cursor, ctx.tz).toISOString();
    const { error } = await sys
      .from("plan_blocks")
      .update({ status: "rescheduled", note: `Moved to tomorrow ${hm(cursor)} (evening overload)` })
      .eq("id", b.id)
      .eq("user_id", ctx.userId);
    if (error) return { status: "PARTIAL_FAILURE", error: "could_not_move", ...summary, moved };
    const { data: copy } = await sys
      .from("plan_blocks")
      .insert({
        user_id: ctx.userId,
        title: b.title,
        starts_at: newStart,
        duration_min: b.duration_min,
        status: "planned",
        is_protected: b.is_protected,
        source_type: b.source_type,
        source_ref: `${b.source_ref ?? b.id}:moved:${tomorrow}`,
        occurrence_kind: b.occurrence_kind,
        goal_id: b.goal_id,
        evidence_detail: b.evidence_detail,
        note: `Moved from ${today} evening`,
      })
      .select("id")
      .single();
    await sys.from("plan_block_events").insert({
      user_id: ctx.userId,
      block_id: b.id,
      event_type: "rescheduled",
      from_status: b.status,
      to_status: "rescheduled",
      reason_code: "evening_overload",
      metadata: {
        moved_to: copy?.id ?? null,
        starts_at: newStart,
        rule: "evening_triage",
        decision: { ...summary, existing: undefined },
      },
    });
    moved.push({ title: b.title, day: tomorrow, time: hm(cursor) });
    cursor += (b.duration_min ?? 30) + 10;
  }
  for (const k of plan.keep) {
    if (k.newStart === k.start) continue;
    const { error } = await sys
      .from("plan_blocks")
      .update({ starts_at: zonedInstant(today, k.newStart, ctx.tz).toISOString() })
      .eq("id", k.id)
      .eq("user_id", ctx.userId);
    if (!error) retimed.push({ title: k.title, time: hm(k.newStart) });
  }
  return {
    status: "REORGANISED",
    ...summary,
    moved,
    retimed,
    next: "Say you checked what they already had tonight and reorganised it: free time, what stays (times), what moved to tomorrow, then start the first action now. Explain priorities in plain words; the keep-order is Plexecute's planning rule, not sourced evidence.",
  };
}
