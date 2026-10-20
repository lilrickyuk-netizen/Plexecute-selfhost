// Server half of the central safety engine: records events, maintains active flags, returns the policy.
import {
  detectSignals,
  policyFor,
  stateFor,
  SAFETY_POLICY_VERSION,
  type SafetyDomain,
  type SafetySignal,
  type SafetyPolicy,
} from "./safety";

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

export async function activeSignals(userId: string): Promise<SafetySignal[]> {
  const db = await admin();
  const { data } = await db
    .from("safety_flags")
    .select("signal")
    .eq("user_id", userId)
    .is("cleared_at", null);
  return (data ?? []).map((r) => r.signal as SafetySignal);
}

export async function currentPolicy(userId: string): Promise<SafetyPolicy> {
  return policyFor(await activeSignals(userId));
}

/** Persistent signals (everything except transient pain) stay active until the user clears them. */
const PERSISTENT: SafetySignal[] = [
  "exercise_red_flag",
  "pregnancy_postpartum",
  "eating_disorder_risk",
  "self_harm_crisis",
  "immediate_danger",
];

export async function recordSafety(
  userId: string,
  domain: SafetyDomain,
  stage: "input" | "output" | "mutation" | "declaration" | "clear",
  signals: SafetySignal[],
  extra: string[] = [],
): Promise<SafetyPolicy> {
  const prior = await activeSignals(userId);
  const policy = policyFor([...prior, ...signals]);
  if (!signals.length && !extra.length && stage !== "mutation") return policy;
  const db = await admin();
  const { data: ev } = await db
    .from("safety_events")
    .insert({
      user_id: userId,
      domain,
      stage,
      state: stateFor(signals.length ? signals : prior),
      signals: [...signals, ...extra],
      intervention: policy.intervention,
      policy_version: SAFETY_POLICY_VERSION,
    })
    .select("id")
    .single();
  const newFlags = signals.filter((x) => PERSISTENT.includes(x) && !prior.includes(x));
  if (newFlags.length) {
    await db
      .from("safety_flags")
      .insert(
        newFlags.map((s) => ({ user_id: userId, signal: s, source_event_id: ev?.id ?? null })),
      );
  }
  return policy;
}

/** Classify free text from any domain and record it. */
export async function screenText(
  userId: string,
  domain: SafetyDomain,
  text: string | null | undefined,
  stage: "input" | "output" = "input",
) {
  return recordSafety(userId, domain, stage, detectSignals(text));
}

/** §62: gate before every high-impact plan mutation. Returns a refusal reason or null. */
export async function guardMutation(
  userId: string,
  kind:
    | "calorie_deficit"
    | "progressive_training"
    | "accountability_escalation"
    | "food_weight_call"
    | "training_session",
): Promise<string | null> {
  const p = await currentPolicy(userId);
  const blocked =
    (kind === "calorie_deficit" && p.blockCalorieDeficit) ||
    (kind === "progressive_training" && p.blockProgressiveTraining) ||
    (kind === "training_session" && p.stopTraining) ||
    (kind === "accountability_escalation" && p.pauseAccountability) ||
    (kind === "food_weight_call" && p.suppressFoodWeightCalls);
  if (!blocked) return null;
  await recordSafety(userId, "plan_mutation", "mutation", [], [`blocked_${kind}`]);
  return "Paused by a safety note on your account. You can review it in Settings, under Safety.";
}
