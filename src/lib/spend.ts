/**
 * Combined monthly AI + call allowance and Plexecute AI Credit (owner-locked commercial rules).
 * Pure. Money is held in micro-pounds (1 £ = 1,000,000) so tiny AI calls are exact.
 * US members: amounts are the pound figures converted at the stored exchange rate (display only;
 * the ledger is always in pounds so both markets get exactly the same value).
 */
export const MICRO = 1_000_000;

/** Included real-cost allowance per paid service month. */
export const INCLUDED_ALLOWANCE_GBP = { pro: 8, execute: 26 } as const;

/** Plexecute AI Credit pack: £14.99 adds £10 of displayed credit (= £7.50 of real AI cost). AI only. Price is independent of the pack's value. */
export const AI_CREDIT = {
  pricePence: 1499,
  /** Displayed credit the pack adds (retail pounds). Unchanged by price changes. */
  displayGbp: 10,
  valueMicro: 7.5 * MICRO,
  env: "STRIPE_PRICE_AI_CREDIT",
  envUsd: "STRIPE_PRICE_AI_CREDIT_USD",
} as const;
/** Retail value of £1 of real AI cost (what the member effectively pays for it via credit). */
export const RETAIL_MULTIPLIER = AI_CREDIT.displayGbp / (AI_CREDIT.valueMicro / MICRO);

/** Provider list prices in US dollars per token (from the AI gateway model catalogue, standard tier). */
export const AI_RATES_USD: Record<string, { in: number; out: number }> = {
  "openai/gpt-6-astra": { in: 0.00001, out: 0.00005 },
  "openai/gpt-6-luna": { in: 0.0000001, out: 0.0000005 },
  "google/gemini-3.8-flash": { in: 0.00000075, out: 0.00000375 },
  "google/gemini-3.1-flash-lite": { in: 0.00000025, out: 0.0000015 },
  "openai/text-embedding-3-small": { in: 0.00000002, out: 0 },
  "openai/gpt-transcribe": { in: 0.000003, out: 0.000012 },
};
/** Unknown models are priced at the most expensive known rate so cost is never under-counted. */
const FALLBACK = { in: 0.00001, out: 0.00005 };

/** Per-minute call costs in US dollars: phone carriage and live AI voice. Override with SPEND_CALL_RATES_JSON. */
export const CALL_RATES_USD = { carriagePerMin: 0.03, voicePerMin: 0.1 } as const;

/** ElevenLabs call voice: US dollars per character spoken (Flash v2.5 list price, rounded up). */
export const TTS_RATE_USD_PER_CHAR = 0.0001;
export function ttsCostUsd(characters: number) {
  return Math.max(0, characters) * TTS_RATE_USD_PER_CHAR;
}

export function aiCostUsd(model: string, input: number, output: number) {
  const r = AI_RATES_USD[model.replace(/^lovable_ai:/, "")] ?? FALLBACK;
  return Math.max(0, input) * r.in + Math.max(0, output) * r.out;
}
export function callCostUsd(seconds: number, kind: "carriage" | "voice", rates = CALL_RATES_USD) {
  const perMin = kind === "carriage" ? rates.carriagePerMin : rates.voicePerMin;
  return (Math.max(0, seconds) / 60) * perMin;
}
export function usdToMicroGbp(usd: number, usdPerGbp: number) {
  return Math.round((usd / usdPerGbp) * MICRO);
}
export function retailMicro(costMicro: number) {
  return Math.round(costMicro * RETAIL_MULTIPLIER);
}
export function allowanceMicro(tier: string | null | undefined): number {
  return tier === "pro" || tier === "execute" ? INCLUDED_ALLOWANCE_GBP[tier] * MICRO : 0;
}

export type SpendState = {
  allowanceMicro: number;
  usedMicro: number;
  creditMicro: number;
};
/** Can new AI work start? Included allowance first, then AI Credit. */
export function aiAllowed(s: SpendState) {
  return s.usedMicro < s.allowanceMicro || s.creditMicro > 0;
}
/** Member-safe state: never return internal costs, balances or counters. */
export function memberUsageStatus(s: SpendState, tier: string) {
  return {
    includedEnded: (tier === "pro" || tier === "execute") && s.usedMicro >= s.allowanceMicro,
    aiEnded: !aiAllowed(s),
    creditAvailable: s.creditMicro > 0,
  };
}
/** Can a new call start? Calls use the included allowance; Execute may also use bought call time. AI Credit never pays for calls. */
export function callAllowed(s: SpendState, tier: string, topUpSecondsLeft: number) {
  if (s.usedMicro < s.allowanceMicro) return true;
  return (tier === "pro" || tier === "execute") && topUpSecondsLeft > 0;
}

export const AI_CREDIT_MESSAGE =
  "You've used this month's included AI. Add Plexecute AI Credit in Billing to keep going.";
export const FREE_AI_MESSAGE =
  "You've used today's free AI allowance. It resets at midnight; Pro and Execute include far more AI.";

/** Show a pound amount in the member's market: pounds for the UK, converted dollars for the US. */
export function displayMoney(gbp: number, market: "GB" | "US", usdPerGbp: number | null) {
  if (market === "US" && usdPerGbp) return `$${(gbp * usdPerGbp).toFixed(2)}`;
  return `£${gbp.toFixed(2)}`;
}
