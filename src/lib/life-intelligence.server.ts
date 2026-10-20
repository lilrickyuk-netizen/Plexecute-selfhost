// Loads one member's real records and runs the deterministic Life Intelligence reasoning over them.
// Reads use the member's own (RLS) client; link sync and event metering use the service client.
import {
  alignment,
  buildLinks,
  reconcile,
  confidenceFrom,
  dailyBrief,
  detectConflicts,
  diffLinks,
  explainItem,
  goalMetrics,
  linkKey,
  missPatterns,
  prerequisiteIssues,
  proactiveSignals,
  projectGoal,
  weeklyReview,
  type IBlock,
  type IGoal,
  type IMilestone,
  type IObjective,
} from "./life-intelligence";
import { localDayKey, localHm, startOfLocalDay } from "./tz";

type Db = any;

const hm = (t: string | null | undefined) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export async function loadSnapshot(db: Db, userId: string, tz: string | null) {
  const now = new Date();
  const from = new Date(now.getTime() - 56 * 864e5).toISOString();
  const to = new Date(now.getTime() + 8 * 864e5).toISOString();
  const [goals, blocks, twin, profile, commitments, pv, events] = await Promise.all([
    db
      .from("goals")
      .select(
        "id,title,domain,status,priority,priority_class,deadline,weekly_minutes,why,dependencies,monthly_saving,budget_available,current_value,baseline_value,target_value,target_unit,created_at,pathway",
      )
      .eq("user_id", userId)
      .in("status", ["active", "proposed", "paused", "completed"]),
    db
      .from("plan_blocks")
      .select("id,title,domain,goal_id,starts_at,duration_min,status,is_protected,source_type")
      .eq("user_id", userId)
      .gte("starts_at", from)
      .lte("starts_at", to)
      .not("status", "in", "(rescheduled,cancelled)")
      .order("starts_at")
      .limit(1500),
    db
      .from("life_twin_facts")
      .select("domain,fact_key,fact_value")
      .eq("user_id", userId)
      .is("valid_until", null)
      .limit(80),
    db
      .from("profiles")
      .select("work_start,work_end,work_days,billing_country")
      .eq("id", userId)
      .maybeSingle(),
    db
      .from("commitments")
      .select("title,kind,start_time,end_time,on_date,days,is_hard,active")
      .eq("user_id", userId)
      .eq("active", true)
      .limit(200),
    db
      .from("plan_versions")
      .select("diff_summary")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("plan_block_events")
      .select("block_id,missed_reason,reason_code")
      .eq("user_id", userId)
      .gte("occurred_at", from)
      .or("missed_reason.not.is.null,reason_code.not.is.null")
      .limit(500),
  ]);
  const g: IGoal[] = goals.data ?? [];
  const ids = g.map((x) => x.id);
  const [ms, entries] = ids.length
    ? await Promise.all([
        db
          .from("goal_milestones")
          .select("id,goal_id,key,title,stage,depends_on,status,done_at,due_date,blocked_reason")
          .in("goal_id", ids),
        db
          .from("goal_metric_entries")
          .select("goal_id,value,recorded_at")
          .in("goal_id", ids)
          .order("recorded_at")
          .limit(1000),
      ])
    : [{ data: [] }, { data: [] }];
  const vision = (twin.data ?? []).find(
    (f: { fact_key: string }) => f.fact_key === "five_year_vision",
  )?.fact_value as { objectives?: IObjective[] } | undefined;
  const objectives: IObjective[] = Array.isArray(vision?.objectives)
    ? vision!.objectives.filter((o) => o && o.text)
    : [];
  const budgetFact = (twin.data ?? []).find(
    (f: { domain: string; fact_key: string }) =>
      f.domain === "finance" && /budget|available|disposable/.test(f.fact_key),
  );
  const budgetNum = budgetFact
    ? Number(
        typeof budgetFact.fact_value === "object"
          ? (budgetFact.fact_value as { amount?: number })?.amount
          : budgetFact.fact_value,
      )
    : NaN;
  const all: IBlock[] = blocks.data ?? [];
  const past = all.filter((b) => new Date(b.starts_at) < now);
  const upcoming = all.filter(
    (b) => new Date(b.starts_at) >= now && ["planned", "snoozed", "rescheduled"].includes(b.status),
  );

  // Work/shift end times per local day, for root-cause checks.
  const workEnds: Record<string, number[]> = {};
  const p = profile.data;
  for (let i = 0; i < 56; i++) {
    const day = localDayKey(new Date(now.getTime() - i * 864e5), tz);
    const wd = new Date(`${day}T12:00:00Z`).getUTCDay() || 7; // ISO weekday 1-7, as stored
    const ends: number[] = [];
    if (p?.work_end && (p.work_days ?? []).includes(wd)) ends.push(hm(p.work_end)!);
    for (const c of commitments.data ?? [])
      if (c.kind === "shift" && c.end_time && (c.on_date === day || (c.days ?? []).includes(wd)))
        ends.push(hm(c.end_time)!);
    if (ends.length) workEnds[day] = ends;
  }
  const reasons: Record<string, string> = {};
  for (const e of events.data ?? []) {
    const r = e.missed_reason ?? e.reason_code;
    if (e.block_id && r) reasons[e.block_id] = r;
  }

  const capacity =
    (pv.data?.diff_summary as { usable_capacity_min?: number } | null)?.usable_capacity_min ?? null;
  return {
    now,
    tz,
    goals: g,
    milestones: (ms.data ?? []) as IMilestone[],
    entries: (entries.data ?? []) as { goal_id: string; value: number; recorded_at: string }[],
    past,
    upcoming,
    all,
    objectives,
    hasVision: !!vision,
    workEnds,
    reasons,
    monthlyBudget: Number.isFinite(budgetNum) && budgetNum > 0 ? budgetNum : null,
    weeklyCapacityMin: typeof capacity === "number" ? capacity : null,
    currency: p?.billing_country === "US" ? "USD" : "GBP",
    commitments: commitments.data ?? [],
  };
}
export type Snapshot = Awaited<ReturnType<typeof loadSnapshot>>;

/** The full picture Coach reasons from: links, prerequisites, conflicts, trajectories, metrics, patterns, alignment. */
export function analyse(s: Snapshot, override: { monthlyBudget?: number | null } = {}) {
  const active = s.goals.filter((g) => g.status === "active");
  const prereq = prerequisiteIssues(s.goals, s.milestones, s.upcoming);
  const { conflicts, unknowns } = detectConflicts(
    s.goals,
    {
      monthlyBudget: override.monthlyBudget ?? s.monthlyBudget,
      weeklyCapacityMin: s.weeklyCapacityMin,
      currency: s.currency,
    },
    s.now,
  );
  const projections = active.map((g) =>
    projectGoal(
      g,
      s.entries.filter((e) => e.goal_id === g.id),
      s.milestones,
      s.tz,
      s.now,
    ),
  );
  const metrics = active.map((g) => ({
    goal: g.title,
    metrics: goalMetrics(
      g,
      s.all,
      s.milestones,
      s.entries.filter((e) => e.goal_id === g.id),
      s.now,
    ),
  }));
  const pat = missPatterns(
    s.past.filter((b) => b.goal_id),
    s.tz,
    { workEnds: s.workEnds, reasons: s.reasons },
  );
  const align = alignment(s.objectives, s.goals, s.upcoming);
  const goalsWithoutActions = active
    .filter((g) => (g.weekly_minutes ?? 0) > 0 && !s.upcoming.some((b) => b.goal_id === g.id))
    .map((g) => g.title);
  const signals = proactiveSignals({
    patterns: pat.patterns,
    projections,
    conflicts,
    prereq,
    goalsWithoutActions,
    alignment: align,
  });
  const facts =
    active.length + (s.monthlyBudget != null ? 1 : 0) + (s.weeklyCapacityMin != null ? 1 : 0);
  return {
    goal_status: {
      active: active.map((g) => g.title),
      proposed: s.goals.filter((g) => g.status === "proposed").map((g) => g.title),
      paused: s.goals.filter((g) => g.status === "paused").map((g) => g.title),
    },
    five_year_direction: s.hasVision
      ? s.objectives.length
        ? align
        : "set, but no objectives yet"
      : "not set",
    prerequisites: prereq,
    conflicts: conflicts.map((c) => {
      const r = reconcile(
        s.goals.filter((g) => c.goals.includes(g.title)),
        s.objectives,
        s.now,
      );
      return {
        ...c,
        reconciliation:
          r.decision === "ask"
            ? {
                decision: "ask_member",
                question: `Which matters more right now: ${c.goals.join(" or ")}?`,
              }
            : {
                decision: "suggest_only",
                lead: r.lead,
                reasons: r.reasons,
                note: "Suggest, then let the member choose; never change either goal yourself.",
              },
      };
    }),
    unknowns,
    projections,
    metrics,
    patterns: pat.enough ? pat.patterns : "not enough history yet to see patterns",
    goals_without_actions: goalsWithoutActions,
    signals,
    confidence: confidenceFrom(facts, 0, unknowns.length + (pat.enough ? 0 : 0)),
  };
}

export function explain(s: Snapshot, blockId: string | null, title: string | null) {
  const b =
    s.all.find((x) => x.id === blockId) ??
    (title
      ? [...s.upcoming, ...s.past.slice().reverse()].find((x) =>
          x.title.toLowerCase().includes(title.toLowerCase()),
        )
      : undefined) ??
    s.upcoming[0];
  if (!b) return { error: "No plan item found. Ask which session they mean." };
  const r = explainItem(b, s.goals, s.milestones, s.objectives);
  return {
    item: b.title,
    when: `${localDayKey(b.starts_at, s.tz)} ${localHm(b.starts_at, s.tz)}`,
    ...r,
  };
}

export async function brief(db: Db, s: Snapshot, userId: string) {
  const today = localDayKey(s.now, s.tz);
  const start = startOfLocalDay(s.now, s.tz);
  const end = new Date(start.getTime() + 864e5);
  const [bk, jr, calls] = await Promise.all([
    db
      .from("appointment_bookings")
      .select("service,provider_name,slot_date,start_time,status")
      .eq("user_id", userId)
      .eq("slot_date", today)
      .eq("status", "confirmed"),
    db
      .from("journeys")
      .select("dest_label,leave_at,arrive_by,status")
      .eq("user_id", userId)
      .gte("arrive_by", start.toISOString())
      .lt("arrive_by", end.toISOString())
      .neq("status", "cancelled"),
    db
      .from("scheduled_calls")
      .select("call_at,purpose,status")
      .eq("user_id", userId)
      .gte("call_at", start.toISOString())
      .lt("call_at", end.toISOString())
      .in("status", ["scheduled", "processing"]),
  ]);
  const todays = s.all.filter(
    (b) =>
      b.starts_at >= start.toISOString() &&
      b.starts_at < end.toISOString() &&
      !["replaced", "cancelled"].includes(b.status),
  );
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
  const items = [
    ...todays.map((b) => ({
      time: localHm(b.starts_at, s.tz),
      title: `${b.title}${DONE_LABEL[b.status] ?? ""}`,
      kind: b.goal_id ? "goal_session" : (b.source_type ?? "plan"),
    })),
    ...(
      s.commitments as {
        title: string;
        kind: string;
        start_time: string | null;
        on_date: string | null;
        days: number[] | null;
      }[]
    )
      .filter((c) => c.on_date === today || (!c.on_date && (c.days ?? []).includes(wd)))
      .filter((c) => !todays.some((b) => b.title === c.title))
      .map((c) => ({
        time: c.start_time?.slice(0, 5) ?? null,
        title: c.title,
        kind: c.kind === "appointment" ? "appointment" : "commitment",
      })),
    ...(bk.data ?? []).map(
      (x: { service: string; provider_name: string | null; start_time: string | null }) => ({
        time: x.start_time?.slice(0, 5) ?? null,
        title: `${x.service}${x.provider_name ? ` at ${x.provider_name}` : ""}`,
        kind: "booking",
      }),
    ),
    ...(jr.data ?? []).map((x: { dest_label: string | null; leave_at: string | null }) => ({
      time: x.leave_at ? localHm(x.leave_at, s.tz) : null,
      title: `Leave for ${x.dest_label ?? "your journey"}`,
      kind: "journey",
    })),
    ...(calls.data ?? []).map((x: { call_at: string; purpose: string }) => ({
      time: localHm(x.call_at, s.tz),
      title: `Plexecute call: ${x.purpose.replace(/_/g, " ")}`,
      kind: "call",
    })),
  ];
  const soon = new Date(s.now.getTime() + 14 * 864e5).toISOString().slice(0, 10);
  const deadlines = [
    ...s.goals
      .filter((g) => g.status === "active" && g.deadline && g.deadline.slice(0, 10) <= soon)
      .map((g) => ({ title: g.title, due: g.deadline!.slice(0, 10) })),
    ...s.milestones
      .filter(
        (m) =>
          !m.done_at &&
          m.due_date &&
          m.due_date <= soon &&
          s.goals.some((g) => g.id === m.goal_id && g.status === "active"),
      )
      .map((m) => ({ title: m.title, due: m.due_date! })),
  ].sort((a, b) => a.due.localeCompare(b.due));
  const a = analyse(s);
  return dailyBrief({
    today,
    items,
    deadlines,
    risks: a.signals.filter((x) => x.severity === "attention").map((x) => x.text),
  });
}
const DONE_LABEL: Record<string, string> = {
  done: " (done)",
  partial: " (partly done)",
  missed: " (missed)",
  skipped: " (skipped)",
};

export function review(s: Snapshot) {
  const to = startOfLocalDay(s.now, s.tz);
  const from = new Date(to.getTime() - 7 * 864e5);
  const pat = missPatterns(
    s.past.filter((b) => b.goal_id),
    s.tz,
    { workEnds: s.workEnds, reasons: s.reasons },
  );
  const r = weeklyReview(s.all, s.goals, pat.patterns, from, new Date(s.now.getTime()));
  const a = analyse(s);
  return {
    ...r,
    from: localDayKey(from, s.tz),
    to: localDayKey(s.now, s.tz),
    projections: a.projections.filter((p) => p.status !== "not_enough_data"),
  };
}

/** Persists the current graph: adds new links, revives returning ones and invalidates stale ones. */
export async function syncLinks(admin: Db, userId: string, s: Snapshot) {
  const links = buildLinks(s.goals, s.milestones, s.upcoming, s.objectives);
  const { data: stored } = await admin
    .from("life_links")
    .select("link_key")
    .eq("user_id", userId)
    .is("invalidated_at", null);
  const d = diffLinks(
    (stored ?? []).map((x: { link_key: string }) => ({ key: x.link_key })),
    links,
  );
  if (d.add.length)
    await admin.from("life_links").upsert(
      d.add.map((l) => ({
        user_id: userId,
        goal_id: l.goal_id,
        link_key: linkKey(l),
        from_kind: l.from_kind,
        from_ref: l.from_ref,
        to_kind: l.to_kind,
        to_ref: l.to_ref,
        relation: l.relation,
        source: l.source,
        invalidated_at: null,
      })),
      { onConflict: "user_id,link_key" },
    );
  if (d.stale.length)
    await admin
      .from("life_links")
      .update({ invalidated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .in("link_key", d.stale);
  return { live: links.length, added: d.add.length, invalidated: d.stale.length };
}

/** Aggregate-only metering for the Owner Control Centre. Signals are counted at most once per member per day. */
export async function recordIntel(
  admin: Db,
  userId: string,
  kind: string,
  detail: Record<string, unknown> = {},
) {
  if (
    kind === "signal_generated" ||
    kind === "conflict_detected" ||
    kind === "goal_behind" ||
    kind === "blocker_open" ||
    kind === "pattern_detected"
  ) {
    const since = new Date(Date.now() - 864e5).toISOString();
    const { count } = await admin
      .from("intelligence_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", kind)
      .contains("detail", detail)
      .gte("created_at", since);
    if (count) return;
  }
  await admin.from("intelligence_events").insert({ user_id: userId, kind, detail });
}

export async function meterAnalysis(admin: Db, userId: string, a: ReturnType<typeof analyse>) {
  const jobs: Promise<unknown>[] = [];
  for (const sg of a.signals)
    jobs.push(recordIntel(admin, userId, "signal_generated", { key: sg.key.split(":")[0] }));
  if (a.conflicts.length)
    jobs.push(
      recordIntel(admin, userId, "conflict_detected", {
        kinds: a.conflicts
          .map((c) => c.kind)
          .sort()
          .join(","),
      }),
    );
  if (a.projections.some((p) => p.status === "behind"))
    jobs.push(recordIntel(admin, userId, "goal_behind", {}));
  if (a.prerequisites.length) jobs.push(recordIntel(admin, userId, "blocker_open", {}));
  if (Array.isArray(a.patterns))
    for (const p of a.patterns)
      jobs.push(recordIntel(admin, userId, "pattern_detected", { cause: p.cause }));
  await Promise.allSettled(jobs);
}
