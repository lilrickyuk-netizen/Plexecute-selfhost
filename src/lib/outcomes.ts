/**
 * Life Outcome Ledger detectors (V3 §53). Pure and deterministic.
 * Each detector turns stored observations into meaningful outcome drafts. Every draft carries
 * the ids of the observations behind it (traceability) and a dedupe key so it is recorded once.
 * Evidence class is the weakest class among its observations; detectors never raise it.
 */
import { weekKeyOf } from "./tz";
import { EVIDENCE_CLASSES, type EvidenceClass } from "./verification";

export const OUTCOME_POLICY_VERSION = "outcome_policy_v1";
export const OUTCOME_TYPES = [
  "goal_milestone",
  "training_progression",
  "adherence_change",
  "body_nutrition_trend",
  "learning_milestone",
  "wellness_routine",
  "schedule_realism",
  "experiment_result",
  "routine_established",
  "monthly_plan_completed",
] as const;
export type OutcomeType = (typeof OUTCOME_TYPES)[number];

export const OUTCOME_LABEL: Record<OutcomeType | "observation", string> = {
  goal_milestone: "Goal milestone",
  training_progression: "Training progression",
  adherence_change: "Consistency change",
  body_nutrition_trend: "Body or nutrition trend",
  learning_milestone: "Learning milestone",
  wellness_routine: "Wellness routine",
  schedule_realism: "Schedule realism",
  experiment_result: "Experiment result",
  routine_established: "Routine established",
  monthly_plan_completed: "Monthly plan completed",
  observation: "Session record",
};

/** Own choices: the spec names the outcome kinds but gives no thresholds. */
export const MIN_WEEK_SESSIONS = 5; // matches the behaviour model's minimum comparable sample
export const CHANGE_POINTS = 15; // percentage-point change between consecutive weeks
export const ROUTINE_WEEKS = 4; // consecutive weeks to call something established
export const WEIGHT_STEP_KG = 1; // record each whole kg the 7-reading average moves
export const MIN_WEIGH_INS = 10; // same as the adaptive nutrition minimum

export type Draft = {
  outcome_type: OutcomeType;
  domain: string;
  metric: string;
  value: number | null;
  text_value: string | null;
  unit: string | null;
  goal_id: string | null;
  block_id: string | null;
  source: string;
  source_ref: string | null;
  observation_refs: { table: string; id: string }[];
  evidence_class: EvidenceClass;
  observed_at: string;
  dedupe_key: string;
  metadata: Record<string, unknown>;
};

export function weakest(classes: string[]): EvidenceClass {
  let w = 0;
  for (const c of classes)
    w = Math.max(
      w,
      EVIDENCE_CLASSES.indexOf(
        (EVIDENCE_CLASSES as readonly string[]).includes(c) ? (c as EvidenceClass) : "unknown",
      ),
    );
  return classes.length ? EVIDENCE_CLASSES[w]! : "unknown";
}

const base = {
  value: null,
  text_value: null,
  unit: null,
  goal_id: null,
  block_id: null,
  source_ref: null,
  metadata: {},
};

export type Milestone = { id: string; goal_id: string; title: string; done_at: string | null };
export function milestoneOutcomes(ms: Milestone[]): Draft[] {
  return ms
    .filter((m) => m.done_at)
    .map((m) => ({
      ...base,
      outcome_type: "goal_milestone",
      domain: "goals",
      metric: "milestone_achieved",
      text_value: m.title,
      goal_id: m.goal_id,
      source: "goal_milestones",
      source_ref: m.id,
      observation_refs: [{ table: "goal_milestones", id: m.id }],
      evidence_class: "self_reported",
      observed_at: m.done_at!,
      dedupe_key: `milestone:${m.id}`,
    }));
}

export type Progression = {
  id: string;
  rule: string;
  created_at: string;
  prior: Record<string, unknown>;
  next: Record<string, unknown>;
  evidence: Record<string, unknown>;
  exercise?: string | undefined;
};
const UP = new Set(["double_progression_load", "double_progression_reps"]);
export function progressionOutcomes(ev: Progression[]): Draft[] {
  return ev
    .filter(
      (e) =>
        e.evidence?.["applied"] !== false &&
        (UP.has(e.rule) || Number(e.next?.["load_kg"]) > Number(e.prior?.["load_kg"])),
    )
    .map((e) => {
      const sessions = Array.isArray(e.evidence?.["sessions"])
        ? (e.evidence["sessions"] as string[])
        : [];
      return {
        ...base,
        outcome_type: "training_progression" as const,
        domain: "training",
        metric: e.rule,
        value: e.next?.["load_kg"] != null ? Number(e.next["load_kg"]) : null,
        unit: e.next?.["load_kg"] != null ? "kg" : null,
        text_value: e.exercise ?? null,
        source: "progression_events",
        source_ref: e.id,
        observation_refs: [
          { table: "progression_events", id: e.id },
          ...sessions.map((id) => ({ table: "workout_sessions", id })),
        ],
        evidence_class: "supported" as const,
        observed_at: e.created_at,
        dedupe_key: `progression:${e.id}`,
        metadata: { prior: e.prior, next: e.next },
      };
    });
}

export type BlockObs = {
  id: string;
  status: string;
  starts_at: string;
  evidence: string;
  goal_id: string | null;
  is_protected: boolean;
  interruption_count: number;
  domain: string;
};
type Week = { key: string; blocks: BlockObs[] };
function weeks(blocks: BlockObs[], tz: string | null | undefined, now: Date): Week[] {
  const current = weekKeyOf(now, tz);
  const m = new Map<string, BlockObs[]>();
  for (const b of blocks) {
    if (new Date(b.starts_at) > now || b.status === "rescheduled" || b.status === "cancelled")
      continue;
    const k = weekKeyOf(b.starts_at, tz);
    if (k === current) continue; // only finished weeks
    m.set(k, [...(m.get(k) ?? []), b]);
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, blocks]) => ({ key, blocks }));
}
const DONE = new Set(["done", "partial"]);
const pct = (n: number, d: number) => Math.round((n / d) * 100);

function weekChange(
  ws: Week[],
  kind: "adherence_change" | "schedule_realism",
  rate: (w: Week) => number,
  metric: string,
  refsOf: (w: Week) => BlockObs[],
): Draft[] {
  const out: Draft[] = [];
  for (let i = 1; i < ws.length; i++) {
    const a = ws[i - 1]!,
      b = ws[i]!;
    if (a.blocks.length < MIN_WEEK_SESSIONS || b.blocks.length < MIN_WEEK_SESSIONS) continue;
    const ra = rate(a),
      rb = rate(b),
      d = rb - ra;
    if (kind === "schedule_realism" ? d < CHANGE_POINTS : Math.abs(d) < CHANGE_POINTS) continue;
    const refs = refsOf(b);
    out.push({
      ...base,
      outcome_type: kind,
      domain: "plan",
      metric,
      value: rb,
      unit: "%",
      source: "plan_blocks",
      source_ref: b.key,
      observation_refs: refs.map((x) => ({ table: "plan_blocks", id: x.id })),
      evidence_class: weakest(refs.filter((x) => DONE.has(x.status)).map((x) => x.evidence)),
      observed_at: `${b.key}T00:00:00Z`,
      dedupe_key: `${kind}:${b.key}`,
      metadata: {
        week: b.key,
        previous_week: a.key,
        previous: ra,
        current: rb,
        change: d,
        sessions: b.blocks.length,
        previous_sessions: a.blocks.length,
      },
    });
  }
  return out;
}

/** Consistency = share of past sessions done or partly done. Realism = share kept at the planned time (not snoozed, moved or expired). */
export function weeklyOutcomes(
  blocks: BlockObs[],
  tz: string | null | undefined,
  now: Date,
): Draft[] {
  const ws = weeks(blocks, tz, now);
  return [
    ...weekChange(
      ws,
      "adherence_change",
      (w) => pct(w.blocks.filter((b) => DONE.has(b.status)).length, w.blocks.length),
      "weekly_completion_rate",
      (w) => w.blocks,
    ),
    ...weekChange(
      ws,
      "schedule_realism",
      (w) =>
        pct(
          w.blocks.filter((b) => b.interruption_count === 0 && b.status !== "expired").length,
          w.blocks.length,
        ),
      "kept_as_planned_rate",
      (w) => w.blocks,
    ),
  ];
}

/** A protected goal done at least once a week for ROUTINE_WEEKS finished weeks in a row. Recorded once per goal. */
export function routineOutcomes(
  blocks: BlockObs[],
  tz: string | null | undefined,
  now: Date,
  titles: Record<string, string>,
): Draft[] {
  const ws = weeks(
    blocks.filter((b) => b.is_protected && b.goal_id),
    tz,
    now,
  );
  const out: Draft[] = [];
  const goals = new Set(blocks.filter((b) => b.is_protected && b.goal_id).map((b) => b.goal_id!));
  for (const g of goals) {
    let run: BlockObs[] = [],
      streak = 0;
    for (const w of ws) {
      const done = w.blocks.filter((b) => b.goal_id === g && DONE.has(b.status));
      if (done.length) {
        streak++;
        run.push(...done);
      } else {
        streak = 0;
        run = [];
      }
      if (streak === ROUTINE_WEEKS) {
        out.push({
          ...base,
          outcome_type: "routine_established",
          domain: blocks.find((b) => b.goal_id === g)!.domain,
          metric: "weeks_in_a_row",
          value: ROUTINE_WEEKS,
          unit: "weeks",
          goal_id: g,
          text_value: titles[g] ?? null,
          source: "plan_blocks",
          source_ref: g,
          observation_refs: run.map((b) => ({ table: "plan_blocks", id: b.id })),
          evidence_class: weakest(run.map((b) => b.evidence)),
          observed_at: `${w.key}T00:00:00Z`,
          dedupe_key: `routine:${g}`,
          metadata: { through_week: w.key },
        });
        break;
      }
    }
  }
  return out;
}

export type WellnessObs = { id: string; created_at: string; completion_state: string };
export function wellnessOutcomes(
  enabled: boolean,
  perWeek: number,
  sessions: WellnessObs[],
  tz: string | null | undefined,
  now: Date,
): Draft[] {
  if (!enabled || perWeek < 1) return [];
  const current = weekKeyOf(now, tz);
  const byWeek = new Map<string, WellnessObs[]>();
  for (const s of sessions) {
    const k = weekKeyOf(s.created_at, tz);
    if (k !== current && s.completion_state === "completed")
      byWeek.set(k, [...(byWeek.get(k) ?? []), s]);
  }
  const keys = [...byWeek.keys()].sort();
  const out: Draft[] = [];
  let run: string[] = [];
  for (const k of keys) {
    const prev = run[run.length - 1];
    const consecutive = prev && Math.round((Date.parse(k) - Date.parse(prev)) / 86400000) === 7;
    run = byWeek.get(k)!.length >= perWeek ? (consecutive || !prev ? [...run, k] : [k]) : [];
    if (run.length > 0 && run.length % ROUTINE_WEEKS === 0) {
      const refs = run.slice(-ROUTINE_WEEKS).flatMap((w) => byWeek.get(w)!);
      out.push({
        ...base,
        outcome_type: "wellness_routine",
        domain: "wellness",
        metric: "weeks_meeting_target",
        value: run.length,
        unit: "weeks",
        source: "wellness_sessions",
        source_ref: k,
        observation_refs: refs.map((s) => ({ table: "wellness_sessions", id: s.id })),
        evidence_class: "supported",
        observed_at: `${k}T00:00:00Z`,
        dedupe_key: `wellness:${k}`,
        metadata: { per_week: perWeek },
      });
    }
  }
  return out;
}

export type WeighIn = { id: string; log_date: string; value: number };
/** Each whole kg the 7-reading average has moved from the first 7-reading average, once enough weigh-ins exist. Never applied while food/weight features are paused for safety. */
export function bodyTrendOutcomes(weighIns: WeighIn[], enabled: boolean): Draft[] {
  if (!enabled) return [];
  const w = [...weighIns].sort((a, b) => a.log_date.localeCompare(b.log_date));
  if (w.length < MIN_WEIGH_INS) return [];
  const avg = (xs: WeighIn[]) => xs.reduce((s, x) => s + Number(x.value), 0) / xs.length;
  const start = avg(w.slice(0, 7));
  const out: Draft[] = [];
  let reached = 0;
  for (let i = 7; i <= w.length; i++) {
    const win = w.slice(i - 7, i);
    const change = avg(win) - start;
    const steps = Math.trunc(Math.abs(change) / WEIGHT_STEP_KG) * Math.sign(change);
    if (
      steps !== 0 &&
      Math.abs(steps) > Math.abs(reached) &&
      Math.sign(steps) === Math.sign(reached || steps)
    ) {
      reached = steps;
      out.push({
        ...base,
        outcome_type: "body_nutrition_trend",
        domain: "nutrition",
        metric: "weight_trend_change",
        value: steps * WEIGHT_STEP_KG,
        unit: "kg",
        source: "daily_logs",
        source_ref: win[win.length - 1]!.id,
        observation_refs: win.map((x) => ({ table: "daily_logs", id: x.id })),
        evidence_class: "self_reported",
        observed_at: `${win[win.length - 1]!.log_date}T00:00:00Z`,
        dedupe_key: `weight:${steps}`,
        metadata: {
          start_average: Number(start.toFixed(2)),
          current_average: Number(avg(win).toFixed(2)),
        },
      });
    }
  }
  return out;
}

export type Topic = {
  id: string;
  goal_id: string;
  title: string;
  done_at: string | null;
  parent_id: string | null;
};
export type Assessment = {
  id: string;
  goal_id: string;
  title: string;
  kind: string;
  score: number | null;
  taken_at: string | null;
  evidence: string | null;
};
export function learningOutcomes(topics: Topic[], assessments: Assessment[]): Draft[] {
  const t: Draft[] = topics
    .filter((x) => x.done_at && !x.parent_id)
    .map((x) => ({
      ...base,
      outcome_type: "learning_milestone",
      domain: "learning",
      metric: "topic_completed",
      text_value: x.title,
      goal_id: x.goal_id,
      source: "learning_topics",
      source_ref: x.id,
      observation_refs: [{ table: "learning_topics", id: x.id }],
      evidence_class: "self_reported",
      observed_at: x.done_at!,
      dedupe_key: `topic:${x.id}`,
    }));
  const a: Draft[] = assessments
    .filter((x) => x.score != null && x.taken_at)
    .map((x) => ({
      ...base,
      outcome_type: "learning_milestone",
      domain: "learning",
      metric: `${x.kind}_result`,
      value: Number(x.score),
      unit: "%",
      text_value: x.title,
      goal_id: x.goal_id,
      source: "learning_assessments",
      source_ref: x.id,
      observation_refs: [{ table: "learning_assessments", id: x.id }],
      evidence_class: "self_reported",
      observed_at: x.taken_at!,
      dedupe_key: `assessment:${x.id}`,
      metadata: { evidence_note: x.evidence },
    }));
  return [...t, ...a];
}

export type ExperimentObs = {
  id: string;
  title: string;
  status: string;
  result: {
    difference: number | null;
    enough: boolean;
    confidence: string;
    a: { n: number };
    b: { n: number };
  } | null;
  created_at: string;
  end_date: string | null;
  entry_ids: string[];
};
export function experimentOutcomes(xs: ExperimentObs[]): Draft[] {
  return xs
    .filter((x) => x.status === "completed" && x.result)
    .map((x) => ({
      ...base,
      outcome_type: "experiment_result",
      domain: "experiments",
      metric: x.result!.enough ? "difference_b_minus_a" : "not_enough_readings",
      value: x.result!.enough ? x.result!.difference : null,
      text_value: x.result!.enough ? null : x.title,
      source: "experiments",
      source_ref: x.id,
      observation_refs: [
        { table: "experiments", id: x.id },
        ...x.entry_ids.map((id) => ({ table: "experiment_entries", id })),
      ],
      evidence_class: "self_reported",
      observed_at: x.end_date ? `${x.end_date}T00:00:00Z` : x.created_at,
      dedupe_key: `experiment:${x.id}`,
      metadata: {
        title: x.title,
        confidence: x.result!.confidence,
        readings_a: x.result!.a.n,
        readings_b: x.result!.b.n,
        note: "Shows what happened, not proof of cause.",
      },
    }));
}

const EVIDENCE_ORDER = ["unknown", "self_reported", "supported", "verified_external"] as const;
/** Monthly plan completed (Execute reward): every planned action of a paid service month done; weakest evidence of the actions. */
export function monthlyPlanOutcome(a: {
  userId: string;
  rewardId: string;
  required: number;
  periodStart: string;
  periodEnd: string;
  completedIds: string[];
  evidences: string[];
  observedAt: string;
}) {
  const weakest = a.evidences.reduce<number>(
    (m, e) => Math.min(m, Math.max(0, EVIDENCE_ORDER.indexOf(e as never))),
    EVIDENCE_ORDER.length - 1,
  );
  return {
    user_id: a.userId,
    outcome_type: "monthly_plan_completed",
    domain: "plan",
    metric: "monthly_plan_completed",
    value: a.required,
    text_value: null,
    unit: "planned actions",
    goal_id: null,
    block_id: null,
    source: "execution_reward",
    source_ref: a.rewardId,
    observation_refs: a.completedIds.slice(0, 500).map((id) => ({ table: "plan_blocks", id })),
    evidence_class: a.evidences.length ? EVIDENCE_ORDER[weakest] : "self_reported",
    observed_at: a.observedAt,
    dedupe_key: `monthly_plan:${a.periodStart}`,
    policy_version: OUTCOME_POLICY_VERSION,
    confidence: 1,
    metadata: { period_start: a.periodStart, period_end: a.periodEnd, reward_id: a.rewardId },
  };
}
