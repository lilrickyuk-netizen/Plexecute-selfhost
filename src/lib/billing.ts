/** V3 §5 / Steps 50–55: product manifest, trial disclosure, provider-state normalisation and allowance warnings. Pure. */
export type PaidTier = "pro" | "execute";
export type Interval = "month" | "year";

/** Locked base prices: same amounts in each launch market — UK pays pounds, US pays dollars. Live amounts always come from the provider price objects named by env vars. */
export type Market = "GB" | "US";
export const PRODUCTS = {
  pro: {
    month: { pence: 2399, cents: 2399, env: "STRIPE_PRICE_PRO", envUsd: "STRIPE_PRICE_PRO_USD" },
    year: {
      pence: 23999,
      cents: 23999,
      env: "STRIPE_PRICE_PRO_ANNUAL",
      envUsd: "STRIPE_PRICE_PRO_ANNUAL_USD",
    },
  },
  execute: {
    month: {
      pence: 5999,
      cents: 5999,
      env: "STRIPE_PRICE_EXECUTE",
      envUsd: "STRIPE_PRICE_EXECUTE_USD",
    },
    year: {
      pence: 59999,
      cents: 59999,
      env: "STRIPE_PRICE_EXECUTE_ANNUAL",
      envUsd: "STRIPE_PRICE_EXECUTE_ANNUAL_USD",
    },
  },
} as const;
export const VOICE_TOPUP = {
  minutes: 60,
  seconds: 3600,
  pence: 1499,
  cents: 1499,
  env: "STRIPE_PRICE_VOICE_TOPUP",
  envUsd: "STRIPE_PRICE_VOICE_TOPUP_USD",
  capability: "execute.voice_topup_seconds",
} as const;

/** Default hint only: US time zones suggest dollars, everyone else pounds. Never authoritative — use marketFor. */
export function marketForTimezone(tz: string | null | undefined): Market {
  return tz && (tz.startsWith("America/") || tz.startsWith("US/")) ? "US" : "GB";
}

/** Authoritative billing market: the member's stored billing country (set at signup/settings, confirmed by the checkout billing address). Time zone is only a fallback hint. */
export function marketFor(
  p: { billing_country?: string | null; timezone?: string | null } | null | undefined,
): Market {
  if (p?.billing_country === "US" || p?.billing_country === "GB") return p.billing_country;
  return marketForTimezone(p?.timezone);
}

/** Env var holding the Stripe price for a plan in the member's market. */
export function priceEnvFor(tier: PaidTier, interval: Interval, market: Market): string {
  const p = PRODUCTS[tier][interval];
  return market === "US" ? p.envUsd : p.env;
}
/** Disclosed top-up rule encoded in the manifest: minutes count in the service month of purchase and do not roll over. */
export const TOPUP_RULE =
  "Extra minutes can be used in the service month you buy them and don't carry over.";

/** §5.3 trial ceilings; they never redefine paid monthly allowances. */
export const TRIAL = {
  days: 7,
  pro: { campaigns: 3, connectedSeconds: 3 * 60 },
  execute: { occurrences: 5, connectedSeconds: 15 * 60 },
} as const;

export const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;
export const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
/** Formats a minor-unit amount for the member's market. */
export const money = (amount: number, market: Market) =>
  market === "US" ? usd(amount) : gbp(amount);
/** Display amount for a plan in the member's market (minor units). */
export function priceAmount(tier: PaidTier, interval: Interval, market: Market): number {
  const p = PRODUCTS[tier][interval];
  return market === "US" ? p.cents : p.pence;
}

export function addInterval(d: Date, interval: Interval, n = 1) {
  const y = d.getUTCFullYear() + (interval === "year" ? n : 0);
  const m = d.getUTCMonth() + (interval === "month" ? n : 0);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes()),
  );
}

/** Everything §5.3 requires before the user confirms a trial. */
export function trialDisclosure(
  tier: PaidTier,
  interval: Interval,
  now = new Date(),
  market: Market = "GB",
) {
  const trialEnds = new Date(now.getTime() + TRIAL.days * 864e5);
  const amount = priceAmount(tier, interval, market);
  return {
    tier,
    trialDays: TRIAL.days,
    interval,
    market,
    renewalPricePence: amount,
    renewalDate: trialEnds,
    autoRenew: `Your plan renews automatically at ${money(amount, market)} per ${interval} on the renewal date unless you cancel before then.`,
    cancelPath:
      "Cancel any time from Plan & billing, then Manage subscription. Cancelling during the trial means you won't be charged.",
  };
}

export type ProviderState =
  "none" | "trialing" | "active" | "cancelling" | "grace" | "expired" | "refunded";

/** Normalises provider status. Entitlement follows the provider; Plexecute never fabricates it. */
export function providerState(
  s: { status: string | null; cancel_at_period_end?: boolean | null; refunded?: boolean } | null,
): { state: ProviderState; entitled: boolean } {
  if (!s?.status) return { state: "none", entitled: false };
  if (s.refunded) return { state: "refunded", entitled: false };
  switch (s.status) {
    case "trialing":
      return { state: s.cancel_at_period_end ? "cancelling" : "trialing", entitled: true };
    case "active":
      return { state: s.cancel_at_period_end ? "cancelling" : "active", entitled: true };
    case "past_due":
      return { state: "grace", entitled: true }; // provider billing-retry window
    default:
      return { state: "expired", entitled: false }; // canceled, unpaid, incomplete, incomplete_expired, paused
  }
}

/** §5.6 warning level for an allowance. */
export function allowanceLevel(used: number, limit: number): null | 80 | 100 {
  if (limit <= 0) return null;
  const r = used / limit;
  return r >= 1 ? 100 : r >= 0.8 ? 80 : null;
}

/** Trial call ceiling; null means the trial ceiling allows another call. */
export function trialCallBlock(i: {
  tier: PaidTier;
  trialing: boolean;
  campaigns: number;
  occurrences: number;
  connectedSeconds: number;
}): null | "trial_ceiling" {
  if (!i.trialing) return null;
  if (i.tier === "pro")
    return i.campaigns >= TRIAL.pro.campaigns || i.connectedSeconds >= TRIAL.pro.connectedSeconds
      ? "trial_ceiling"
      : null;
  return i.occurrences >= TRIAL.execute.occurrences ||
    i.connectedSeconds >= TRIAL.execute.connectedSeconds
    ? "trial_ceiling"
    : null;
}

/** Top-up purchase is explicit and for an entitled Pro or Execute subscription. */
export function canBuyTopUp(tier: string, state: ProviderState) {
  return (
    (tier === "pro" || tier === "execute") &&
    (state === "active" || state === "cancelling" || state === "grace")
  );
}
