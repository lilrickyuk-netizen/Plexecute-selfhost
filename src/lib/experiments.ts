/**
 * Personal Experiment Engine (V3 §43). Pure and deterministic.
 * Two-condition within-person design, schedule fixed before the first observation:
 * minimum 28 days, alternating 2-week blocks A then B, at least 4 valid observations per condition.
 * Results are descriptive differences with uncertainty; never claimed as proof of cause.
 */
import { addDaysKey, diffDaysKey } from "./tz";
import { detectSignals, outputViolations, type SafetyPolicy } from "./safety";

export const EXPERIMENT_POLICY_VERSION = "experiment_v1";
export const MIN_DAYS = 28;
export const BLOCK_DAYS = 14;
export const MIN_OBS = 4;
/** Allowed lengths: whole A+B pairs of 2-week blocks. 56 is our own upper bound. */
export const DURATIONS = [28, 56] as const;

export type Condition = "A" | "B";
export type Segment = { from: string; to: string; condition: Condition };

export function buildSchedule(startKey: string, days: number): Segment[] {
  const total = Math.max(MIN_DAYS, Math.round(days / (BLOCK_DAYS * 2)) * BLOCK_DAYS * 2);
  const out: Segment[] = [];
  for (let i = 0; i * BLOCK_DAYS < total; i++) {
    const from = addDaysKey(startKey, i * BLOCK_DAYS);
    out.push({ from, to: addDaysKey(from, BLOCK_DAYS - 1), condition: i % 2 === 0 ? "A" : "B" });
  }
  return out;
}

export function conditionOn(schedule: Segment[], dayKey: string): Condition | null {
  return schedule.find((s) => dayKey >= s.from && dayKey <= s.to)?.condition ?? null;
}

/**
 * Safety gate before activation. Uses the central safety engine plus a list of experiment types we refuse.
 * The list is our own: the spec says "prohibit unsafe experiments" without enumerating them.
 */
const UNSAFE: { kind: string; label: string; re: RegExp }[] = [
  {
    kind: "fasting",
    label: "long fasts or skipping eating",
    re: /\b(water fast|dry fast|fast(ing)? for (2|3|4|5|6|7|\d\d) ?(days?|\d+ ?h)|\d{2,} ?hours? fast|skip(ping)? (all )?meals|stop eating|no food)\b/i,
  },
  {
    kind: "sleep_restriction",
    label: "cutting sleep short",
    re: /\bsleep(ing)? (only |just )?[0-4](\.\d)? ?(hours?|h)\b|\b([0-4](\.\d)?|five) ?(hours?|h) (of )?sleep|sleep (deprivation|restriction)|all[- ]nighter|\bno sleep\b/i,
  },
  {
    kind: "medication",
    label: "changing medicines or supplement doses",
    re: /\b(medication|medicine|antidepressant|insulin|dose|dosage|\d+ ?mg|stop taking|supplement dose)\b/i,
  },
  {
    kind: "train_through_pain",
    label: "training through pain or injury",
    re: /\b(through (the )?pain|while injured|ignore (the )?pain|despite (the )?injury)\b/i,
  },
  {
    kind: "breath_holding",
    label: "breath-holding",
    re: /\b(breath[- ]?hold|hold(ing)? (my|your) breath|hyperventilat)/i,
  },
  {
    kind: "extreme_exposure",
    label: "extreme cold, heat or dehydration",
    re: /\b(ice bath|cold plunge|sauna for \d{2,}|dehydrat|no water)\b/i,
  },
  {
    kind: "purging",
    label: "purging or laxatives",
    re: /\b(purg|laxative|make myself sick|vomit)/i,
  },
];

export type GateResult = { ok: boolean; reasons: string[] };
export function experimentGate(
  texts: string[],
  policy: Pick<
    SafetyPolicy,
    "state" | "blockCalorieDeficit" | "blockProgressiveTraining" | "stopOrdinaryCoaching"
  >,
): GateResult {
  const t = texts.join(" \n");
  const reasons: string[] = [];
  if (detectSignals(t).length)
    reasons.push("It mentions a health or safety concern. Please get the right help first.");
  for (const v of outputViolations(t))
    reasons.push(
      v === "very_low_energy"
        ? "Very low calorie intakes aren't allowed."
        : "It involves medical advice Plexecute can't give.",
    );
  for (const u of UNSAFE)
    if (u.re.test(t)) reasons.push(`Experiments involving ${u.label} aren't allowed.`);
  if (policy.stopOrdinaryCoaching)
    reasons.push("Experiments are paused while a safety note is active.");
  if (policy.blockCalorieDeficit && /\b(calorie|kcal|deficit|diet|weigh|eat less|portion)/i.test(t))
    reasons.push("Food and weight experiments are paused while a safety note is active.");
  if (policy.blockProgressiveTraining && /\b(train|workout|lift|run|intensity|heavier)/i.test(t))
    reasons.push("Training experiments are paused while a safety note is active.");
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export type ExpEntry = { entry_date: string; value: number; condition: string | null };
type Stats = { n: number; mean: number | null; sd: number | null };
function stats(v: number[]): Stats {
  if (!v.length) return { n: 0, mean: null, sd: null };
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd =
    v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)) : null;
  return { n: v.length, mean: m, sd };
}

export type ExperimentResult = {
  a: Stats;
  b: Stats;
  difference: number | null;
  /** rough 95% range for B minus A (normal approximation) */
  range: [number, number] | null;
  enough: boolean;
  confidence: "not_enough" | "low" | "moderate";
  limitations: string[];
  version: string;
};

export function analyse(
  schedule: Segment[],
  entries: ExpEntry[],
  minObs: number,
  confounders: string | null,
  todayKey: string,
): ExperimentResult {
  const a: number[] = [],
    b: number[] = [];
  for (const e of entries) {
    const c = conditionOn(schedule, e.entry_date);
    if (c === "A") a.push(Number(e.value));
    else if (c === "B") b.push(Number(e.value));
  }
  const A = stats(a),
    B = stats(b);
  const enough = A.n >= minObs && B.n >= minObs;
  const difference = A.mean != null && B.mean != null ? B.mean - A.mean : null;
  let range: [number, number] | null = null;
  if (enough && A.sd != null && B.sd != null && difference != null) {
    const se = Math.sqrt(A.sd ** 2 / A.n + B.sd ** 2 / B.n);
    range = [difference - 1.96 * se, difference + 1.96 * se];
  }
  const crossesZero = range ? range[0] <= 0 && range[1] >= 0 : true;
  const confidence = !enough
    ? "not_enough"
    : crossesZero || A.n < 10 || B.n < 10
      ? "low"
      : "moderate";
  const days = schedule.length
    ? diffDaysKey(schedule[schedule.length - 1]!.to, schedule[0]!.from) + 1
    : 0;
  const elapsed = schedule.length
    ? Math.min(days, Math.max(0, diffDaysKey(todayKey, schedule[0]!.from) + 1))
    : 0;
  const limitations = [
    "One person, not a controlled trial: this shows what happened, not proof of cause.",
    "A always came before B, so changes over time (season, routine, motivation) can look like an effect.",
  ];
  const missing = elapsed - (A.n + B.n);
  if (missing > 0) limitations.push(`${missing} of ${elapsed} days so far have no reading.`);
  if (confounders?.trim())
    limitations.push(`Things you noted that could skew it: ${confounders.trim()}`);
  if (enough && crossesZero) limitations.push("The likely range includes no difference at all.");
  return {
    a: A,
    b: B,
    difference,
    range,
    enough,
    confidence,
    limitations,
    version: EXPERIMENT_POLICY_VERSION,
  };
}
