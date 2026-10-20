/**
 * Execute Monthly Execution Reward (owner-locked). Pure and deterministic; AI never decides.
 * Complete 100% of the accepted monthly plan in a paid monthly Execute service period
 * = exactly £10 off the next monthly Execute renewal. Anything less = no reward.
 */
export const REWARD_POLICY_VERSION = "execute_reward_v1";
export const REWARD = { amountPence: 1000, currency: "gbp", executeMonthlyPence: 5999 } as const;
export const discountedRenewalPence = REWARD.executeMonthlyPence - REWARD.amountPence; // 4999
/** Same reward in each launch market: £10 off in the UK, $10 off in the US (1000 minor units either way). */
export const REWARD_CURRENCIES = ["gbp", "usd"] as const;

export type RewardState = "IN_PROGRESS" | "EARNED" | "NOT_EARNED" | "APPLIED" | "EXPIRED";

export type RewardBlock = {
  id: string;
  status: string;
  source_type: string;
  original_starts_at: string;
  completed_at: string | null;
  created_at: string;
  plan_version_id: string | null;
  /** when the server marked it rescheduled (replaced by an accepted replan), if it was */
  rescheduled_at?: string | null;
  /** server-written completion event time (plan_block_events to_status = done) */
  done_event_at?: string | null;
};

/** Fixed life obligations (work shifts, appointments) are constraints, not plan actions. */
const NOT_PLAN_ACTIONS = new Set(["commitment"]);

export type Evaluation = {
  required: number;
  completed: number;
  requiredIds: string[];
  completedIds: string[];
  excluded: { id: string; why: "replaced_by_accepted_replan" | "stopped_for_safety" }[];
  planVersionIds: string[];
  complete: boolean;
};

/**
 * Which actions belong to the period: by their ORIGINAL planned time, so moving a session
 * (snooze, repair, calendar clash) never removes it from the month it was planned in.
 * - Replaced by an accepted replan before it was due: excluded (the replacement sessions count instead).
 * - Rescheduled after it was due, cancelled, skipped, blocked, expired, partial: required and not completed.
 * - Stopped for safety: excluded, so the reward never encourages training through warning signs (V3 §62).
 * - Completed only when status is done, a server-written completion event exists, and it happened before the period ended.
 */
export function evaluatePeriod(
  blocks: RewardBlock[],
  period: { start: Date; end: Date },
): Evaluation {
  const s = period.start.getTime(),
    e = period.end.getTime();
  const out: Evaluation = {
    required: 0,
    completed: 0,
    requiredIds: [],
    completedIds: [],
    excluded: [],
    planVersionIds: [],
    complete: false,
  };
  const versions = new Set<string>();
  const seen = new Set<string>();
  for (const b of blocks) {
    if (seen.has(b.id)) continue; // duplicate rows/events never double count
    seen.add(b.id);
    if (NOT_PLAN_ACTIONS.has(b.source_type)) continue;
    const t = new Date(b.original_starts_at).getTime();
    if (!(t >= s && t < e)) continue;
    if (new Date(b.created_at).getTime() >= e) continue;
    if (
      b.status === "rescheduled" &&
      b.rescheduled_at &&
      new Date(b.rescheduled_at).getTime() <= t
    ) {
      out.excluded.push({ id: b.id, why: "replaced_by_accepted_replan" });
      continue;
    }
    if (b.status === "safety_stopped") {
      out.excluded.push({ id: b.id, why: "stopped_for_safety" });
      continue;
    }
    out.required++;
    out.requiredIds.push(b.id);
    if (b.plan_version_id) versions.add(b.plan_version_id);
    const doneAt = b.done_event_at ? new Date(b.done_event_at).getTime() : null;
    if (
      b.status === "done" &&
      b.completed_at &&
      doneAt !== null &&
      doneAt < e &&
      new Date(b.completed_at).getTime() < e
    ) {
      out.completed++;
      out.completedIds.push(b.id);
    }
  }
  out.planVersionIds = [...versions].sort();
  out.requiredIds.sort();
  out.completedIds.sort();
  out.complete = out.required > 0 && out.completed === out.required;
  return out;
}

export type SubscriptionInfo = {
  tier: string;
  status: string;
  billing_interval: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  subscription_id: string | null;
  customer_id: string | null;
};

/** Whether this subscription period can earn the reward. */
export function periodEligibility(
  sub: SubscriptionInfo | null,
): { ok: true } | { ok: false; reason: string } {
  if (!sub || sub.tier !== "execute") return { ok: false, reason: "not_execute" };
  if (
    !sub.subscription_id ||
    !sub.customer_id ||
    !sub.current_period_start ||
    !sub.current_period_end
  )
    return { ok: false, reason: "no_billing_period" };
  if (sub.billing_interval !== "month")
    return {
      ok: false,
      reason: sub.billing_interval === "year" ? "annual_not_covered" : "interval_unknown",
    };
  if (sub.status === "trialing") return { ok: false, reason: "trial" };
  if (
    sub.trial_ends_at &&
    new Date(sub.trial_ends_at).getTime() > new Date(sub.current_period_start).getTime()
  )
    return { ok: false, reason: "trial" };
  if (!["active", "past_due"].includes(sub.status)) return { ok: false, reason: "not_active" };
  return { ok: true };
}

/** Decide a finished period. Exactly £10 or nothing. */
export function decide(ev: Evaluation): { state: "EARNED" | "NOT_EARNED"; amountPence: 0 | 1000 } {
  return ev.complete
    ? { state: "EARNED", amountPence: REWARD.amountPence }
    : { state: "NOT_EARNED", amountPence: 0 };
}

/**
 * Provider confirmation: the renewal invoice for the next period must be paid and must have
 * consumed at least the reward credit from the customer balance. Anything else is not "applied".
 */
export function invoiceConfirmsCredit(
  inv: {
    status: string;
    billing_reason: string | null;
    subscription: string | null;
    starting_balance: number;
    ending_balance: number | null;
    period_start_unix: number | null;
    currency: string;
  },
  reward: { subscription_id: string; period_end: string; provider_credit_ref: string | null },
): boolean {
  if (!reward.provider_credit_ref) return false;
  if (
    inv.status !== "paid" ||
    inv.subscription !== reward.subscription_id ||
    !(REWARD_CURRENCIES as readonly string[]).includes(inv.currency)
  )
    return false;
  if (inv.billing_reason !== "subscription_cycle") return false;
  if (
    inv.period_start_unix == null ||
    Math.abs(inv.period_start_unix * 1000 - new Date(reward.period_end).getTime()) > 36 * 3600e3
  )
    return false;
  const used = (inv.ending_balance ?? 0) - inv.starting_balance; // credit is negative balance; used credit raises it
  return inv.starting_balance <= -REWARD.amountPence && used >= REWARD.amountPence;
}

export const STATE_COPY: Record<RewardState, string> = {
  IN_PROGRESS: "In progress",
  EARNED: "£10 / $10 reward earned",
  NOT_EARNED: "Full plan not completed this month",
  APPLIED: "£10 / $10 taken off your renewal",
  EXPIRED: "Reward ended with the subscription",
};
export const INELIGIBLE_COPY: Record<string, string> = {
  not_execute: "The monthly reward is part of Execute.",
  no_billing_period: "The reward starts with your first paid Execute month.",
  annual_not_covered: "The monthly reward applies to monthly Execute subscriptions.",
  interval_unknown: "The reward starts with your first paid monthly Execute month.",
  trial: "Trials don't earn the reward. It starts with your first paid Execute month.",
  not_active: "The reward needs an active Execute subscription.",
};
