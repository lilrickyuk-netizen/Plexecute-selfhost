import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { providerState, VOICE_TOPUP } from "./billing";
import { env, stripe, tierForPrice } from "./integrations.server";

type Db = SupabaseClient<Database>;
export type StripeSub = {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  trial_end: number | null;
  current_period_end?: number;
  current_period_start?: number;
  metadata?: { user_id?: string };
  items?: {
    data: {
      price: { id: string; recurring?: { interval?: string } };
      current_period_end?: number;
      current_period_start?: number;
    }[];
  };
};

const iso = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);

/** Single reconciliation path for webhooks and restore: provider state in, normalised entitlement out. */
export async function applyStripeSubscription(
  db: Db,
  s: StripeSub,
  deleted = false,
  userIdHint?: string,
) {
  let userId = s.metadata?.user_id ?? userIdHint;
  if (!userId) {
    const { data } = await db
      .from("subscriptions")
      .select("user_id")
      .eq("customer_id", s.customer)
      .maybeSingle();
    userId = data?.user_id;
  }
  if (!userId) return null;
  const item = s.items?.data[0];
  const ps = providerState({
    status: deleted ? "canceled" : s.status,
    cancel_at_period_end: s.cancel_at_period_end,
  });
  const tier = ps.entitled ? tierForPrice(item?.price.id) : "free";
  const interval = item?.price.recurring?.interval;
  await db.from("subscriptions").upsert({
    user_id: userId,
    customer_id: s.customer,
    subscription_id: s.id,
    status: deleted ? "canceled" : s.status,
    tier,
    trial_ends_at: iso(s.trial_end),
    current_period_end: iso(item?.current_period_end ?? s.current_period_end),
    current_period_start: iso(item?.current_period_start ?? s.current_period_start),
    cancel_at_period_end: s.cancel_at_period_end,
    billing_interval: interval === "month" || interval === "year" ? interval : null,
    ...(s.trial_end ? { trial_used: true } : {}),
    updated_at: new Date().toISOString(),
  });
  // Admins keep full access regardless of any test subscription they may hold (owner decision).
  const { data: isAdmin } = await db
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!isAdmin) await db.from("profiles").update({ tier }).eq("id", userId);
  return { userId, tier, state: ps.state };
}

/** Restore: re-read the provider for this customer and reconcile. Never creates entitlement without a provider record. */
export async function restoreFromProvider(db: Db, userId: string) {
  const { data: sub } = await db
    .from("subscriptions")
    .select("customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!sub?.customer_id) return { restored: false as const, reason: "no_customer" as const };
  const list = (await stripe(
    `subscriptions?customer=${encodeURIComponent(sub.customer_id)}&status=all&limit=10`,
    "GET",
  )) as { data: StripeSub[] };
  const rank = (s: StripeSub) => ["active", "trialing", "past_due"].indexOf(s.status);
  const best = [...list.data].sort(
    (a, b) => (rank(b) === -1 ? -1 : rank(b)) - (rank(a) === -1 ? -1 : rank(a)),
  )[0];
  if (!best) return { restored: false as const, reason: "no_subscription" as const };
  const r = await applyStripeSubscription(db, best, false, userId);
  return { restored: true as const, tier: r?.tier ?? "free", state: r?.state ?? "none" };
}

/** Credits a paid top-up exactly once per payment. */
export async function creditTopUp(db: Db, userId: string, paymentRef: string) {
  const { data: dup } = await db
    .from("entitlement_ledger")
    .select("id")
    .eq("external_ref", paymentRef)
    .eq("reason", "voice_topup_purchase")
    .maybeSingle();
  if (dup) return false;
  await db.from("entitlement_ledger").insert({
    user_id: userId,
    capability: VOICE_TOPUP.capability,
    amount: VOICE_TOPUP.seconds,
    reason: "voice_topup_purchase",
    external_ref: paymentRef,
  });
  return true;
}

/** Provider refund reverses the unused top-up seconds exactly once. */
export async function reverseTopUp(db: Db, paymentRef: string) {
  const { data: buy } = await db
    .from("entitlement_ledger")
    .select("user_id,amount")
    .eq("external_ref", paymentRef)
    .eq("reason", "voice_topup_purchase")
    .maybeSingle();
  if (!buy) return false;
  const { data: dup } = await db
    .from("entitlement_ledger")
    .select("id")
    .eq("external_ref", paymentRef)
    .eq("reason", "voice_topup_refund")
    .maybeSingle();
  if (dup) return false;
  await db.from("entitlement_ledger").insert({
    user_id: buy.user_id,
    capability: VOICE_TOPUP.capability,
    amount: -Number(buy.amount),
    reason: "voice_topup_refund",
    external_ref: paymentRef,
  });
  return true;
}

export const topUpPrice = () => env(VOICE_TOPUP.env);
