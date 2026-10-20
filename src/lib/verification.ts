/**
 * Evidence Verification Engine (V3 §52). Pure and deterministic.
 * Classes: VERIFIED_EXTERNAL, SUPPORTED, SELF_REPORTED, UNKNOWN.
 * Calendar presence is never proof. AI-originated signals are ignored, so AI can never upgrade a class.
 * One external record can only verify one occurrence (double-use prevention via claims).
 */
export const VERIFICATION_POLICY_VERSION = "verification_policy_v1";
export const EVIDENCE_CLASSES = [
  "verified_external",
  "supported",
  "self_reported",
  "unknown",
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export type Signal =
  | { kind: "self_confirm"; origin: Origin }
  | { kind: "call_confirm"; origin: Origin }
  | { kind: "workout_log"; origin: Origin; sets: number; ref: string }
  | { kind: "timer"; origin: Origin; minutes: number; ref: string }
  | { kind: "food_log"; origin: Origin }
  | { kind: "calendar"; origin: Origin }
  | {
      kind: "external_activity";
      origin: Origin;
      ref: string;
      startsAt: string;
      minutes: number;
      source: string;
    };
export type Origin = "user" | "device" | "provider" | "call" | "system" | "ai";

export type BlockFacts = {
  id: string;
  domain: string;
  occurrence_kind: string;
  status: string;
  starts_at: string;
  duration_min: number;
};

/** Activity kinds an external activity record can verify. */
const PHYSICAL = new Set(["training", "cardio", "mobility", "workout", "fitness"]);
/** Own choice (spec gives no window): activity must start between 60 min before and 120 min after the planned end. */
export const MATCH_BEFORE_MIN = 60;
export const MATCH_AFTER_MIN = 120;
/** Own choice: activity must last at least half the planned duration. */
export const MATCH_MIN_SHARE = 0.5;

export const CLASS_LABEL: Record<EvidenceClass, string> = {
  verified_external: "Verified by a connected device or service",
  supported: "Supported by your logs",
  self_reported: "You confirmed it",
  unknown: "No evidence",
};

export type Verdict = {
  evidence: EvidenceClass;
  reasons: string[];
  claim: { source_kind: "health_activity"; source_ref: string } | null;
  policy_version: string;
};

export function matchesActivity(b: BlockFacts, a: { startsAt: string; minutes: number }): boolean {
  const start = new Date(b.starts_at).getTime();
  const t = new Date(a.startsAt).getTime();
  const lo = start - MATCH_BEFORE_MIN * 60_000,
    hi = start + (b.duration_min + MATCH_AFTER_MIN) * 60_000;
  return t >= lo && t <= hi && a.minutes >= b.duration_min * MATCH_MIN_SHARE;
}

export function classify(
  b: BlockFacts,
  signals: Signal[],
  claimedElsewhere: Set<string> = new Set(),
): Verdict {
  const base = { claim: null, policy_version: VERIFICATION_POLICY_VERSION };
  if (b.status !== "done" && b.status !== "partial")
    return { ...base, evidence: "unknown", reasons: ["Not marked done."] };
  const s = signals.filter((x) => x.origin !== "ai" && x.kind !== "calendar");
  const physical = PHYSICAL.has(b.domain) || PHYSICAL.has(b.occurrence_kind);
  if (physical) {
    const act = s.find(
      (x): x is Extract<Signal, { kind: "external_activity" }> =>
        x.kind === "external_activity" &&
        (x.origin === "device" || x.origin === "provider") &&
        !claimedElsewhere.has(x.ref) &&
        matchesActivity(b, x),
    );
    if (act)
      return {
        ...base,
        evidence: "verified_external",
        reasons: [
          `${act.minutes} min activity from ${act.source} at the planned time. This shows the activity happened, not the exact sets.`,
        ],
        claim: { source_kind: "health_activity", source_ref: act.ref },
      };
  }
  const reasons: string[] = [];
  const log = s.find((x) => x.kind === "workout_log" && x.sets > 0) as
    Extract<Signal, { kind: "workout_log" }> | undefined;
  if (log) reasons.push(`${log.sets} logged set${log.sets === 1 ? "" : "s"}.`);
  const timer = s.find((x) => x.kind === "timer" && x.minutes > 0) as
    Extract<Signal, { kind: "timer" }> | undefined;
  if (timer)
    reasons.push(
      `${timer.minutes} min timed in the app. This supports the time spent, not mastery.`,
    );
  const self = s.some((x) => x.kind === "self_confirm");
  const call = s.some((x) => x.kind === "call_confirm");
  const food = s.some((x) => x.kind === "food_log");
  if (log || timer) return { ...base, evidence: "supported", reasons };
  if (self && call)
    return { ...base, evidence: "supported", reasons: ["Confirmed in the app and on a call."] };
  if (self || call || food)
    return {
      ...base,
      evidence: "self_reported",
      reasons: [
        call
          ? "You confirmed it on a call."
          : food
            ? "A food log shows a record was made, not that every item was eaten."
            : "You marked it done.",
      ],
    };
  return { ...base, evidence: "unknown", reasons: ["No acceptable evidence."] };
}

/** Never let a re-check lower verified evidence it cannot see again, and never accept AI upgrades. */
export function rank(c: EvidenceClass) {
  return 3 - EVIDENCE_CLASSES.indexOf(c);
}
