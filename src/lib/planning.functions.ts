import { MISSED_REASONS, SAFETY_REASON } from "./behaviour";
import {
  LIFE_INTELLIGENCE_VERSION,
  missPatterns,
  patternAdherence,
  planRationale,
} from "./life-intelligence";
import {
  isReplanReplaceable,
  kindForDomain,
  routineOccurrences,
  sourceForBlock,
} from "./occurrences";
import { planningGoals } from "./goals";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { addDaysKey, localDayKey, localDayRange, weekKeyOf, zonedInstant, zonedParts } from "./tz";
import {
  adherenceByHour,
  energyPeakFrom,
  buildWeekPlan,
  feasibilityReport,
  placeMakeups,
  startOfWeek,
} from "./scheduler";

async function userZone(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  return (data?.timezone as string) || "UTC";
}
const weekEndOf = (weekStart: Date, tz: string) =>
  zonedInstant(addDaysKey(weekKeyOf(weekStart, tz), 7), 0, tz);

export async function loadCommitments(supabase: any, userId?: string) {
  // V3 §66.2: external calendar busy times are hard constraints alongside fixed commitments.
  const { busyToCommitments } = await import("./calendar");
  // Callers that already know the member pass userId (the Coach's guarded client has no auth access).
  const me = userId ?? (await supabase.auth.getUser()).data.user?.id ?? "";
  const [{ data }, { data: busy }, { data: conns }, { data: prof }] = await Promise.all([
    supabase
      .from("commitments")
      .select("recurrence,days,on_date,start_time,end_time,active")
      .eq("active", true),
    supabase
      .from("calendar_busy")
      .select("starts_at,ends_at,all_day,busy,connection_id")
      .gte("ends_at", new Date(Date.now() - 864e5).toISOString())
      .limit(3000),
    supabase
      .from("calendar_connections")
      .select("id,all_day_hard")
      .in("status", ["active", "degraded"]),
    supabase.from("profiles").select("timezone").eq("id", me).maybeSingle(),
  ]);
  const hard = new Map(
    ((conns ?? []) as { id: string; all_day_hard: boolean }[]).map((c) => [c.id, c.all_day_hard]),
  );
  const ext = busyToCommitments(
    (
      (busy ?? []) as {
        starts_at: string;
        ends_at: string;
        all_day: boolean;
        busy: boolean;
        connection_id: string;
      }[]
    )
      .filter((b) => hard.has(b.connection_id))
      .map((b) => ({ ...b, hard_all_day: hard.get(b.connection_id) })),
    prof?.timezone ?? null,
  );
  return [
    ...((data ?? []) as {
      recurrence: string;
      days: number[];
      on_date: string | null;
      start_time: string;
      end_time: string;
      active: boolean;
    }[]),
    ...ext,
  ];
}

async function syncRoutines(supabase: any, supabaseAdmin: any, userId: string, weekStart: Date) {
  const [{ data: profile }, { data: commits }] = await Promise.all([
    supabase
      .from("profiles")
      .select("wake_time,work_start,work_days,timezone")
      .eq("id", userId)
      .single(),
    supabase
      .from("commitments")
      .select("id,title,kind,recurrence,days,on_date,start_time,active")
      .eq("active", true),
  ]);
  if (!profile) return 0;
  const now = new Date();
  const wanted = routineOccurrences(profile, commits ?? [], weekStart, now, profile.timezone);
  const weekEnd = weekEndOf(weekStart, profile.timezone);
  const { data: existing } = await supabase
    .from("plan_blocks")
    .select("id,source_ref,status")
    .in("source_type", ["routine", "commitment"])
    .gte("starts_at", now.toISOString())
    .lt("starts_at", weekEnd.toISOString());
  const want = new Set(wanted.map((w) => w.source_ref));
  const have = new Set(
    (existing ?? [])
      .filter((e: { status: string }) => e.status !== "rescheduled")
      .map((e: { source_ref: string }) => e.source_ref),
  );
  const stale = (existing ?? [])
    .filter(
      (e: { source_ref: string; status: string }) =>
        [
          "planned",
          "scheduled",
          "upcoming",
          "due",
          "contacting",
          "acknowledged",
          "snoozed",
        ].includes(e.status) && !want.has(e.source_ref),
    )
    .map((e: { id: string }) => e.id);
  if (stale.length) {
    await supabaseAdmin
      .from("plan_blocks")
      .update({ status: "rescheduled", note: "Commitment or routine changed" })
      .in("id", stale);
    await supabaseAdmin.from("plan_block_events").insert(
      stale.map((id: string) => ({
        user_id: userId,
        block_id: id,
        event_type: "rescheduled",
        to_status: "rescheduled",
        reason_code: "routine_changed",
        actor_type: "system",
        source_channel: "scheduler",
      })),
    );
  }
  const add = wanted
    .filter((w) => !have.has(w.source_ref))
    .map((w) => ({ ...w, user_id: userId, goal_id: null, status: "planned" }));
  if (add.length) await supabaseAdmin.from("plan_blocks").insert(add);
  return add.length;
}

export const syncRoutineOccurrences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const tz = await userZone(context.supabase, context.userId);
    return {
      added: await syncRoutines(
        context.supabase,
        supabaseAdmin,
        context.userId,
        startOfWeek(new Date(), tz),
      ),
    };
  });

const triggerSchema = z.enum([
  "onboarding",
  "goal_change",
  "manual",
  "recovery",
  "calendar_change",
  "system",
]);

const blockShape = z.object({
  goal_id: z.string().uuid(),
  title: z.string().min(1).max(160),
  domain: z.string().min(1).max(40),
  starts_at: z.string().datetime({ offset: true }),
  duration_min: z.number().int().min(1).max(480), // wellness sessions can be as short as 2 minutes
  note: z.string().max(200).optional(),
});

export const proposeWeekPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        trigger: triggerSchema.default("manual"),
        week: z.enum(["current", "next"]).default("current"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => proposeWeekPlanCore(context as never, data));

/** Builds and stores a week proposal for one member; the server fn and the standing-order runner share it. */
export async function proposeWeekPlanCore(
  context: {
    supabase: import("@supabase/supabase-js").SupabaseClient<
      import("@/integrations/supabase/types").Database
    >;
    userId: string;
  },
  data: { trigger: z.infer<typeof triggerSchema>; week: "current" | "next" },
) {
  const { supabase, userId } = context;
  if (!(await (await import("./security.server")).rateLimit("plan_optimise", context.userId)))
    throw new Error("Too many plan rebuilds in a minute. Wait a moment and try again.");
  const trigger = (await (
    await import("./entitlements.server")
  ).requireReplanAllowance(supabase, userId, data.trigger)) as typeof data.trigger;
  // One training owner: a fitness goal and the programme's goal never schedule competing workouts.
  await (
    await import("./training-goal.server")
  )
    .unifyTrainingGoal(userId)
    .catch((e) => console.error("unify training", e));
  const [{ data: profile, error: profileError }, { data: goals, error: goalsError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("wake_time,sleep_time,work_start,work_end,work_days,timezone")
        .eq("id", userId)
        .single(),
      supabase
        .from("goals")
        .select(
          "id,title,domain,weekly_minutes,minimum_weekly_minutes,session_minutes,preferred_time,preferred_days,preferred_start,priority,deadline,status,dependencies,is_protected",
        )
        .eq("status", "active"),
    ]);
  if (profileError || !profile) throw new Error("Your planning preferences could not be loaded.");
  if (goalsError) throw new Error("Your goals could not be loaded.");

  const tz = profile.timezone || "UTC";
  const thisWeek = startOfWeek(new Date(), tz);
  const weekStart =
    data.week === "next" ? zonedInstant(addDaysKey(weekKeyOf(thisWeek, tz), 7), 0, tz) : thisWeek;
  const weekEnd = weekEndOf(weekStart, tz);
  const wsKey = weekKeyOf(weekStart, tz);
  const sched = { ...profile, commitments: await loadCommitments(supabase) };
  // §62 unsafe plan changes: goal wording is screened, and while training is stopped no exercise goal is scheduled.
  const safety = await import("./safety.server");
  await safety.screenText(userId, "plan_mutation", (goals ?? []).map((g) => g.title).join("\n"));
  const sp = await safety.currentPolicy(userId);
  const EXERCISE = new Set(["training", "fitness", "mobility"]);
  const split = planningGoals(
    (goals ?? []).filter((g) => !(sp.stopTraining && EXERCISE.has(g.domain))),
  );
  const { data: existing } = await supabase
    .from("plan_blocks")
    .select("id,goal_id,title,domain,starts_at,duration_min,status,is_protected,source_type")
    .gte("starts_at", weekStart.toISOString())
    .lt("starts_at", weekEnd.toISOString());
  const replaceable = (existing ?? []).filter((block) =>
    isReplanReplaceable(block, new Date().toISOString()),
  );
  const replaceIds = new Set(replaceable.map((b) => b.id));
  const fixed = (existing ?? []).filter(
    (b) =>
      !replaceIds.has(b.id) &&
      !["skipped", "replaced", "rescheduled", "blocked", "safety_stopped"].includes(b.status),
  );
  const histFrom = new Date(weekStart);
  histFrom.setDate(histFrom.getDate() - 56);
  const [{ data: history }, { data: energy }] = await Promise.all([
    supabase
      .from("plan_blocks")
      .select("domain,starts_at,status")
      .gte("starts_at", histFrom.toISOString())
      .lt("starts_at", weekStart.toISOString())
      .limit(1000),
    supabase
      .from("life_twin_facts")
      .select("fact_value")
      .eq("fact_key", "energy_pattern")
      .is("valid_until", null)
      .order("confidence", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const { data: standingVersion } = await supabase
    .from("plan_versions")
    .select("diff_summary")
    .eq("status", "approved")
    .in("apply_mode", ["permanent", "trial"])
    .order("approved_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const standingParsed = z
    .object({ proposed_blocks: z.array(blockShape) })
    .safeParse(standingVersion?.diff_summary);
  const standing = standingParsed.success
    ? standingParsed.data.proposed_blocks.map((b) => ({
        goal_id: b.goal_id,
        starts_at: b.starts_at,
      }))
    : [];
  const missPats = missPatterns(
    (history ?? []).map((h: { domain: string; starts_at: string; status: string }, i: number) => ({
      id: String(i),
      title: "",
      goal_id: null,
      duration_min: 0,
      ...h,
    })),
    tz,
  ).patterns;
  const planFrom = weekStart > new Date() ? weekStart : new Date();
  const opts = {
    fixed: fixed.map((b) => ({
      starts_at: b.starts_at,
      duration_min: b.duration_min,
      domain: b.domain,
      goal_id: b.goal_id,
    })),
    // Stability: current sessions, plus the last plan accepted for good or on trial ("this week only" plans don't set the pattern).
    previous: [
      ...replaceable.map((b) => ({ goal_id: b.goal_id, starts_at: b.starts_at })),
      ...standing,
    ],
    adherence: (() => {
      // Proven repeated-miss bands (≥3 misses, ≥60%) weigh more than the plain hourly rate.
      const base = adherenceByHour(history ?? [], tz);
      for (const [dom, hours] of Object.entries(patternAdherence(missPats)))
        base[dom] = { ...(base[dom] ?? {}), ...hours };
      return base;
    })(),
    energyPeak: energyPeakFrom(energy?.fact_value) ?? null,
    // Only the rest of the week is plannable; past days must not use up a goal's weekly sessions.
    notBefore: planFrom,
  };
  // Goals already covered by kept sessions need fewer new ones this week.
  const keptMin = new Map<string, number>();
  const nowIsoKept = new Date().toISOString();
  for (const b of fixed)
    if (b.goal_id && (b.starts_at >= nowIsoKept || ["done", "partial"].includes(b.status)))
      keptMin.set(b.goal_id, (keptMin.get(b.goal_id) ?? 0) + b.duration_min);
  // Goal Missions: a goal whose mission is blocked (open hard/unknown blocker or competing for the same time/money)
  // yields priority to unblocked goals, so its sessions never crowd out work that can actually move.
  const { data: blockedMissions } = await supabase
    .from("goal_missions")
    .select("goal_id,state,blockers")
    .eq("user_id", userId);
  const yieldGoals = new Set(
    (blockedMissions ?? [])
      .filter(
        (m: { state: string; blockers: unknown }) =>
          m.state === "BLOCKED" ||
          (Array.isArray(m.blockers) &&
            m.blockers.some((b: { kind?: string }) => b?.kind === "HARD" || b?.kind === "UNKNOWN")),
      )
      .map((m: { goal_id: string | null }) => m.goal_id)
      .filter(Boolean),
  );
  const remaining = split.ready
    .map((g) => ({
      ...g,
      ...(yieldGoals.has(g.id) ? { priority: Math.max(1, (g.priority ?? 3) - 1) } : {}),
      weekly_minutes: (() => {
        const left = Math.max(0, g.weekly_minutes - (keptMin.get(g.id) ?? 0));
        // Fixed-day goals (e.g. Mon/Wed/Fri): a session the member moved off its day still counts as that day's
        // session, so the vacated day is never refilled (moving tonight's workout must not duplicate it).
        if (!g.preferred_days?.length || !g.session_minutes) return left;
        const fromIdx = Math.max(0, Math.floor((planFrom.getTime() - weekStart.getTime()) / 864e5));
        const daysLeft = g.preferred_days.filter((d: number) => d - 1 >= fromIdx && d <= 7).length;
        return Math.min(left, Math.max(0, daysLeft * g.session_minutes - (keptMin.get(g.id) ?? 0)));
      })(),
    }))
    .filter((g) => g.weekly_minutes > 0);
  const result = buildWeekPlan(sched, remaining, weekStart, opts);
  const report = feasibilityReport(sched, split.ready, weekStart, planFrom);
  const { data: versions } = await supabase
    .from("plan_versions")
    .select("version")
    .eq("week_start", wsKey)
    .order("version", { ascending: false })
    .limit(1);
  const version = (versions?.[0]?.version ?? 0) + 1;
  const proposed = result.blocks.filter((block) => block.starts_at >= new Date().toISOString());
  const summary = {
    proposed_blocks: proposed,
    add_count: proposed.length,
    replace_count: replaceable.length,
    kept_count: (existing?.length ?? 0) - replaceable.length,
    unplaced: result.unplaced,
    demand_min: result.demandMin,
    usable_capacity_min: result.capacityMin,
    resilience_percent: 10,
    feasibility_report: report,
    waiting_goals: split.waiting.map((w) => ({
      goal_id: w.goal.id,
      title: w.goal.title,
      waiting_on: w.waitingOn,
    })),
  };

  // Plan snapshot reference: which Life Twin fact versions this plan was built from.
  const { data: twin } = await context.supabase
    .from("life_twin_facts")
    .select("id,fact_key,version")
    .is("valid_until", null);
  (summary as Record<string, unknown>)["twin_snapshot"] = (twin ?? []).map((t) => ({
    id: t.id,
    key: t.fact_key,
    v: t.version,
  }));
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("plan_versions")
    .update({ status: "superseded" })
    .eq("user_id", userId)
    .eq("week_start", wsKey)
    .eq("status", "proposed");
  const { data: proposal, error } = await supabaseAdmin
    .from("plan_versions")
    .insert({
      engine_versions: (await import("@/lib/versions")).PLAN_ENGINE_VERSIONS as never,
      user_id: userId,
      week_start: wsKey,
      version,
      status: "proposed",
      trigger,
      feasibility: report.level,
      explanation: report.explanation,
      diff_summary: summary,
      rationale: {
        version: LIFE_INTELLIGENCE_VERSION,
        patterns: missPats.map((p) => ({
          domain: p.domain,
          band: p.band,
          missed: p.missed,
          total: p.total,
        })),
        sessions: planRationale(proposed, {
          previous: opts.previous,
          energyPeak: opts.energyPeak ?? null,
          patterns: missPats,
          protectedDays: [],
          tz,
        }),
      } as never,
    })
    .select("id,version,feasibility,explanation,diff_summary")
    .single();
  if (error || !proposal) throw new Error("The plan proposal could not be saved.");
  await supabaseAdmin.from("audit_events").insert({
    user_id: userId,
    actor_type: "system",
    action: "plan.proposed",
    resource_type: "plan_version",
    resource_id: proposal.id,
    outcome: "succeeded",
    metadata: { trigger, version },
  });
  return proposal;
}

export async function applyProposal(
  supabase: any,
  userId: string,
  data: { proposalId: string; mode: "once" | "trial" | "permanent"; trialDays: number },
  actor: "user" | "system" = "user",
) {
  const { data: proposal, error } = await supabase
    .from("plan_versions")
    .select("*")
    .eq("id", data.proposalId)
    .eq("status", "proposed")
    .maybeSingle();
  if (error || !proposal) throw new Error("This proposal is no longer available.");
  const parsed = z
    .object({
      proposed_blocks: z.array(
        blockShape.extend({
          goal_id: z.string().uuid().nullable(),
          is_protected: z.boolean().optional(),
        }),
      ),
      coach_edit: z
        .object({
          member_overrides: z
            .array(
              z.object({
                id: z.string().uuid(),
                starts_at: z.string(),
                status: z.string(),
                is_protected: z.boolean(),
                source_type: z.string(),
              }),
            )
            .optional(),
          overdue_moves: z
            .array(z.object({ id: z.string().uuid(), starts_at: z.string(), status: z.string() }))
            .optional(),
        })
        .optional(),
    })
    .safeParse(proposal.diff_summary);
  if (!parsed.success) throw new Error("This proposal is invalid and was not applied.");
  const tz = await userZone(supabase, userId);
  const weekStart = zonedInstant(proposal.week_start, 0, tz);
  const weekEnd = zonedInstant(addDaysKey(proposal.week_start, 7), 0, tz);
  const nowIso = new Date().toISOString();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const memberOverrides = parsed.data.coach_edit?.member_overrides ?? [];
  // Only explicit, saved Coach targets can override protection; bulk/system paths never do.
  if (memberOverrides.length) {
    if (actor !== "user" || proposal.trigger !== "manual")
      throw new Error("Changing locked items needs your instruction.");
    for (const snapshot of memberOverrides) {
      const { data: block, error: readError } = await supabaseAdmin
        .from("plan_blocks")
        .select("id,starts_at,status,is_protected,source_type,commitment_id")
        .eq("user_id", userId)
        .eq("id", snapshot.id)
        .maybeSingle();
      if (
        readError ||
        !block ||
        block.commitment_id ||
        !["goal", "makeup", "recovery", "manual"].includes(block.source_type) ||
        block.source_type !== snapshot.source_type ||
        block.starts_at !== snapshot.starts_at ||
        block.status !== snapshot.status ||
        block.is_protected !== snapshot.is_protected ||
        ![
          "planned",
          "scheduled",
          "upcoming",
          "due",
          "contacting",
          "acknowledged",
          "snoozed",
        ].includes(block.status)
      ) {
        throw new Error(
          "That item has changed or is a fixed commitment. Ask Coach for a fresh edit.",
        );
      }
    }
    for (const snapshot of memberOverrides) {
      const { data: archived, error: archiveError } = await supabaseAdmin
        .from("plan_blocks")
        .update({ status: "rescheduled", note: "Changed by an explicit member Coach instruction" })
        .eq("user_id", userId)
        .eq("id", snapshot.id)
        .eq("starts_at", snapshot.starts_at)
        .eq("status", snapshot.status)
        .eq("is_protected", snapshot.is_protected)
        .select("id")
        .maybeSingle();
      if (archiveError || !archived)
        throw new Error("That item could not be changed. Ask Coach for a fresh edit.");
      const { error: eventError } = await supabaseAdmin.from("plan_block_events").insert({
        user_id: userId,
        block_id: snapshot.id,
        event_type: "rescheduled",
        from_status: snapshot.status,
        to_status: "rescheduled",
        reason_code: "approved_plan",
        metadata: { plan_version_id: proposal.id, explicit_member_lock_override: true },
      });
      if (eventError) throw new Error("The item change history could not be saved.");
    }
  }
  const overdueMoves = parsed.data.coach_edit?.overdue_moves ?? [];
  // Explicit late-session moves require member approval and a fresh state check;
  // automatic replans still leave all past sessions untouched.
  if (overdueMoves.length) {
    if (actor !== "user") throw new Error("Moving a late session needs your approval.");
    for (const snapshot of overdueMoves) {
      const { data: block, error: readError } = await supabaseAdmin
        .from("plan_blocks")
        .select("id,starts_at,status,is_protected,source_type,goal_id")
        .eq("user_id", userId)
        .eq("id", snapshot.id)
        .maybeSingle();
      if (
        readError ||
        !block ||
        block.is_protected ||
        !block.goal_id ||
        new Date(block.starts_at).getTime() !== new Date(snapshot.starts_at).getTime() ||
        block.status !== snapshot.status ||
        ![
          "planned",
          "scheduled",
          "upcoming",
          "due",
          "contacting",
          "acknowledged",
          "snoozed",
        ].includes(block.status) ||
        !["goal", "makeup", "recovery", "manual"].includes(block.source_type)
      ) {
        throw new Error(
          "That session has changed since this proposal. Ask Coach for a fresh move.",
        );
      }
    }
    for (const snapshot of overdueMoves) {
      const { data: archived, error: archiveError } = await supabaseAdmin
        .from("plan_blocks")
        .update({ status: "rescheduled", note: "Moved by an approved Coach plan version" })
        .eq("user_id", userId)
        .eq("id", snapshot.id)
        .eq("starts_at", snapshot.starts_at)
        .eq("status", snapshot.status)
        .eq("is_protected", false)
        .select("id")
        .maybeSingle();
      if (archiveError || !archived)
        throw new Error("That session could not be moved. Ask Coach for a fresh proposal.");
      const { error: eventError } = await supabaseAdmin.from("plan_block_events").insert({
        user_id: userId,
        block_id: snapshot.id,
        event_type: "rescheduled",
        from_status: snapshot.status,
        to_status: "rescheduled",
        reason_code: "approved_plan",
        metadata: {
          plan_version_id: proposal.id,
          explicit_late_move: true,
          original_starts_at: snapshot.starts_at,
        },
      });
      if (eventError) throw new Error("The session move history could not be saved.");
    }
  }
  const { data: replaced, error: replaceError } = await supabaseAdmin
    .from("plan_blocks")
    .update({ status: "rescheduled", note: "Replaced by an approved plan version" })
    .eq("user_id", userId)
    .in("status", [
      "planned",
      "scheduled",
      "upcoming",
      "due",
      "contacting",
      "acknowledged",
      "snoozed",
    ])
    .eq("is_protected", false)
    .in("source_type", ["goal", "makeup", "recovery", "manual"])
    // Only this proposal's own week: approving next week must never wipe the rest of this week.
    .gte("starts_at", weekStart.toISOString() > nowIso ? weekStart.toISOString() : nowIso)
    .lt("starts_at", weekEnd.toISOString())
    .select("id");
  if (replaceError) throw new Error("The existing plan could not be archived.");
  if (replaced?.length)
    await supabaseAdmin.from("plan_block_events").insert(
      replaced.map((block) => ({
        user_id: userId,
        block_id: block.id,
        event_type: "rescheduled",
        from_status: "planned",
        to_status: "rescheduled",
        reason_code: "approved_plan",
        metadata: { plan_version_id: proposal.id },
      })),
    );
  if (replaced?.length || memberOverrides.length) {
    // Accountability calls booked for sessions that this version replaced must not ring (or double up with the new ones).
    const gone = new Set([
      ...(replaced ?? []).map((b: { id: string }) => b.id),
      ...memberOverrides.map((b) => b.id),
    ]);
    const { data: sc } = await supabaseAdmin
      .from("scheduled_calls")
      .select("id,dedupe_key")
      .eq("user_id", userId)
      .eq("status", "scheduled")
      .like("dedupe_key", "session:%");
    const stale = (sc ?? [])
      .filter((c: { dedupe_key: string | null }) =>
        gone.has(String(c.dedupe_key).split(":")[1] ?? ""),
      )
      .map((c: { id: string }) => c.id);
    if (stale.length)
      await supabaseAdmin
        .from("scheduled_calls")
        .update({ status: "cancelled", status_reason: "session_replaced" })
        .in("id", stale);
  }
  // One intended occurrence = one session: never add a block outside this version's week, nor one that duplicates a
  // live session of the same goal at an overlapping time (that session already fulfils it).
  const { data: liveNow } = await supabaseAdmin
    .from("plan_blocks")
    .select("goal_id,starts_at,duration_min")
    .eq("user_id", userId)
    .in("status", [
      "planned",
      "scheduled",
      "upcoming",
      "due",
      "contacting",
      "acknowledged",
      "snoozed",
      "started",
      "in_progress",
    ])
    .gte("starts_at", new Date(weekStart.getTime() - 864e5).toISOString())
    .lt("starts_at", new Date(weekEnd.getTime() + 864e5).toISOString());
  const overlapsSameGoal = (b: {
    goal_id?: string | null;
    starts_at: string;
    duration_min: number;
  }) =>
    !!b.goal_id &&
    (liveNow ?? []).some(
      (x: { goal_id: string | null; starts_at: string; duration_min: number }) => {
        if (x.goal_id !== b.goal_id) return false;
        const a0 = new Date(x.starts_at).getTime(),
          b0 = new Date(b.starts_at).getTime();
        return a0 < b0 + b.duration_min * 60000 && b0 < a0 + x.duration_min * 60000;
      },
    );
  const toAdd = parsed.data.proposed_blocks.filter(
    (b) =>
      b.starts_at >= weekStart.toISOString() &&
      b.starts_at < weekEnd.toISOString() &&
      !overlapsSameGoal(b as never),
  );
  if (toAdd.length) {
    const { error: insertError } = await supabaseAdmin.from("plan_blocks").insert(
      toAdd.map((block) => ({
        ...block,
        is_protected: block.is_protected ?? false,
        note: block.note ?? null,
        user_id: userId,
        plan_version_id: proposal.id,
        occurrence_kind: kindForDomain(block.domain, block.title),
        source_type: sourceForBlock(block),
        source_ref: block.note?.startsWith("makeup:") ? block.note : null,
      })),
    );
    if (insertError) throw new Error("The approved sessions could not be created.");
  }
  await supabaseAdmin
    .from("plan_versions")
    .update({ status: "superseded" })
    .eq("user_id", userId)
    .eq("week_start", proposal.week_start)
    .eq("status", "approved");
  const { error: approveError } = await supabaseAdmin
    .from("plan_versions")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      apply_mode: data.mode,
      trial_until:
        data.mode === "trial"
          ? new Date(Date.now() + data.trialDays * 864e5).toISOString().slice(0, 10)
          : null,
    })
    .eq("id", proposal.id)
    .eq("status", "proposed");
  if (approveError) throw new Error("The plan could not be approved.");
  await syncRoutines(supabase, supabaseAdmin, userId, weekStart);
  await supabaseAdmin.from("audit_events").insert({
    user_id: userId,
    actor_type: actor,
    action: actor === "user" ? "plan.approved" : "plan.auto_applied",
    resource_type: "plan_version",
    resource_id: proposal.id,
    outcome: "succeeded",
    metadata: { version: proposal.version, mode: data.mode },
  });
  // V3 §69 PLAN_CHANGED: one notice per approved version, delivered per the user's channel choices.
  try {
    const { enqueueNotification } = await import("@/lib/notify.server");
    await enqueueNotification(supabaseAdmin, {
      userId,
      category: "PLAN_CHANGED",
      intent: actor === "user" ? "plan_approved" : "plan_auto_applied",
      planVersionId: proposal.id,
      title: `Plan version ${proposal.version} is now active`,
      body: `${parsed.data.proposed_blocks.length} sessions were added to your week.`,
      link: "/app/plan",
      dedupe: ["plan", proposal.id],
    });
  } catch (e) {
    console.error("plan notice", e);
  }
  return { ok: true, blocksCreated: parsed.data.proposed_blocks.length };
}

export const approveWeekPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        proposalId: z.string().uuid(),
        mode: z.enum(["once", "trial", "permanent"]).default("permanent"),
        trialDays: z.number().int().min(3).max(56).default(14),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const r = await applyProposal(context.supabase, context.userId, data);
    void (await import("./observability.server")).track("plan_approved", context.userId, {
      mode: data.mode,
    });
    return r;
  });

const idem = { idempotencyKey: z.string().trim().min(8).max(100).optional() };
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    blockId: z.string().uuid(),
    action: z.literal("acknowledge"),
    note: z.string().trim().max(500).optional(),
    ...idem,
  }),
  z.object({
    blockId: z.string().uuid(),
    action: z.literal("start"),
    note: z.string().trim().max(500).optional(),
    ...idem,
  }),
  z.object({
    blockId: z.string().uuid(),
    action: z.literal("complete"),
    note: z.string().trim().max(500).optional(),
    ...idem,
  }),
  z.object({
    blockId: z.string().uuid(),
    action: z.literal("partial"),
    missedReason: z.enum(MISSED_REASONS),
    note: z.string().trim().max(500).optional(),
    ...idem,
  }),
  z.object({
    blockId: z.string().uuid(),
    action: z.literal("blocked"),
    missedReason: z.enum(MISSED_REASONS),
    note: z.string().trim().max(500).optional(),
    ...idem,
  }),
  z.object({
    blockId: z.string().uuid(),
    action: z.literal("skip"),
    missedReason: z.enum(MISSED_REASONS),
    note: z.string().trim().max(500).optional(),
    ...idem,
  }),
  z.object({
    blockId: z.string().uuid(),
    action: z.literal("safety_stop"),
    note: z.string().trim().min(1).max(500),
    ...idem,
  }),
  z.object({
    blockId: z.string().uuid(),
    action: z.literal("snooze"),
    minutes: z.number().int().min(5).max(120),
    note: z.string().trim().max(500).optional(),
    ...idem,
  }),
  z.object({
    blockId: z.string().uuid(),
    action: z.literal("restore"),
    note: z.string().trim().max(500).optional(),
    ...idem,
  }),
  z.object({
    blockId: z.string().uuid(),
    action: z.literal("cancel"),
    note: z.string().trim().min(1).max(500),
    ...idem,
  }),
]);
export type PlanBlockActionInput = z.infer<typeof actionSchema>;

/** All execution transitions go through execution.ts (V3 §38); invalid ones fail with EXECUTION_TRANSITION_INVALID (409). */
export const transitionPlanBlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => actionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { ACTION_TARGET, assertTransition } = await import("./execution");
    const { data: block, error } = await context.supabase
      .from("plan_blocks")
      .select("*")
      .eq("id", data.blockId)
      .maybeSingle();
    if (error || !block) throw new Error("That session could not be found.");
    void (await import("./observability.server")).track("session_action", context.userId, {
      action: data.action,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.idempotencyKey) {
      const { data: prior } = await supabaseAdmin
        .from("plan_block_events")
        .select("to_status")
        .eq("user_id", context.userId)
        .eq("idempotency_key", data.idempotencyKey)
        .maybeSingle();
      if (prior) return { ok: true, status: prior.to_status, duplicate: true };
    }
    const next = ACTION_TARGET[data.action];
    assertTransition(block.status, next);
    const now = new Date();
    const patch: Database["public"]["Tables"]["plan_blocks"]["Update"] = {
      status: next,
      evidence: next === "done" ? "self_reported" : next === "planned" ? "unknown" : block.evidence,
      note: data.note ?? null,
    };
    if (data.action === "start") patch["started_at"] = now.toISOString();
    if (data.action === "complete") patch["completed_at"] = now.toISOString();
    if (data.action === "restore") {
      patch["started_at"] = null;
      patch["completed_at"] = null;
    }
    if (data.action === "snooze") {
      const moved = new Date(Math.max(new Date(block.starts_at).getTime(), now.getTime()));
      moved.setMinutes(moved.getMinutes() + data.minutes);
      patch["starts_at"] = moved.toISOString();
      patch["interruption_count"] = block.interruption_count + 1;
    }
    const { error: updateError } = await supabaseAdmin
      .from("plan_blocks")
      .update(patch)
      .eq("id", block.id)
      .eq("user_id", context.userId);
    if (updateError)
      throw new Error(
        updateError.message.includes("EXECUTION_TRANSITION_INVALID")
          ? updateError.message
          : "The session could not be updated.",
      );
    await supabaseAdmin.from("plan_block_events").insert({
      user_id: context.userId,
      block_id: block.id,
      event_type: data.action,
      from_status: block.status,
      to_status: next,
      reason_code: data.action,
      missed_reason: "missedReason" in data ? data.missedReason : null,
      note: data.note ?? null,
      actor_type: "user",
      actor_id: context.userId,
      source_channel: "app",
      idempotency_key: data.idempotencyKey ?? null,
      metadata: data.action === "snooze" ? { minutes: data.minutes } : {},
    });
    if ("missedReason" in data && SAFETY_REASON[data.missedReason])
      await (
        await import("./safety.server")
      ).recordSafety(context.userId, "training", "input", ["pain"]);
    const evidenceClass =
      next === "done" || next === "partial"
        ? await (
            await import("./verification.server")
          ).verifyBlock(supabaseAdmin, context.userId, block.id)
        : "unknown";
    if (data.action === "complete")
      await supabaseAdmin.from("outcome_ledger").insert({
        user_id: context.userId,
        goal_id: block.goal_id,
        domain: block.domain,
        metric: "session_completed",
        value: 1,
        unit: "session",
        evidence_class: evidenceClass,
        source: "execution_action",
        observed_at: now.toISOString(),
        metadata: { block_id: block.id, duration_min: block.duration_min },
      });
    return { ok: true, status: next, duplicate: false };
  });
/** Proposes catch-up times for this week's missed sessions (skipped, blocked, partial or passed while still planned).
 *  Placement is deterministic (scheduler.placeMakeups) and nothing changes until approveWeekPlan. */
export const proposeMakeups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const now = new Date();
    const tz = await userZone(supabase, userId);
    const weekStart = startOfWeek(now, tz);
    const weekEnd = weekEndOf(weekStart, tz);
    const wsKey = weekKeyOf(weekStart, tz);
    const [{ data: profile }, { data: blocks }, { data: goals }] = await Promise.all([
      supabase
        .from("profiles")
        .select("wake_time,sleep_time,work_start,work_end,work_days,timezone")
        .eq("id", userId)
        .single(),
      supabase
        .from("plan_blocks")
        .select("id,goal_id,title,domain,starts_at,duration_min,status,note")
        .gte("starts_at", weekStart.toISOString())
        .lt("starts_at", weekEnd.toISOString()),
      supabase.from("goals").select("id,preferred_time,status"),
    ]);
    if (!profile) throw new Error("Your planning preferences could not be loaded.");
    const nowIso = now.toISOString();
    const all = blocks ?? [];
    const madeUp = new Set(
      all.filter((b) => b.note?.startsWith("makeup:")).map((b) => b.note!.slice(7)),
    );
    const activeGoals = new Map(
      (goals ?? []).filter((g) => g.status === "active").map((g) => [g.id, g]),
    );
    const missed = all.filter(
      (b) =>
        b.goal_id &&
        activeGoals.has(b.goal_id) &&
        !madeUp.has(b.id) &&
        b.status !== "safety_stopped" &&
        (["skipped", "blocked", "partial"].includes(b.status) ||
          b.status === "expired" ||
          ([
            "planned",
            "scheduled",
            "upcoming",
            "due",
            "contacting",
            "acknowledged",
            "snoozed",
          ].includes(b.status) &&
            new Date(b.starts_at).getTime() + b.duration_min * 60000 < now.getTime())),
    );
    const future = all.filter(
      (b) => b.starts_at >= nowIso && !["rescheduled", "skipped"].includes(b.status),
    );
    const { placed, unplaced } = placeMakeups(
      { ...profile, commitments: await loadCommitments(supabase) },
      weekStart,
      now,
      future.map((b) => ({ starts_at: b.starts_at, duration_min: b.duration_min })),
      missed.map((b) => ({
        goal_id: b.goal_id!,
        title: b.title,
        domain: b.domain,
        duration_min: b.duration_min,
        preferred_time: activeGoals.get(b.goal_id!)?.preferred_time,
        source_id: b.id,
      })),
    );
    if (!missed.length) return { proposal: null, missed: 0 };
    // Keep every existing future planned session unchanged; add catch-ups.
    const keep = future
      .filter(
        (b) =>
          [
            "planned",
            "scheduled",
            "upcoming",
            "due",
            "contacting",
            "acknowledged",
            "snoozed",
          ].includes(b.status) && b.goal_id,
      )
      .map((b) => ({
        goal_id: b.goal_id!,
        title: b.title,
        domain: b.domain,
        starts_at: b.starts_at,
        duration_min: b.duration_min,
      }));
    const proposed = [
      ...keep,
      ...placed.map((p) => ({ ...p, title: `Catch-up: ${p.title}` })),
    ].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const { data: versions } = await supabase
      .from("plan_versions")
      .select("version")
      .eq("week_start", wsKey)
      .order("version", { ascending: false })
      .limit(1);
    const version = (versions?.[0]?.version ?? 0) + 1;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("plan_versions")
      .update({ status: "superseded" })
      .eq("user_id", userId)
      .eq("week_start", wsKey)
      .eq("status", "proposed");
    const explanation = placed.length
      ? `${placed.length} missed session${placed.length > 1 ? "s" : ""} fitted back into free time this week${unplaced.length ? `; ${unplaced.length} couldn't fit without breaking your limits` : ""}`
      : "No free time is left this week to catch up without breaking your limits";
    const { data: proposal, error } = await supabaseAdmin
      .from("plan_versions")
      .insert({
        engine_versions: (await import("@/lib/versions")).PLAN_ENGINE_VERSIONS as never,
        user_id: userId,
        week_start: wsKey,
        version,
        status: "proposed",
        trigger: "system",
        feasibility: unplaced.length ? (placed.length ? "partial" : "infeasible") : "feasible",
        explanation,
        diff_summary: {
          proposed_blocks: proposed,
          add_count: placed.length,
          replace_count: 0,
          kept_count: keep.length,
          makeup_sources: missed.map((m) => m.id),
          unplaced: unplaced.map((u) => ({
            goal_id: u.goal_id,
            title: u.title,
            minutes: u.duration_min,
          })),
          resilience_percent: 10,
        },
      })
      .select("id,version")
      .single();
    if (error || !proposal) throw new Error("The catch-up proposal could not be saved.");
    await supabaseAdmin.from("audit_events").insert({
      user_id: userId,
      actor_type: "system",
      action: "plan.makeups_proposed",
      resource_type: "plan_version",
      resource_id: proposal.id,
      outcome: "succeeded",
      metadata: { placed: placed.length, unplaced: unplaced.length },
    });
    // Auto-Adapt (V3 §37): apply without asking only when every catch-up stays inside the user's granted move bounds.
    const { toMap, movesWithinBounds } = await import("./auto-adapt");
    const { data: permRows } = await supabase
      .from("auto_adapt_permissions")
      .select("permission,enabled");
    const srcStart = new Map(missed.map((m) => [m.id, m.starts_at]));
    const moves = placed.map((p) => ({
      from: srcStart.get((p.note ?? "").replace("makeup:", "")) ?? null,
      to: p.starts_at,
    }));
    const { data: rp } = await supabaseAdmin
      .from("profiles")
      .select("processing_restricted")
      .eq("id", userId)
      .maybeSingle();
    if (
      !rp?.processing_restricted &&
      !unplaced.length &&
      movesWithinBounds(moves, toMap(permRows))
    ) {
      await applyProposal(
        supabase,
        userId,
        { proposalId: proposal.id, mode: "once", trialDays: 14 },
        "system",
      );
      return { proposal, missed: missed.length, placed: placed.length, autoApplied: true };
    }
    return { proposal, missed: missed.length, placed: placed.length, autoApplied: false };
  });

export const proposeRecoveryAdaptation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await (
      await import("./entitlements.server")
    ).requireCapability(supabase, userId, "recovery_mode");
    const { assessRecovery, adaptForRecovery, RECOVERY_ADAPT_VERSION } =
      await import("./recovery-state");
    const now = new Date();
    const tz = await userZone(supabase, userId);
    const today = localDayKey(now, tz);
    const weekStart = startOfWeek(now, tz);
    const weekEnd = weekEndOf(weekStart, tz);
    const endOfToday = localDayRange(now, tz)[1];
    const since48 = new Date(now.getTime() - 48 * 36e5).toISOString();
    const [{ data: checkin }, { data: sleep }, { count: hard }, { data: blocks }] =
      await Promise.all([
        supabase
          .from("recovery_checkins")
          .select("sleep_quality,energy,soreness,stress,ill_or_injured")
          .eq("check_date", today)
          .maybeSingle(),
        supabase
          .from("health_samples")
          .select("value")
          .eq("is_deleted", false)
          .eq("kind", "sleep_hours")
          .gte("recorded_at", new Date(now.getTime() - 24 * 36e5).toISOString())
          .order("recorded_at", { ascending: false })
          .limit(1),
        supabase
          .from("plan_blocks")
          .select("id", { count: "exact", head: true })
          .in("domain", ["training", "cardio"])
          .eq("status", "done")
          .gte("completed_at", since48),
        supabase
          .from("plan_blocks")
          .select("id,goal_id,title,domain,starts_at,duration_min,status,is_protected,note")
          .in("status", [
            "planned",
            "scheduled",
            "upcoming",
            "due",
            "contacting",
            "acknowledged",
            "snoozed",
          ])
          .gte("starts_at", now.toISOString())
          .lt("starts_at", weekEnd.toISOString()),
      ]);
    const [{ data: prof }, { count: missed }] = await Promise.all([
      supabase.from("profiles").select("sleep_target_hours").eq("id", userId).maybeSingle(),
      supabase
        .from("plan_blocks")
        .select("id", { count: "exact", head: true })
        .in("status", ["missed", "skipped"])
        .gte("starts_at", since48)
        .lt("starts_at", now.toISOString()),
    ]);
    const a = assessRecovery({
      checkin: checkin ?? null,
      sleepHours: sleep?.[0] ? Number(sleep[0].value) : null,
      recentHardSessions: hard ?? 0,
      sleepTargetHours: prof?.sleep_target_hours ?? 8,
      executionMissed48h: missed ?? 0,
    });
    if (a.state !== "RED" && a.state !== "AMBER")
      return { state: a.state, proposal: null, changes: 0 };
    const future = (blocks ?? []).filter((b) => b.goal_id);
    const todays = future.filter((b) => new Date(b.starts_at) < endOfToday);
    const { blocks: adapted, changes } = adaptForRecovery(
      a.state,
      todays.map((b) => ({ ...b, goal_id: b.goal_id! })),
    );
    if (!changes.length) return { state: a.state, proposal: null, changes: 0 };
    const adaptedById = new Map(adapted.map((b) => [b.id, b]));
    // Only unprotected sessions are replaced on approval, so protected ones are left out of the proposal.
    const proposed = future
      .filter((b) => !b.is_protected)
      .map((b) => {
        const x = adaptedById.get(b.id) ?? b;
        return {
          goal_id: x.goal_id!,
          title: x.title,
          domain: x.domain,
          starts_at: x.starts_at,
          duration_min: x.duration_min,
          ...(b.note ? { note: b.note.slice(0, 200) } : {}),
        };
      });
    const ws = weekKeyOf(weekStart, tz);
    const { data: versions } = await supabase
      .from("plan_versions")
      .select("version")
      .eq("week_start", ws)
      .order("version", { ascending: false })
      .limit(1);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("plan_versions")
      .update({ status: "superseded" })
      .eq("user_id", userId)
      .eq("week_start", ws)
      .eq("status", "proposed");
    const explanation =
      a.state === "RED"
        ? `Recovery is RED (${a.reasons.join(", ")}). Hard sessions today become easy recovery work and long tasks are shortened.`
        : `Recovery is AMBER (${a.reasons.join(", ")}). Today's hard sessions are shortened to an easier version.`;
    const { data: proposal, error } = await supabaseAdmin
      .from("plan_versions")
      .insert({
        engine_versions: (await import("@/lib/versions")).PLAN_ENGINE_VERSIONS as never,
        user_id: userId,
        week_start: ws,
        version: (versions?.[0]?.version ?? 0) + 1,
        status: "proposed",
        trigger: "recovery",
        feasibility: "feasible",
        explanation,
        diff_summary: {
          proposed_blocks: proposed,
          add_count: 0,
          replace_count: changes.length,
          kept_count: proposed.length - changes.length,
          recovery_state: a.state,
          changes,
          rule_version: RECOVERY_ADAPT_VERSION,
          resilience_percent: 10,
        },
      })
      .select("id,version")
      .single();
    if (error || !proposal) throw new Error("The recovery change could not be saved.");
    await supabaseAdmin.from("audit_events").insert({
      user_id: userId,
      actor_type: "system",
      action: "plan.recovery_adaptation_proposed",
      resource_type: "plan_version",
      resource_id: proposal.id,
      outcome: "succeeded",
      metadata: { state: a.state, changes: changes.length },
    });
    return { state: a.state, proposal, changes: changes.length };
  });

export const rejectWeekPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ proposalId: z.string().uuid(), note: z.string().trim().max(300).optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: proposal } = await supabase
      .from("plan_versions")
      .select("id,version")
      .eq("id", data.proposalId)
      .eq("status", "proposed")
      .maybeSingle();
    if (!proposal) throw new Error("This proposal is no longer available.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("plan_versions")
      .update({ status: "rejected", decision_note: data.note || null })
      .eq("id", proposal.id)
      .eq("status", "proposed");
    if (error) throw new Error("The proposal could not be rejected.");
    await supabaseAdmin.from("audit_events").insert({
      user_id: userId,
      actor_type: "user",
      action: "plan.rejected",
      resource_type: "plan_version",
      resource_id: proposal.id,
      outcome: "succeeded",
      metadata: { version: proposal.version },
    });
    return { ok: true };
  });

/** Ends a trial: keep makes it permanent; revert proposes the previously accepted placements again (needs approval). */
export const endPlanTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ versionId: z.string().uuid(), keep: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: v } = await supabase
      .from("plan_versions")
      .select("*")
      .eq("id", data.versionId)
      .eq("apply_mode", "trial")
      .maybeSingle();
    if (!v) throw new Error("This trial is no longer active.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("plan_versions")
      .update({ apply_mode: data.keep ? "permanent" : "once", trial_until: null })
      .eq("id", v.id);
    await supabaseAdmin.from("audit_events").insert({
      user_id: userId,
      actor_type: "user",
      action: data.keep ? "plan.trial_kept" : "plan.trial_reverted",
      resource_type: "plan_version",
      resource_id: v.id,
      outcome: "succeeded",
      metadata: {},
    });
    if (data.keep) return { ok: true, proposalId: null };
    const { data: prior } = await supabase
      .from("plan_versions")
      .select("version,diff_summary")
      .not("approved_at", "is", null)
      .neq("id", v.id)
      .lt("created_at", v.created_at)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const parsed = z
      .object({ proposed_blocks: z.array(blockShape) })
      .safeParse(prior?.diff_summary);
    if (!prior || !parsed.success)
      throw new Error("There is no earlier accepted plan to go back to.");
    // Map earlier placements onto the current week by weekday and time; only future times.
    const tz = await userZone(supabase, userId);
    const ws = weekKeyOf(new Date(), tz);
    const now = new Date().toISOString();
    const blocks = parsed.data.proposed_blocks
      .map((b) => {
        const o = zonedParts(b.starts_at, tz);
        return {
          ...b,
          starts_at: zonedInstant(addDaysKey(ws, o.isoDow - 1), o.minutes, tz).toISOString(),
        };
      })
      .filter((b) => b.starts_at >= now);
    const { data: last } = await supabase
      .from("plan_versions")
      .select("version")
      .eq("week_start", ws)
      .order("version", { ascending: false })
      .limit(1);
    await supabaseAdmin
      .from("plan_versions")
      .update({ status: "superseded" })
      .eq("user_id", userId)
      .eq("week_start", ws)
      .eq("status", "proposed");
    const { data: proposal, error } = await supabaseAdmin
      .from("plan_versions")
      .insert({
        engine_versions: (await import("@/lib/versions")).PLAN_ENGINE_VERSIONS as never,
        user_id: userId,
        week_start: ws,
        version: (last?.[0]?.version ?? 0) + 1,
        status: "proposed",
        trigger: "manual",
        feasibility: "feasible",
        explanation: `Trial ended: going back to the placements from plan v${prior.version}`,
        diff_summary: {
          proposed_blocks: blocks,
          add_count: blocks.length,
          replace_count: 0,
          kept_count: 0,
          unplaced: [],
          reverted_from: v.id,
        },
      })
      .select("id")
      .single();
    if (error || !proposal) throw new Error("The earlier plan could not be proposed.");
    return { ok: true, proposalId: proposal.id };
  });

/** "Never auto-change": pins a goal's upcoming sessions so no proposal moves them. */
export const lockGoalSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ goalId: z.string().uuid(), locked: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: goal } = await supabase
      .from("goals")
      .select("id,title")
      .eq("id", data.goalId)
      .maybeSingle();
    if (!goal) throw new Error("Goal not found.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const property = `goal:${goal.id}:schedule`;
    const nowIso = new Date().toISOString();
    if (data.locked) {
      await supabaseAdmin
        .from("plan_property_locks")
        .upsert(
          { user_id: userId, property, label: `Session times for "${goal.title}"` },
          { onConflict: "user_id,property" },
        );
    } else {
      await supabaseAdmin
        .from("plan_property_locks")
        .delete()
        .eq("user_id", userId)
        .eq("property", property);
    }
    await supabaseAdmin
      .from("plan_blocks")
      .update({ is_protected: data.locked })
      .eq("user_id", userId)
      .eq("goal_id", goal.id)
      .in("status", [
        "planned",
        "scheduled",
        "upcoming",
        "due",
        "contacting",
        "acknowledged",
        "snoozed",
      ])
      .gte("starts_at", nowIso);
    await supabaseAdmin.from("audit_events").insert({
      user_id: userId,
      actor_type: "user",
      action: data.locked ? "plan.lock_added" : "plan.lock_removed",
      resource_type: "goal",
      resource_id: goal.id,
      outcome: "succeeded",
      metadata: { property },
    });
    return { ok: true };
  });

// Recovery Mode (V3 §21): repair a disrupted day as a reviewable proposal. Commitments are never touched.
export const proposeDayRepair = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        reason: z.enum(["ill", "overran", "family", "travel", "low_energy", "emergency", "other"]),
        blockedUntil: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable(),
        note: z.string().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await (
      await import("./entitlements.server")
    ).requireCapability(supabase, userId, "recovery_mode");
    const { repairDay, RECOVERY_MODE_VERSION, DISRUPTION_REASONS } =
      await import("./recovery-mode");
    const { commitmentBusy, toMin } = await import("./scheduler");
    const now = new Date();
    const tz = await userZone(supabase, userId);
    const todayKey = localDayKey(now, tz);
    const [dayStart, dayEnd] = localDayRange(now, tz);
    const weekStart = startOfWeek(now, tz);
    const weekEnd = weekEndOf(weekStart, tz);
    const [{ data: profile }, { data: blocks }, { data: goals }, commitments] = await Promise.all([
      supabase
        .from("profiles")
        .select("wake_time,sleep_time,work_start,work_end,work_days,timezone")
        .eq("id", userId)
        .single(),
      supabase
        .from("plan_blocks")
        .select(
          "id,goal_id,title,domain,starts_at,duration_min,status,is_protected,source_type,note",
        )
        .gte("starts_at", dayStart.toISOString())
        .lt("starts_at", weekEnd.toISOString()),
      supabase.from("goals").select("id,priority,is_protected,deadline,preferred_time,status"),
      loadCommitments(supabase),
    ]);
    if (!profile) throw new Error("Your planning preferences could not be loaded.");
    const nz = zonedParts(now, tz);
    const all = blocks ?? [];
    const todays = all.filter((b) => new Date(b.starts_at) < dayEnd);
    const blockedUntilMin = data.blockedUntil
      ? (toMin(data.blockedUntil) ?? nz.minutes)
      : nz.minutes;
    const { items, availableMin } = repairDay({
      nowMin: nz.minutes,
      blockedUntilMin,
      sleepMin: toMin(profile.sleep_time) ?? 1380,
      wakeMin: toMin(profile.wake_time) ?? 420,
      busy: commitmentBusy(commitments, nz.isoDow, todayKey),
      todayKey,
      reason: data.reason,
      blocks: todays.map((b) => ({
        id: b.id,
        goal_id: b.goal_id,
        title: b.title,
        domain: b.domain,
        start: zonedParts(b.starts_at, tz).minutes,
        duration: b.duration_min,
        status: b.status,
        is_protected: b.is_protected,
        source_type: b.source_type,
      })),
      goals: (goals ?? []).map((g) => ({
        id: g.id,
        priority: g.priority,
        is_protected: g.is_protected,
        deadline: g.deadline,
      })),
    });
    const changed = items.filter((i) => i.action !== "kept" && i.action !== "frozen");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_events").insert({
      user_id: userId,
      actor_type: "user",
      action: "day.disrupted",
      resource_type: "day",
      resource_id: todayKey,
      outcome: "succeeded",
      metadata: {
        reason: data.reason,
        blocked_until: data.blockedUntil,
        note: data.note ?? null,
      },
    });
    if (!changed.length) return { proposal: null, items, availableMin, autoApplied: false };
    // Deferred work goes to the next free slot later this week (never today, never on top of existing sessions).
    const nowIso = now.toISOString();
    const open = [
      "planned",
      "scheduled",
      "upcoming",
      "due",
      "contacting",
      "acknowledged",
      "snoozed",
    ];
    const later = all.filter((b) => new Date(b.starts_at) >= dayEnd && open.includes(b.status));
    const deferred = items.filter((i) => i.action === "deferred");
    const pref = new Map((goals ?? []).map((g) => [g.id, g.preferred_time]));
    const repairedToday = items.filter(
      (i) => i.goal_id && i.toStart != null && ["kept", "moved", "shortened"].includes(i.action),
    );
    const { placed, unplaced } = placeMakeups(
      { ...profile, commitments },
      weekStart,
      dayEnd,
      [
        ...later,
        ...repairedToday.map((i) => ({
          starts_at: zonedInstant(todayKey, i.toStart!, tz).toISOString(),
          duration_min: i.toDuration!,
        })),
      ],
      deferred.map((i) => ({
        goal_id: i.goal_id!,
        title: i.title,
        domain: i.domain,
        duration_min: i.fromDuration,
        preferred_time: pref.get(i.goal_id!),
        source_id: i.id,
      })),
    );
    const original = new Map(todays.map((b) => [b.id, b]));
    const proposed = [
      ...repairedToday.map((i) => {
        const o = original.get(i.id);
        return {
          goal_id: i.goal_id!,
          title:
            i.action === "shortened" && !i.title.includes("(shorter)")
              ? `${i.title} (shorter)`.slice(0, 160)
              : i.title,
          domain: i.domain,
          starts_at: zonedInstant(todayKey, i.toStart!, tz).toISOString(),
          duration_min: i.toDuration!,
          ...(o?.note ? { note: o.note.slice(0, 200) } : {}),
        };
      }),
      ...later
        .filter(
          (b) =>
            b.goal_id &&
            !b.is_protected &&
            ["goal", "makeup", "recovery", "manual"].includes(b.source_type),
        )
        .map((b) => ({
          goal_id: b.goal_id!,
          title: b.title,
          domain: b.domain,
          starts_at: b.starts_at,
          duration_min: b.duration_min,
          ...(b.note ? { note: b.note.slice(0, 200) } : {}),
        })),
      ...placed.map((p) => ({
        goal_id: p.goal_id,
        title: p.title,
        domain: p.domain,
        starts_at: p.starts_at,
        duration_min: p.duration_min,
        ...(p.note ? { note: p.note } : {}),
      })),
    ].filter((b) => b.starts_at >= nowIso);
    const placedById = new Map(
      placed.map((p) => [(p.note ?? "").replace("makeup:", ""), p.starts_at]),
    );
    const diff = items.map((i) => ({
      ...i,
      deferredTo: i.action === "deferred" ? (placedById.get(i.id) ?? null) : null,
    }));
    const ws = weekKeyOf(weekStart, tz);
    const { data: versions } = await supabase
      .from("plan_versions")
      .select("version")
      .eq("week_start", ws)
      .order("version", { ascending: false })
      .limit(1);
    await supabaseAdmin
      .from("plan_versions")
      .update({ status: "superseded" })
      .eq("user_id", userId)
      .eq("week_start", ws)
      .eq("status", "proposed");
    const label = DISRUPTION_REASONS[data.reason];
    const explanation = `Day repair (${label}${data.blockedUntil ? `, busy until ${data.blockedUntil}` : ""}): ${changed.length} session${changed.length > 1 ? "s" : ""} changed, finished and protected sessions and commitments left alone, the hour before bed kept free${unplaced.length ? `; ${unplaced.length} couldn't fit this week` : ""}.`;
    const { data: proposal, error } = await supabaseAdmin
      .from("plan_versions")
      .insert({
        engine_versions: (await import("@/lib/versions")).PLAN_ENGINE_VERSIONS as never,
        user_id: userId,
        week_start: ws,
        version: (versions?.[0]?.version ?? 0) + 1,
        status: "proposed",
        trigger: "recovery",
        feasibility: unplaced.length ? "partial" : "feasible",
        explanation,
        diff_summary: {
          proposed_blocks: proposed,
          add_count: placed.length,
          replace_count: changed.length,
          kept_count: items.length - changed.length,
          day_repair: {
            reason: data.reason,
            blocked_until: data.blockedUntil,
            note: data.note ?? null,
            available_min: availableMin,
            items: diff,
          },
          unplaced: unplaced.map((u) => ({
            goal_id: u.goal_id,
            title: u.title,
            minutes: u.duration_min,
          })),
          rule_version: RECOVERY_MODE_VERSION,
          resilience_percent: 10,
        },
      })
      .select("id,version")
      .single();
    if (error || !proposal) throw new Error("The day repair could not be saved.");
    await supabaseAdmin.from("audit_events").insert({
      user_id: userId,
      actor_type: "system",
      action: "plan.day_repair_proposed",
      resource_type: "plan_version",
      resource_id: proposal.id,
      outcome: "succeeded",
      metadata: { reason: data.reason, changed: changed.length },
    });
    // 9. Apply automatically only when every change is a same-day move the user has allowed; shortening or deferring always needs approval.
    const { toMap, movesWithinBounds } = await import("./auto-adapt");
    const { data: permRows } = await supabase
      .from("auto_adapt_permissions")
      .select("permission,enabled");
    const { data: rp } = await supabaseAdmin
      .from("profiles")
      .select("processing_restricted")
      .eq("id", userId)
      .maybeSingle();
    const onlyMoves = !rp?.processing_restricted && changed.every((i) => i.action === "moved");
    if (
      onlyMoves &&
      movesWithinBounds(
        changed.map((i) => ({
          from: zonedInstant(todayKey, i.fromStart, tz).toISOString(),
          to: zonedInstant(todayKey, i.toStart!, tz).toISOString(),
        })),
        toMap(permRows),
      )
    ) {
      await applyProposal(
        supabase,
        userId,
        { proposalId: proposal.id, mode: "once", trialDays: 14 },
        "system",
      );
      return { proposal, items: diff, availableMin, autoApplied: true };
    }
    return { proposal, items: diff, availableMin, autoApplied: false };
  });

/** Pins sessions the member explicitly moved (via Coach) so later rebuilds keep them where the member put them. */

export async function pinMemberMovedSessions(admin: any, userId: string, startsAt: string[]) {
  if (!startsAt.length) return;
  await admin
    .from("plan_blocks")
    .update({ is_protected: true })
    .eq("user_id", userId)
    .in("starts_at", startsAt)
    .in("status", ["planned", "scheduled"])
    .not("goal_id", "is", null);
}
