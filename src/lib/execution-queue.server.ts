// Execution queue: Coach turns a stated intention ("all day today marketing my waitlist") into real, execution-ready
// plan_blocks the member works through, and records each outcome. Uses the member's own RLS client; the plan_blocks
// status trigger and src/lib/execution.ts validate every status change.
import { canTransition } from "./execution";
import { localDayKey, zonedInstant } from "./tz";

type Db = any;
type Ctx = {
  db: Db;
  userId: string;
  tz: string | null;
  messageId?: string;
  memberText?: string | null;
};

const LIVE = [
  "planned",
  "scheduled",
  "upcoming",
  "due",
  "contacting",
  "acknowledged",
  "started",
  "in_progress",
  "snoozed",
];
const VAGUE =
  /^(work on|do some|study|get fitter|marketing|business|practice|practise)\b\s*\w{0,12}$/i;

function parseHm(v: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]) * 60 + Number(m[2]);
  return n >= 0 && n < 1440 ? n : null;
}
const hm = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

function resolveDay(day: string, today: string): string | null {
  const d = day.trim().toLowerCase();
  if (!d || d === "today" || d === "now" || d === "tonight") return today;
  if (d === "tomorrow") {
    const x = new Date(`${today}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + 1);
    return x.toISOString().slice(0, 10);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export type QueueTask = {
  title: string;
  start_time?: string | null;
  minutes: number;
  destination?: string | null;
  link?: string | null;
  rule?: string | null;
  action: string;
  first_step?: string | null;
  prepared_copy?: string | null;
  done_when: string;
  record?: string | null;
};

/** Pure check: a task must say exactly what to do and when it counts as done. */
export function executionReadyIssues(t: Partial<QueueTask>): string[] {
  const out: string[] = [];
  if (!t.title || t.title.trim().length < 6 || VAGUE.test(t.title.trim()))
    out.push("title must name the exact task, not 'work on X'");
  if (!t.action || t.action.trim().length < 10) out.push("action must say exactly what to do");
  if (!t.done_when || t.done_when.trim().length < 4) out.push("done_when is required");
  if (t.link && !/^https:\/\/[^\s]+$/.test(t.link))
    out.push("link must be a real https URL or null");
  return out;
}

function noteFor(t: QueueTask) {
  return [
    t.destination && `Where: ${t.destination}`,
    t.link && `Link: ${t.link}`,
    t.rule && `Rule: ${t.rule}`,
    `Do: ${t.action}`,
    t.first_step && `First step: ${t.first_step}`,
    `Done when: ${t.done_when}`,
    t.record && `Record: ${t.record}`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1500);
}

export async function scheduleExecutionQueue(ctx: Ctx, a: Record<string, unknown>) {
  const today = localDayKey(new Date(), ctx.tz);
  const day = resolveDay(String(a["day"] ?? "today"), today);
  if (!day) return { error: "could_not_understand_day" };
  const tasks = (Array.isArray(a["tasks"]) ? a["tasks"] : []).slice(0, 24) as QueueTask[];
  if (!tasks.length) return { error: "no_tasks" };
  const goalId = a["goal_id"] ? String(a["goal_id"]) : null;
  if (goalId) {
    const { data: g } = await ctx.db.from("goals").select("id").eq("id", goalId).maybeSingle();
    if (!g) return { error: "goal_not_found" };
  }
  const missionId = await resolveMissionId(
    ctx,
    a["mission_id"] ? String(a["mission_id"]) : null,
    goalId,
  );
  await propagateMissionToGoal(ctx.userId, missionId).catch(() => null);
  const unsuitable = await unsuitableChannels(ctx, missionId);
  const domain = String(a["domain"] ?? "career").slice(0, 30);
  const kind =
    (
      {
        learning: "learning",
        training: "workout",
        career: "work_task",
        business: "work_task",
        finance: "personal_task",
      } as Record<string, string>
    )[domain] ?? "work_task";
  // Existing live entries that day, so the queue fits around real life instead of over it.
  const dayStart = zonedInstant(day, 0, ctx.tz);
  const dayEnd = zonedInstant(day, 24 * 60, ctx.tz);
  const { data: existing } = await ctx.db
    .from("plan_blocks")
    .select("id,title,starts_at,duration_min,source_ref,status")
    .eq("user_id", ctx.userId)
    .gte("starts_at", dayStart.toISOString())
    .lt("starts_at", dayEnd.toISOString())
    .in("status", LIVE);
  const { data: commits } = await ctx.db
    .from("commitments")
    .select("on_date,start_time,end_time,title,recurrence,days,active")
    .eq("user_id", ctx.userId)
    .eq("active", true)
    .limit(200);
  const isoDow = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
  const busy: [number, number, string][] = [];
  const minOf = (iso: string) => {
    const d = new Date(iso);
    const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: ctx.tz || "Europe/London",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(d)
      .split(":");
    return Number(p[0]) * 60 + Number(p[1]);
  };
  for (const b of existing ?? [])
    if (!String(b.source_ref ?? "").startsWith("queue:"))
      busy.push([minOf(b.starts_at), minOf(b.starts_at) + b.duration_min, b.title]);
  for (const c of (commits ?? []).filter(
    (c: any) => c.on_date === day || (c.recurrence !== "once" && (c.days ?? []).includes(isoDow)),
  )) {
    const s = parseHm(String(c.start_time ?? "").slice(0, 5));
    const e = parseHm(String(c.end_time ?? "").slice(0, 5));
    if (s != null) busy.push([s, e ?? s + 60, c.title]);
  }
  const nowMin = day === today ? minOf(new Date().toISOString()) + 2 : 0;
  const tonight =
    String(a["day"] ?? "")
      .trim()
      .toLowerCase() === "tonight" ||
    (/\btonight\b/i.test(String(ctx.memberText ?? "")) &&
      !/\b(now|right now)\b/i.test(String(ctx.memberText ?? "")));
  // A future day with no stated time starts at 09:00, never midnight.
  const dayDefault = day === today ? nowMin : 9 * 60;
  let cursor = Math.max(nowMin, parseHm(tasks[0]?.start_time) ?? (tonight ? 18 * 60 : dayDefault));
  const windowStart = cursor;
  // "All day" = the member's real working window (window_end, default 21:00), not a hidden workday.
  let windowEnd =
    parseHm(a["window_end"]) ?? (a["all_day"] === true ? 21 * 60 : tonight ? 22 * 60 : null);
  // A window that leaves under 30 minutes is a mis-stated end, not the member's real limit.
  if (windowEnd != null && windowEnd - cursor < 30) windowEnd = null;
  else if (windowEnd != null) windowEnd += 10; // small grace so a task starting a couple of minutes late still fits
  let sinceBreak = 0;
  const breaks: string[] = [];
  const MEALS: [number, number, string][] =
    a["all_day"] === true
      ? [
          [12 * 60 + 30, 13 * 60 + 15, "Lunch break"],
          [18 * 60, 18 * 60 + 45, "Dinner break"],
        ]
      : [];
  for (const m of MEALS) if (!busy.some(([s, e]) => m[0] < e && m[1] > s)) busy.push(m);
  const placed: Record<string, unknown>[] = [];
  const rejected: { title: string; issues: string[] }[] = [];
  const moved: string[] = [];
  const { isNearDuplicate } = await import("./task-dedupe");
  const { unmentionedEquipment } = await import("./equipment");
  const { memberHistory } = await import("./coach-actions.server");
  const history = await memberHistory(ctx).catch(() => String(ctx.memberText ?? ""));
  const { data: progEq } = await ctx.db
    .from("training_programmes")
    .select("equipment")
    .eq("user_id", ctx.userId)
    .eq("status", "active")
    .limit(1);
  const progEquipment = (progEq?.[0]?.equipment as string | undefined) ?? null;
  const accepted: QueueTask[] = [];
  for (const t of tasks) {
    const issues = executionReadyIssues(t);
    // One task per real action: a near-identical task in this batch is dropped, not added twice.
    const twin = accepted.find((x) => isNearDuplicate(x, t));
    if (twin) {
      rejected.push({
        title: String(t.title ?? ""),
        issues: [`near-duplicate of "${twin.title}" in this list; merged`],
      });
      continue;
    }
    const kit = unmentionedEquipment(
      `${t.title} ${t.action} ${t.first_step ?? ""} ${t.prepared_copy ?? ""}`,
      history,
      progEquipment,
    );
    if (kit.length)
      issues.push(
        `assumes ${kit.join(", ")} the member never said they have; use bodyweight or ask`,
      );
    const bad = t.destination ? unsuitable[normChannel(String(t.destination))] : null;
    if (bad)
      issues.push(`destination previously removed the post (${bad}); pick a different place`);
    if (issues.length) {
      rejected.push({ title: String(t.title ?? ""), issues });
      continue;
    }
    const mins = Math.min(Math.max(Math.round(Number(t.minutes) || 30), 5), 240);
    let start = Math.max(parseHm(t.start_time) ?? cursor, nowMin);
    // A short break after ~2h of continuous work.
    if (sinceBreak >= 120 && start === cursor) {
      breaks.push(`${hm(start)} 15-min break`);
      start += 15;
      sinceBreak = 0;
    }
    // Slide past clashes with existing entries.
    for (let guard = 0; guard < 20; guard++) {
      const clash = busy.find(([s, e]) => start < e && start + mins > s);
      if (!clash) break;
      if (/break$/i.test(clash[2]) && !breaks.some((b) => b.includes(clash[2])))
        breaks.push(`${hm(clash[0])} ${clash[2]}`);
      start = clash[1];
      sinceBreak = 0;
    }
    const fitMins =
      windowEnd != null && start + mins > windowEnd && windowEnd - start >= 15
        ? windowEnd - start
        : mins;
    if (windowEnd != null && start + fitMins > windowEnd) {
      rejected.push({ title: t.title, issues: [`does not fit before ${hm(windowEnd)}`] });
      continue;
    }
    if (start + mins > 23 * 60 + 59) {
      rejected.push({ title: t.title, issues: ["does not fit before midnight"] });
      continue;
    }
    if (parseHm(t.start_time) != null && start !== parseHm(t.start_time))
      moved.push(`${t.title} ${t.start_time}→${hm(start)}`);
    const key = `queue:${day}:${t.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 60)}`;
    const dupe =
      (existing ?? []).find((b: any) => b.source_ref === key) ??
      (existing ?? []).find(
        (b: any) =>
          String(b.source_ref ?? "").startsWith(`queue:${day}:`) &&
          b.status !== "done" &&
          isNearDuplicate(
            { title: b.title, destination: null },
            { title: t.title, destination: null },
          ),
      );
    const detail = {
      queue: true,
      destination: t.destination ?? null,
      link: t.link ?? null,
      rule: t.rule ?? null,
      action: t.action,
      first_step: t.first_step ?? null,
      prepared_copy: t.prepared_copy ? String(t.prepared_copy).slice(0, 4000) : null,
      done_when: t.done_when,
      record: t.record ?? null,
      source_message: ctx.messageId ?? null,
      mission_id: missionId,
    };
    const row = {
      title: t.title.slice(0, 120),
      starts_at: zonedInstant(day, start, ctx.tz).toISOString(),
      duration_min: fitMins,
      note: noteFor(t),
      evidence_detail: detail as never,
    };
    let id: string | null = dupe?.id ?? null;
    if (dupe) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await (supabaseAdmin as Db)
        .from("plan_blocks")
        .update(row)
        .eq("id", dupe.id)
        .eq("user_id", ctx.userId);
    } else {
      const { data, error } = await ctx.db
        .from("plan_blocks")
        .insert({
          ...row,
          user_id: ctx.userId,
          goal_id: goalId,
          status: "planned",
          is_protected: true,
          source_type: "manual",
          source_ref: key,
          occurrence_kind: kind,
          domain,
        })
        .select("id")
        .single();
      if (error) {
        rejected.push({ title: t.title, issues: [`could not save: ${error.message}`] });
        continue;
      }
      id = data.id;
    }
    accepted.push(t);
    busy.push([start, start + fitMins, t.title]);
    sinceBreak = start === cursor ? sinceBreak + fitMins : fitMins;
    cursor = start + fitMins;
    placed.push({
      id,
      time: hm(start),
      minutes: fitMins,
      title: t.title,
      destination: t.destination ?? null,
      updated_existing: !!dupe,
    });
  }
  // A new queue for the same goal and day replaces open tasks it no longer contains (e.g. ones built on an assumption that turned out wrong).
  let superseded = 0;
  if (a["replace_open"] === true && placed.length) {
    const keep = new Set(placed.map((p) => p["id"]));
    const stale = (existing ?? []).filter(
      (b: any) =>
        String(b.source_ref ?? "").startsWith("queue:") &&
        !keep.has(b.id) &&
        ["planned", "scheduled", "upcoming", "due"].includes(b.status),
    );
    if (stale.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      for (const b of stale) {
        const { error } = await (supabaseAdmin as Db)
          .from("plan_blocks")
          .update({ status: "cancelled", note: "Replaced by an updated task list" })
          .eq("id", b.id)
          .eq("user_id", ctx.userId);
        if (!error) {
          superseded++;
          await (supabaseAdmin as Db).from("plan_block_events").insert({
            user_id: ctx.userId,
            block_id: b.id,
            event_type: "cancelled",
            from_status: b.status,
            to_status: "cancelled",
            reason_code: "queue_replaced",
            metadata: {},
          });
        }
      }
    }
  }
  const lastEnd = placed.length ? cursor : null;
  let freeLeft = 0;
  if (windowEnd != null && lastEnd != null) {
    for (let m = lastEnd; m < windowEnd; m++)
      if (!busy.some(([s, e]) => m >= s && m < e)) freeLeft++;
  }
  const capacity =
    windowEnd == null
      ? null
      : {
          window: `${hm(windowStart)}-${hm(windowEnd)}`,
          scheduled_minutes: placed.reduce((n, p) => n + Number(p["minutes"]), 0),
          breaks,
          final_task_ends: lastEnd != null ? hm(lastEnd) : null,
          free_minutes_left: freeLeft,
          ends_because:
            freeLeft >= 45
              ? "ran out of tasks in this batch — add another batch (schedule_execution_queue, same day) starting at final_task_ends until the window is used"
              : "the stated working window is used",
        };
  return {
    capacity,
    mission_id: missionId,
    superseded,
    status: placed.length ? "SCHEDULED" : "FAILED",
    day,
    placed,
    rejected,
    moved_for_clashes: moved,
    first_task: placed[0] ?? null,
    note: "These are on the member's Today and Plan pages. Hand them the first task now with its prepared copy; when they say done or report a result, call update_execution_task.",
  };
}

const STATUS_EVENT: Record<string, string> = {
  done: "completed",
  partial: "partial",
  skipped: "skipped",
  blocked: "blocked",
  rescheduled: "rescheduled",
};

/** Records what happened to the current (or named) queue task, moves the rest on a pause, and returns the next task. */
export async function updateExecutionTask(ctx: Ctx, a: Record<string, unknown>) {
  // Members' own client may not change plan status (DB guard); status writes go through the server, scoped to this member
  // and checked against canTransition plus the DB transition trigger.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sys = supabaseAdmin as Db;
  const today = localDayKey(new Date(), ctx.tz);
  const status = String(a["status"] ?? "done");
  // Difficulty feedback about a workout already recorded ("that workout was too easy"): adapt once, no second result.
  {
    const { effortFeedback } = await import("./training");
    const effort = effortFeedback(`${a["outcome_note"] ?? ""} ${ctx.memberText ?? ""}`);
    if (effort && !/\b(done|finished|completed)\b/i.test(String(ctx.memberText ?? ""))) {
      const { data: recent } = await sys
        .from("plan_blocks")
        .select("id,title,evidence_detail")
        .eq("user_id", ctx.userId)
        .eq("occurrence_kind", "workout")
        .eq("status", "done")
        .gte("completed_at", new Date(Date.now() - 6 * 3600e3).toISOString())
        .order("completed_at", { ascending: false })
        .limit(1);
      const w = (recent ?? [])[0] as any;
      if (w) {
        if (w.evidence_detail?.outcome?.effort)
          return {
            status: "ALREADY_RECORDED",
            recorded: { title: w.title, effort: w.evidence_detail.outcome.effort },
            next: "That feedback was already applied; nothing changed again.",
          };
        const progression = await (
          await import("./training-adapt.server")
        )
          .applyEffortFeedback(ctx.userId, effort, w.id)
          .catch((e) => ({ status: "FAILED", error: String(e?.message ?? e) }));
        await sys
          .from("plan_blocks")
          .update({
            evidence_detail: {
              ...(w.evidence_detail ?? {}),
              outcome: { ...(w.evidence_detail?.outcome ?? {}), effort },
            } as never,
          })
          .eq("id", w.id)
          .eq("user_id", ctx.userId);
        return {
          status: "FEEDBACK_APPLIED",
          recorded: { title: w.title, effort },
          progression,
          next: "Tell the member exactly what changed from progression. Do not call change_training_programme.",
        };
      }
    }
  }
  // Only a member's own report changes a task; setting up a session never marks it partly done.
  if (ctx.memberText != null) {
    const { classifyActions } = await import("./life-intelligence");
    const loop = classifyActions(ctx.memberText).loop;
    if (
      loop !== "outcome" &&
      loop !== "pause" &&
      !/\b(done|finished|completed|skipped|couldn't|could not|didn't|did not|missed)\b/i.test(
        ctx.memberText,
      )
    )
      return {
        error: "no_member_report",
        hint: "The member has not reported doing this task. Do not change its status; just hand it over.",
      };
  }
  if (!STATUS_EVENT[status] && status !== "pause_rest") return { error: "invalid_status" };
  const { data: open } = await ctx.db
    .from("plan_blocks")
    .select(
      "id,title,starts_at,duration_min,status,goal_id,evidence_detail,source_ref,occurrence_kind",
    )
    .eq("user_id", ctx.userId)
    .like("source_ref", "queue:%")
    .in("status", status === "done" ? [...LIVE, "partial"] : LIVE)
    .gte("starts_at", zonedInstant(today, 0, ctx.tz).toISOString())
    .order("starts_at")
    .limit(30);
  const list = open ?? [];
  if (status === "pause_rest") {
    // "I need to stop now, continue tomorrow": every unfinished task keeps its order and moves to tomorrow.
    const tomorrow = resolveDay("tomorrow", today)!;
    const todays: any[] = list.filter(
      (b: any) => localDayKey(new Date(b.starts_at), ctx.tz) === today,
    );
    // Also the rest of today's ordinary plan entries (not only queue tasks): stopping means the evening moves.
    {
      const { data: rest } = await sys
        .from("plan_blocks")
        .select(
          "id,title,starts_at,duration_min,status,goal_id,evidence_detail,source_ref,occurrence_kind",
        )
        .eq("user_id", ctx.userId)
        .in("status", ["planned", "scheduled", "upcoming", "due", "snoozed"])
        .gte("starts_at", new Date(Date.now() - 15 * 60000).toISOString())
        .lt("starts_at", zonedInstant(tomorrow, 0, ctx.tz).toISOString())
        .order("starts_at");
      for (const b of (rest ?? []) as any[])
        if (!todays.some((x: any) => x.id === b.id)) todays.push(b);
      todays.sort((x: any, y: any) => Date.parse(x.starts_at) - Date.parse(y.starts_at));
    }
    if (!todays.length) return { status: "nothing_open_today" };
    const startMin = parseHm(String(a["resume_time"] ?? "")) ?? 9 * 60;
    let cursor = startMin;
    // Work being continued goes first (it was in progress); entries moved earlier from tonight follow it in order.
    const pushBack: any[] = [];
    {
      const { data: mv } = await sys
        .from("plan_blocks")
        .select("id,starts_at,duration_min,source_ref")
        .eq("user_id", ctx.userId)
        .eq("status", "planned")
        .like("source_ref", `%:moved:${tomorrow}`)
        .gte("starts_at", zonedInstant(tomorrow, 0, ctx.tz).toISOString())
        .lt("starts_at", zonedInstant(tomorrow, 12 * 60, ctx.tz).toISOString())
        .order("starts_at");
      pushBack.push(...((mv ?? []) as any[]));
    }
    // Start after anything else already waiting tomorrow morning so continued work never overlaps it.
    {
      const { data: tm } = await sys
        .from("plan_blocks")
        .select("id,starts_at,duration_min")
        .eq("user_id", ctx.userId)
        .in("status", ["planned", "scheduled", "upcoming"])
        .gte("starts_at", zonedInstant(tomorrow, startMin, ctx.tz).toISOString())
        .lt("starts_at", zonedInstant(tomorrow, 12 * 60, ctx.tz).toISOString());
      for (const b of ((tm ?? []) as any[]).filter((x) => !pushBack.some((p) => p.id === x.id))) {
        const end =
          Math.round(
            (Date.parse(b.starts_at) - zonedInstant(tomorrow, 0, ctx.tz).getTime()) / 60000,
          ) +
          (b.duration_min ?? 30) +
          10;
        if (end > cursor) cursor = end;
      }
    }
    const movedTo: Record<string, unknown>[] = [];
    for (const b of todays) {
      if (!canTransition(b.status, "rescheduled")) continue;
      const newStart = zonedInstant(tomorrow, cursor, ctx.tz).toISOString();
      const isQueue = String(b.source_ref ?? "").startsWith("queue:");
      const key = isQueue
        ? String(b.source_ref).replace(`queue:${today}:`, `queue:${tomorrow}:`)
        : `${b.source_ref ?? b.id}:cont:${tomorrow}`;
      const { error: mvErr } = await sys
        .from("plan_blocks")
        .update({ status: "rescheduled", note: `Continued tomorrow at ${hm(cursor)}` })
        .eq("id", b.id)
        .eq("user_id", ctx.userId);
      if (mvErr) return { error: "could_not_move", detail: mvErr.message, moved: movedTo };
      const { data: copy } = await ctx.db
        .from("plan_blocks")
        .insert({
          user_id: ctx.userId,
          title: b.title,
          starts_at: newStart,
          duration_min: b.duration_min,
          status: "planned",
          is_protected: true,
          source_type: "manual",
          source_ref: key,
          occurrence_kind: isQueue ? "work_task" : (b.occurrence_kind ?? "work_task"),
          goal_id: b.goal_id,
          evidence_detail: b.evidence_detail,
          note: `Continued from ${today}`,
        })
        .select("id")
        .single();
      await sys.from("plan_block_events").insert({
        user_id: ctx.userId,
        block_id: b.id,
        event_type: "rescheduled",
        from_status: b.status,
        to_status: "rescheduled",
        reason_code: "member_paused",
        metadata: { moved_to: copy?.id ?? null, starts_at: newStart },
      });
      movedTo.push({ title: b.title, day: tomorrow, time: hm(cursor) });
      cursor += b.duration_min;
    }
    for (const b of pushBack) {
      const st = zonedInstant(tomorrow, cursor, ctx.tz).toISOString();
      await sys
        .from("plan_blocks")
        .update({ starts_at: st })
        .eq("id", b.id)
        .eq("user_id", ctx.userId);
      movedTo.push({ retimed: true, day: tomorrow, time: hm(cursor) });
      cursor += (b.duration_min ?? 30) + 10;
    }
    return {
      status: "PAUSED",
      checkpoint_saved: true,
      moved: movedTo,
      next: "Tell the member what moved and that 'what are we doing next?' resumes from the first one.",
    };
  }
  const id = a["task_id"] ? String(a["task_id"]) : null;
  const nowMs = Date.now();
  // "Done" with no id means the task they are on: the earliest open task that has started, else the next one.
  if (!id && status === "done") {
    // Replay guard: the same report sent twice must not complete the next task or count twice.
    const { data: recent } = await ctx.db
      .from("plan_blocks")
      .select("id,title,evidence_detail,completed_at")
      .eq("user_id", ctx.userId)
      .like("source_ref", "queue:%")
      .eq("status", "done")
      .gte("completed_at", new Date(Date.now() - 10 * 60000).toISOString())
      .order("completed_at", { ascending: false })
      .limit(1);
    const r = (recent ?? [])[0] as any;
    const prevVal = r?.evidence_detail?.outcome?.metric_value ?? null;
    const sameMetric =
      a["metric_value"] != null && prevVal != null && Number(prevVal) === Number(a["metric_value"]);
    const said = String(ctx.memberText ?? "")
      .trim()
      .toLowerCase();
    const bareRepeat = !!r && !!said && String(r.evidence_detail?.outcome?.said ?? "") === said;
    if (r && (sameMetric || bareRepeat)) {
      return {
        status: "ALREADY_RECORDED",
        recorded: { title: r.title, ...(r.evidence_detail?.outcome ?? {}) },
        next: "This matches a result saved minutes ago, so it was not counted again and no other task was completed. Say so in one line; if it was really a different task, call update_execution_task again with that task_id. Do not call record_progress or log it elsewhere.",
      };
    }
  }
  const target = id
    ? list.find((b: any) => b.id === id)
    : (list.filter((b: any) => new Date(b.starts_at).getTime() <= nowMs + 15 * 60000)[0] ??
      list[0]);
  if (!target && a["metric_value"] != null && Number.isFinite(Number(a["metric_value"]))) {
    const label = a["metric_label"] ? String(a["metric_label"]).slice(0, 40) : "result";
    const mp = await recordMissionMetric(
      ctx,
      a["mission_id"] ? String(a["mission_id"]) : null,
      null,
      `report:${today}:${metricKey(label)}:${Number(a["metric_value"])}`,
      label,
      Number(a["metric_value"]),
    ).catch(() => null);
    if (mp && !(mp as any).task_only)
      return {
        status: "RESULT_RECORDED_ON_MISSION",
        mission_progress: mp,
        next: "No task was open, so the result is saved on the mission. Create the next tasks that use it now with schedule_execution_queue and hand over the first one.",
      };
  }
  if (
    !target &&
    status === "done" &&
    /\b(workout|training|session|circuit|gym|run|exercises?)\b/i.test(String(ctx.memberText ?? ""))
  ) {
    // A planned workout (not a queue task): record it on today's workout occurrence, then adapt from effort.
    const { data: wk } = await sys
      .from("plan_blocks")
      .select("id,title,status,starts_at,goal_id")
      .eq("user_id", ctx.userId)
      .eq("occurrence_kind", "workout")
      .in("status", LIVE)
      .gte("starts_at", zonedInstant(today, 0, ctx.tz).toISOString())
      .lt("starts_at", zonedInstant(today, 24 * 60, ctx.tz).toISOString())
      .order("starts_at")
      .limit(10);
    // The one they were on: the latest that has started, else today's next one (done early still counts).
    // Replay guard: the same report twice in a few minutes is one workout, adapted once.
    const said0 = String(ctx.memberText ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 300);
    const { data: justDone } = await sys
      .from("plan_blocks")
      .select("id,title,evidence_detail")
      .eq("user_id", ctx.userId)
      .eq("occurrence_kind", "workout")
      .eq("status", "done")
      .gte("completed_at", new Date(nowMs - 10 * 60000).toISOString())
      .limit(5);
    const again = ((justDone ?? []) as any[]).find(
      (b) => String(b.evidence_detail?.outcome?.said ?? "") === said0,
    );
    if (again)
      return {
        status: "ALREADY_RECORDED",
        recorded: { title: again.title },
        next: "This workout and its difficulty change were saved minutes ago; nothing was changed again. Say so in one line.",
      };
    const todays = (wk ?? []) as any[];
    const w =
      todays.filter((b) => new Date(b.starts_at).getTime() <= nowMs + 60 * 60000).pop() ??
      todays[0];
    const { effortFeedback } = await import("./training");
    const effort = effortFeedback(`${a["outcome_note"] ?? ""} ${ctx.memberText ?? ""}`);
    let recorded: unknown = null;
    if (w && canTransition(w.status, "done")) {
      const outcome = {
        note: a["outcome_note"] ? String(a["outcome_note"]).slice(0, 500) : null,
        said: String(ctx.memberText ?? "")
          .trim()
          .toLowerCase()
          .slice(0, 300),
        effort,
      };
      const { error } = await sys
        .from("plan_blocks")
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
          evidence: "self_reported",
          evidence_detail: { outcome } as never,
        })
        .eq("id", w.id)
        .eq("user_id", ctx.userId);
      if (!error) {
        await sys.from("plan_block_events").insert({
          user_id: ctx.userId,
          block_id: w.id,
          event_type: "completed",
          from_status: w.status,
          to_status: "done",
          reason_code: "member_report",
          metadata: outcome,
        });
        await logProgrammeWorkout(ctx.userId, w.id, "completed", outcome.note).catch(() => null);
        recorded = {
          title: w.title,
          id: w.id,
          mission_progress: await recordMissionMetric(
            ctx,
            null,
            w.goal_id ?? null,
            w.id,
            "workouts completed",
            1,
          ).catch(() => null),
        };
      }
    }
    const progression = effort
      ? await (
          await import("./training-adapt.server")
        )
          .applyEffortFeedback(ctx.userId, effort, w?.id ?? null)
          .catch((e) => ({ status: "FAILED", error: String(e?.message ?? e) }))
      : null;
    if (recorded || progression)
      return {
        status: recorded ? "WORKOUT_COMPLETED" : "FEEDBACK_APPLIED",
        recorded,
        progression,
        next: "Tell the member it is recorded and exactly what changed: name each exercise in progression.changes with its old and new sets×reps. The change is already saved; never say feedback was passed on or will be reviewed. Do not call change_training_programme for difficulty feedback.",
      };
  }
  if (!target)
    return {
      error: "no_open_task",
      hint: "Nothing is open on today's queue. Ask what they finished, or set up the queue with schedule_execution_queue.",
    };
  if (!canTransition(target.status, status))
    return { error: "invalid_transition", from: target.status, to: status };
  const outcome = {
    note: a["outcome_note"] ? String(a["outcome_note"]).slice(0, 500) : null,
    metric_label: a["metric_label"] ? String(a["metric_label"]).slice(0, 40) : null,
    metric_value:
      Number.isFinite(Number(a["metric_value"])) && a["metric_value"] != null
        ? Number(a["metric_value"])
        : null,
    reason: a["reason"] ? String(a["reason"]).slice(0, 300) : null,
    said:
      String(ctx.memberText ?? "")
        .trim()
        .toLowerCase()
        .slice(0, 300) || null,
    recorded_at: new Date().toISOString(),
  };
  const detail = { ...((target.evidence_detail ?? {}) as object), outcome };
  const { error } = await sys
    .from("plan_blocks")
    .update({
      status,
      completed_at: status === "done" || status === "partial" ? new Date().toISOString() : null,
      evidence: "self_reported",
      evidence_detail: detail as never,
    })
    .eq("id", target.id)
    .eq("user_id", ctx.userId);
  if (error) return { error: "could_not_save", detail: error.message };
  await sys.from("plan_block_events").insert({
    user_id: ctx.userId,
    block_id: target.id,
    event_type: STATUS_EVENT[status],
    from_status: target.status,
    to_status: status,
    reason_code: "member_report",
    metadata: outcome,
  });
  const channel = await recordChannel(
    ctx,
    (target.evidence_detail as any)?.mission_id ?? null,
    target.goal_id ?? null,
    String((target.evidence_detail as any)?.destination ?? "") || null,
    status,
    outcome,
  ).catch(() => null);
  const mission =
    outcome.metric_value != null && (status === "done" || status === "partial")
      ? await recordMissionMetric(
          ctx,
          (target.evidence_detail as any)?.mission_id ?? null,
          target.goal_id ?? null,
          target.id,
          outcome.metric_label ?? "result",
          outcome.metric_value,
        ).catch((e) => ({ error: String(e?.message ?? e) }))
      : null;
  // "Too easy"/"too hard" after a workout changes the next session for real, not just a saved note.
  let progression: unknown = null;
  const isWorkout =
    /workout|training|circuit|gym|session|run|exercise/i.test(
      `${target.title} ${target.source_ref}`,
    ) || (target as any).occurrence_kind === "workout";
  if ((status === "done" || status === "partial") && isWorkout) {
    // A workout finished through Coach also appears in the Training page's history and moves the
    // programme on to its next day, exactly like finishing it on the Training page.
    await logProgrammeWorkout(
      ctx.userId,
      target.id,
      status === "done" ? "completed" : "partial",
      outcome.note ?? null,
    ).catch(() => null);
    const { effortFeedback } = await import("./training");
    const effort = effortFeedback(`${outcome.note ?? ""} ${ctx.memberText ?? ""}`);
    if (effort) {
      const { applyEffortFeedback } = await import("./training-adapt.server");
      progression = await applyEffortFeedback(ctx.userId, effort, target.id).catch((e) => ({
        status: "FAILED",
        error: String(e?.message ?? e),
      }));
    }
  }
  const rest = list.filter((b: any) => b.id !== target.id);
  const next = rest[0]
    ? {
        id: rest[0].id,
        title: rest[0].title,
        starts_at: rest[0].starts_at,
        ...(rest[0].evidence_detail ?? {}),
      }
    : null;
  return {
    status: status === "done" ? "COMPLETED" : status.toUpperCase(),
    recorded: { title: target.title, ...outcome },
    mission_progress: mission,
    progression,
    channel_learning: channel,
    remaining: rest.length,
    next_batch:
      rest.length <= 1
        ? "Queue nearly empty: if the member's stated window still has time, call schedule_execution_queue again for the same day with fresh tasks (no repeats of done destinations)."
        : null,
    next_task: next,
    adapt:
      status === "blocked" || status === "skipped"
        ? "Say why it failed in one line, drop or reword similar destinations in the remaining queue (schedule_execution_queue with the same titles updates them), then give the next task."
        : outcome.metric_value != null
          ? "Name the result; if it beat the others, put similar destinations earlier in the remaining queue."
          : null,
  };
}

async function resolveMissionId(
  ctx: Ctx,
  given: string | null,
  goalId: string | null,
): Promise<string | null> {
  if (given) {
    const { data } = await ctx.db
      .from("goal_missions")
      .select("id")
      .eq("id", given)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    if (data) return data.id;
  }
  if (goalId) {
    const { data } = await ctx.db
      .from("goal_missions")
      .select("id")
      .eq("user_id", ctx.userId)
      .eq("goal_id", goalId)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (data?.[0]) return data[0].id;
  }
  const { data } = await ctx.db
    .from("goal_missions")
    .select("id,state")
    .eq("user_id", ctx.userId)
    .not("state", "in", "(ACHIEVED,ABANDONED,ARCHIVED)")
    .order("updated_at", { ascending: false })
    .limit(1);
  return data?.[0]?.id ?? null;
}

const metricKey = (l: string) =>
  l
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "result";

/** Task outcome -> mission metric (idempotent per task) -> goal metric once that goal is active. */
export async function recordMissionMetric(
  ctx: Ctx,
  missionId: string | null,
  goalId: string | null,
  blockId: string,
  label: string,
  value: number,
) {
  const id = missionId ?? (await resolveMissionId(ctx, null, goalId));
  if (!id) return { task_only: true, reason: "no mission linked" };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sys = supabaseAdmin as Db;
  const { data: m } = await sys
    .from("goal_missions")
    .select("id,metrics,goal_id")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!m) return { task_only: true, reason: "mission not found" };
  const metrics = (m.metrics ?? {}) as {
    totals?: Record<string, number>;
    entries?: Record<string, { label: string; value: number; at: string }>;
    goal_synced?: Record<string, boolean>;
  };
  const entries = { ...(metrics.entries ?? {}) };
  const key = metricKey(label);
  entries[blockId] = { label: key, value, at: new Date().toISOString() };
  const totals: Record<string, number> = {};
  for (const e of Object.values(entries))
    totals[e.label] = (totals[e.label] ?? 0) + Number(e.value);
  await sys
    .from("goal_missions")
    .update({ metrics: { ...metrics, totals, entries } })
    .eq("id", id)
    .eq("user_id", ctx.userId);
  const goal = await propagateMissionToGoal(ctx.userId, id);
  return {
    mission_id: id,
    metric: key,
    task_value: value,
    mission_total: totals[key],
    goal:
      goal ??
      "goal not active yet — counted on the mission and will carry over when the goal is confirmed",
  };
}

/** Copies unsynced mission evidence into the linked goal's progress only when that goal is active. Idempotent. */
export async function propagateMissionToGoal(userId: string, missionId: string | null) {
  if (!missionId) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sys = supabaseAdmin as Db;
  const { data: m } = await sys
    .from("goal_missions")
    .select("id,metrics,goal_id")
    .eq("id", missionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!m?.goal_id) return null;
  const { data: g } = await sys
    .from("goals")
    .select("id,status,current_value")
    .eq("id", m.goal_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!g || g.status !== "active") return null;
  const metrics = (m.metrics ?? {}) as any;
  const synced: Record<string, boolean> = { ...(metrics.goal_synced ?? {}) };
  let added = 0;
  for (const [blockId, e] of Object.entries(
    (metrics.entries ?? {}) as Record<string, { label: string; value: number }>,
  )) {
    if (synced[blockId]) continue;
    const source = `execution:${blockId}`;
    const { data: dup } = await sys
      .from("goal_metric_entries")
      .select("id")
      .eq("goal_id", g.id)
      .eq("source", source)
      .limit(1);
    if (!dup?.length) {
      await sys
        .from("goal_metric_entries")
        .insert({ user_id: userId, goal_id: g.id, value: e.value, note: e.label, source });
      added += Number(e.value);
    }
    synced[blockId] = true;
  }
  if (added)
    await sys
      .from("goals")
      .update({ current_value: Number(g.current_value ?? 0) + added })
      .eq("id", g.id);
  await sys
    .from("goal_missions")
    .update({ metrics: { ...metrics, goal_synced: synced } })
    .eq("id", m.id);
  return { goal_id: g.id, added_to_goal: added };
}

const normChannel = (d: string) =>
  d
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ");

async function unsuitableChannels(
  ctx: Ctx,
  missionId: string | null,
): Promise<Record<string, string>> {
  if (!missionId) return {};
  const { data } = await ctx.db
    .from("goal_missions")
    .select("metrics")
    .eq("id", missionId)
    .maybeSingle();
  const ch = ((data?.metrics ?? {}) as any).channels ?? {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ch as Record<string, any>))
    if (v?.suitability === "unsuitable") out[k] = String(v.reason ?? "removed");
  return out;
}

/** Per-destination attribution on the mission: results add weight, removals mark the place unsuitable so it is not recommended again. */
async function recordChannel(
  ctx: Ctx,
  missionId: string | null,
  goalId: string | null,
  destination: string | null,
  status: string,
  outcome: { metric_label: string | null; metric_value: number | null; reason: string | null },
) {
  if (!destination) return null;
  const id = missionId ?? (await resolveMissionId(ctx, null, goalId));
  if (!id) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sys = supabaseAdmin as Db;
  const { data: m } = await sys
    .from("goal_missions")
    .select("metrics")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!m) return null;
  const metrics = (m.metrics ?? {}) as any;
  const channels = { ...(metrics.channels ?? {}) };
  const key = normChannel(destination);
  const prev = channels[key] ?? { destination, results: 0, attempts: 0 };
  const next = {
    ...prev,
    destination,
    attempts: prev.attempts + 1,
    last_status: status,
    at: new Date().toISOString(),
  };
  if (outcome.metric_value != null && (status === "done" || status === "partial")) {
    next.results = Number(prev.results ?? 0) + outcome.metric_value;
    next.metric = outcome.metric_label ?? "result";
    next.suitability = "proven";
  }
  if (status === "blocked") {
    next.suitability = "unsuitable";
    next.reason = outcome.reason ?? "removed";
  }
  channels[key] = next;
  await sys
    .from("goal_missions")
    .update({ metrics: { ...metrics, channels } })
    .eq("id", id)
    .eq("user_id", ctx.userId);
  const ranked = Object.values(channels as Record<string, any>)
    .filter((c) => c.suitability !== "unsuitable")
    .sort((x, y) => Number(y.results ?? 0) - Number(x.results ?? 0))
    .map((c) => `${c.destination}: ${c.results ?? 0}`);
  return {
    channel: destination,
    suitability: next.suitability ?? "tried",
    reason: next.reason ?? null,
    best_channels: ranked.slice(0, 5),
    avoid: Object.values(channels as Record<string, any>)
      .filter((c) => c.suitability === "unsuitable")
      .map((c) => `${c.destination} (${c.reason})`),
  };
}

async function logProgrammeWorkout(
  userId: string,
  blockId: string,
  outcome: "completed" | "partial",
  note: string | null,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: linked } = await db
    .from("workout_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("block_id", blockId)
    .limit(1);
  if (linked?.length) return;
  const { data: prog } = await db
    .from("training_programmes")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1);
  const programmeId = prog?.[0]?.id as string | undefined;
  if (!programmeId) return;
  const [{ data: rx }, { data: last }] = await Promise.all([
    db.from("programme_prescriptions").select("day_index").eq("programme_id", programmeId),
    db
      .from("workout_sessions")
      .select("day_index")
      .eq("user_id", userId)
      .eq("programme_id", programmeId)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1),
  ]);
  const days = [...new Set(((rx ?? []) as { day_index: number }[]).map((r) => r.day_index))].sort(
    (a, b) => a - b,
  );
  if (!days.length) return;
  const lastDay = last?.[0]?.day_index;
  const day =
    lastDay == null ? days[0] : (days[(days.indexOf(lastDay) + 1) % days.length] ?? days[0]);
  const now = new Date().toISOString();
  await db.from("workout_sessions").insert({
    user_id: userId,
    programme_id: programmeId,
    day_index: day,
    block_id: blockId,
    status: "completed",
    started_at: now,
    completed_at: now,
    note,
    ...(outcome === "partial" ? { note: note ? `Partly done. ${note}` : "Partly done." } : {}),
  });
}
