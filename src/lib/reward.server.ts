/**
 * Execute Monthly Execution Reward: ledger, Stripe credit adapter and reconciliation. Server-only.
 * The reward is a Stripe customer-balance credit (provider-backed) issued before the renewal invoice
 * finalises; it is marked APPLIED only when Stripe reports a paid renewal invoice that consumed it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { env } from "@/lib/integrations.server";
import {
  evaluatePeriod,
  periodEligibility,
  decide,
  invoiceConfirmsCredit,
  REWARD,
  REWARD_POLICY_VERSION,
  type RewardBlock,
  type SubscriptionInfo,
} from "@/lib/reward";

type Db = SupabaseClient<Database>;

async function audit(
  db: Db,
  userId: string,
  action: string,
  id: string,
  outcome: string,
  metadata: Record<string, unknown>,
) {
  await db.from("audit_events").insert({
    user_id: userId,
    actor_type: "system",
    action,
    resource_type: "execution_reward",
    resource_id: id,
    outcome,
    metadata: metadata as never,
  });
}

export async function loadPeriodBlocks(
  db: Db,
  userId: string,
  start: Date,
  end: Date,
): Promise<RewardBlock[]> {
  const { data: blocks } = await db
    .from("plan_blocks")
    .select("id,status,source_type,original_starts_at,completed_at,created_at,plan_version_id")
    .eq("user_id", userId)
    .gte("original_starts_at", start.toISOString())
    .lt("original_starts_at", end.toISOString())
    .limit(5000);
  const ids = (blocks ?? []).map((b) => b.id);
  const events: {
    block_id: string | null;
    to_status: string | null;
    created_at: string;
    actor_type: string | null;
  }[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await db
      .from("plan_block_events")
      .select("block_id,to_status,created_at,actor_type")
      .in("block_id", ids.slice(i, i + 300))
      .in("to_status", ["done", "rescheduled"]);
    events.push(...(data ?? []));
  }
  const firstDone = new Map<string, string>(),
    resched = new Map<string, string>();
  for (const e of events.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!e.block_id) continue;
    if (e.to_status === "done" && !firstDone.has(e.block_id))
      firstDone.set(e.block_id, e.created_at);
    if (e.to_status === "rescheduled" && e.actor_type === "system" && !resched.has(e.block_id))
      resched.set(e.block_id, e.created_at);
  }
  return (blocks ?? []).map((b) => ({
    ...b,
    done_event_at: firstDone.get(b.id) ?? null,
    rescheduled_at: resched.get(b.id) ?? null,
  }));
}

async function subFor(db: Db, userId: string): Promise<SubscriptionInfo | null> {
  const { data } = await db
    .from("subscriptions")
    .select(
      "tier,status,billing_interval,current_period_start,current_period_end,trial_ends_at,subscription_id,customer_id",
    )
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

/** Creates/updates the IN_PROGRESS row for the current paid monthly Execute period with truthful counts. */
export async function refreshProgress(db: Db, userId: string, now = new Date()) {
  const sub = await subFor(db, userId);
  const el = periodEligibility(sub);
  if (!el.ok) return { eligible: false as const, reason: el.reason };
  const start = new Date(sub!.current_period_start!),
    end = new Date(sub!.current_period_end!);
  const ev = evaluatePeriod(await loadPeriodBlocks(db, userId, start, end), { start, end });
  const { data: existing } = await db
    .from("execution_rewards")
    .select("id,state")
    .eq("user_id", userId)
    .eq("period_start", start.toISOString())
    .maybeSingle();
  if (!existing) {
    await db.from("execution_rewards").insert({
      user_id: userId,
      subscription_id: sub!.subscription_id!,
      customer_id: sub!.customer_id!,
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      required_count: ev.required,
      completed_count: ev.completed,
      plan_version_ids: ev.planVersionIds,
      policy_version: REWARD_POLICY_VERSION,
    });
  } else if (existing.state === "IN_PROGRESS") {
    await db
      .from("execution_rewards")
      .update({
        required_count: ev.required,
        completed_count: ev.completed,
        plan_version_ids: ev.planVersionIds,
      })
      .eq("id", existing.id)
      .eq("state", "IN_PROGRESS");
  }
  return {
    eligible: true as const,
    required: ev.required,
    completed: ev.completed,
    periodEnd: end.toISOString(),
    now: now.toISOString(),
  };
}

/** Freezes a finished period as EARNED or NOT_EARNED with a full snapshot. Idempotent. */
export async function finalizeReward(db: Db, rewardId: string, now = new Date()) {
  const { data: r } = await db.from("execution_rewards").select("*").eq("id", rewardId).single();
  if (!r || r.state !== "IN_PROGRESS") return r?.state ?? null;
  const end = new Date(r.period_end);
  if (now < end) return "IN_PROGRESS";
  const ev = evaluatePeriod(await loadPeriodBlocks(db, r.user_id, new Date(r.period_start), end), {
    start: new Date(r.period_start),
    end,
  });
  let d = decide(ev);
  // One reward per service month even across cancelled/re-created subscriptions.
  if (d.state === "EARNED") {
    const { count } = await db
      .from("execution_rewards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", r.user_id)
      .in("state", ["EARNED", "APPLIED"])
      .neq("id", r.id)
      .lt("period_start", r.period_end)
      .gt("period_end", r.period_start);
    if ((count ?? 0) > 0) d = { state: "NOT_EARNED", amountPence: 0 };
  }
  const { data: updated } = await db
    .from("execution_rewards")
    .update({
      state: d.state,
      amount_pence: d.amountPence,
      required_count: ev.required,
      completed_count: ev.completed,
      plan_version_ids: ev.planVersionIds,
      decided_at: now.toISOString(),
      earned_at: d.state === "EARNED" ? now.toISOString() : null,
      evaluation: {
        policy_version: REWARD_POLICY_VERSION,
        required_ids: ev.requiredIds,
        completed_ids: ev.completedIds,
        excluded: ev.excluded,
      },
    })
    .eq("id", r.id)
    .eq("state", "IN_PROGRESS")
    .select("id");
  if (!updated?.length) return null;
  await audit(
    db,
    r.user_id,
    d.state === "EARNED" ? "reward.earned" : "reward.not_earned",
    r.id,
    "succeeded",
    {
      required: ev.required,
      completed: ev.completed,
      period_start: r.period_start,
      period_end: r.period_end,
    },
  );
  if (d.state === "EARNED") {
    const { monthlyPlanOutcome } = await import("@/lib/outcomes");
    const evidences: string[] = [];
    for (let i = 0; i < ev.completedIds.length; i += 300) {
      const { data } = await db
        .from("plan_blocks")
        .select("evidence")
        .in("id", ev.completedIds.slice(i, i + 300));
      evidences.push(...(data ?? []).map((b) => b.evidence));
    }
    await db.from("outcome_ledger").upsert(
      monthlyPlanOutcome({
        userId: r.user_id,
        rewardId: r.id,
        required: ev.required,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        completedIds: ev.completedIds,
        evidences,
        observedAt: now.toISOString(),
      }) as never,
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
    );
    const { enqueueNotification } = await import("@/lib/notify.server");
    await enqueueNotification(db, {
      userId: r.user_id,
      category: "BILLING",
      intent: "reward_earned",
      title: "Monthly plan completed: reward earned",
      body: `You completed all ${ev.required} planned actions. Your next eligible Execute renewal will receive the reward.`,
      link: "/app/billing",
      dedupe: ["reward-earned", r.id],
      now,
    });
  }
  return d.state;
}

export function stripeReady() {
  return !!env("STRIPE_SECRET_KEY");
}

/** Issues the £10 Stripe customer-balance credit once (idempotency key = reward id). Never marks APPLIED. */
export async function issueCredit(db: Db, rewardId: string) {
  const { data: r } = await db.from("execution_rewards").select("*").eq("id", rewardId).single();
  if (!r || r.state !== "EARNED" || r.provider_credit_ref) return { ok: !!r?.provider_credit_ref };
  if (!stripeReady()) {
    await db
      .from("execution_rewards")
      .update({ last_error: "Billing provider not configured" })
      .eq("id", r.id);
    return { ok: false };
  }
  // Credit currency must match the customer's balance currency, which follows their market.
  const { data: profTz } = await db
    .from("profiles")
    .select("timezone,billing_country")
    .eq("id", r.user_id)
    .single();
  const { marketFor } = await import("./billing");
  const currency = marketFor(profTz) === "US" ? "usd" : REWARD.currency;
  const body = new URLSearchParams({
    amount: String(-REWARD.amountPence),
    currency,
    description: "Plexecute Execute monthly plan reward",
    "metadata[reward_id]": r.id,
    "metadata[period_start]": r.period_start,
  });
  let res: Response;
  try {
    res = await fetch(
      `https://api.stripe.com/v1/customers/${encodeURIComponent(r.customer_id)}/balance_transactions`,
      {
        method: "POST",
        body,
        headers: {
          Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": `execute-reward-${r.id}`,
        },
      },
    );
  } catch (e) {
    await db
      .from("execution_rewards")
      .update({ apply_attempts: r.apply_attempts + 1, last_error: String(e).slice(0, 300) })
      .eq("id", r.id);
    return { ok: false };
  }
  const j = (await res.json()) as { id?: string; amount?: number; error?: { message?: string } };
  if (!res.ok || !j.id || j.amount !== -REWARD.amountPence) {
    await db
      .from("execution_rewards")
      .update({
        apply_attempts: r.apply_attempts + 1,
        last_error: (j.error?.message ?? `Stripe ${res.status}`).slice(0, 300),
      })
      .eq("id", r.id);
    await audit(db, r.user_id, "reward.credit_failed", r.id, "failed", { status: res.status });
    return { ok: false };
  }
  await db
    .from("execution_rewards")
    .update({ provider_credit_ref: j.id, apply_attempts: r.apply_attempts + 1, last_error: null })
    .eq("id", r.id)
    .is("provider_credit_ref", null);
  await audit(db, r.user_id, "reward.credit_issued", r.id, "succeeded", { credit_ref: j.id });
  return { ok: true };
}

type StripeInvoice = {
  id: string;
  status: string;
  billing_reason: string | null;
  subscription: string | null | { id: string };
  parent?: { subscription_details?: { subscription?: string } };
  starting_balance: number;
  ending_balance: number | null;
  currency: string;
  lines?: { data: { period?: { start: number } }[] };
};

function invSub(i: StripeInvoice) {
  return typeof i.subscription === "string"
    ? i.subscription
    : (i.subscription?.id ?? i.parent?.subscription_details?.subscription ?? null);
}

/** Reconciles a renewal invoice with the reward ledger. Replayed events are harmless (state guards + unique refs). */
export async function handleInvoiceEvent(
  db: Db,
  type: string,
  inv: StripeInvoice,
  now = new Date(),
) {
  const sub = invSub(inv);
  if (!sub || inv.billing_reason !== "subscription_cycle") return;
  const lineStart = inv.lines?.data[0]?.period?.start ?? null;
  const { data: rewards } = await db
    .from("execution_rewards")
    .select("*")
    .eq("subscription_id", sub)
    .order("period_start", { ascending: false })
    .limit(3);
  const r = (rewards ?? []).find(
    (x) =>
      lineStart != null &&
      Math.abs(new Date(x.period_end).getTime() - lineStart * 1000) <= 36 * 3600e3,
  );
  if (!r) return;
  if (type === "invoice.created") {
    if (r.state === "IN_PROGRESS") await finalizeReward(db, r.id, now);
    await issueCredit(db, r.id);
    await db
      .from("execution_rewards")
      .update({ next_renewal_ref: inv.id })
      .eq("id", r.id)
      .in("state", ["EARNED"])
      .is("next_renewal_ref", null);
    return;
  }
  if (type === "invoice.payment_failed") {
    if (r.state === "EARNED")
      await db
        .from("execution_rewards")
        .update({
          last_error:
            "Renewal payment failed; the reward stays as a credit until a renewal is paid.",
        })
        .eq("id", r.id);
    return;
  }
  if (type === "invoice.paid" && r.state === "EARNED") {
    const ok = invoiceConfirmsCredit(
      {
        status: inv.status,
        billing_reason: inv.billing_reason,
        subscription: sub,
        starting_balance: inv.starting_balance,
        ending_balance: inv.ending_balance,
        period_start_unix: lineStart,
        currency: inv.currency,
      },
      r,
    );
    if (!ok) {
      await db
        .from("execution_rewards")
        .update({ last_error: "The renewal invoice did not use the reward credit yet." })
        .eq("id", r.id);
      await audit(db, r.user_id, "reward.reconcile_mismatch", r.id, "failed", { invoice: inv.id });
      return;
    }
    const { data: done } = await db
      .from("execution_rewards")
      .update({
        state: "APPLIED",
        applied_at: now.toISOString(),
        provider_invoice_ref: inv.id,
        next_renewal_ref: inv.id,
        last_error: null,
      })
      .eq("id", r.id)
      .eq("state", "EARNED")
      .select("id");
    if (!done?.length) return;
    await db.from("entitlement_ledger").insert({
      user_id: r.user_id,
      capability: "execute.monthly_execution_reward",
      amount: REWARD.amountPence,
      reason: "reward_applied",
      external_ref: inv.id,
      period_start: r.period_start,
      period_end: r.period_end,
    });
    await audit(db, r.user_id, "reward.applied", r.id, "succeeded", {
      invoice: inv.id,
      credit_ref: r.provider_credit_ref,
    });
    const { enqueueNotification } = await import("@/lib/notify.server");
    await enqueueNotification(db, {
      userId: r.user_id,
      category: "BILLING",
      intent: "reward_applied",
      title: "£10 reward applied",
      body: "Your Execute renewal received the £10 monthly plan reward.",
      link: "/app/billing",
      dedupe: ["reward-applied", r.id],
      now,
    });
  }
}

/** Cron backstop: refresh progress, close finished periods and (re)try credits before renewal invoices finalise. */
export async function processRewards(db: Db, now = new Date()) {
  const out = { refreshed: 0, decided: 0, credited: 0 };
  const { data: subs } = await db
    .from("subscriptions")
    .select("user_id")
    .eq("tier", "execute")
    .eq("billing_interval", "month")
    .limit(5000);
  for (const s of subs ?? []) {
    const r = await refreshProgress(db, s.user_id, now);
    if (r.eligible) out.refreshed++;
  }
  const { data: ended } = await db
    .from("execution_rewards")
    .select("id")
    .eq("state", "IN_PROGRESS")
    .lte("period_end", now.toISOString())
    .limit(500);
  for (const r of ended ?? []) {
    if (await finalizeReward(db, r.id, now)) out.decided++;
  }
  const { data: owed } = await db
    .from("execution_rewards")
    .select("id")
    .eq("state", "EARNED")
    .is("provider_credit_ref", null)
    .lt("apply_attempts", 10)
    .limit(200);
  for (const r of owed ?? []) {
    if ((await issueCredit(db, r.id)).ok) out.credited++;
  }
  return out;
}
