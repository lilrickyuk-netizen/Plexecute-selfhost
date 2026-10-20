// V3 step 89 / §89: unit-economics instrumentation. Usage is recorded as quantities only
// (tokens, requests, messages, attempts, seconds) per tier, provider, feature, service month,
// market and platform. Money is never estimated here: production COGS is computed later from
// the providers' real invoices/rate cards, and nothing here can change locked prices.

export type UsageUnit =
  | "input_tokens"
  | "output_tokens"
  | "requests"
  | "messages"
  | "attempts"
  | "billed_seconds"
  | "connected_seconds"
  | "voice_seconds"
  | "characters";

export interface UsageInput {
  userId: string | null;
  provider: string;
  feature: string;
  unit: UsageUnit;
  quantity: number;
  ok?: boolean;
  platform?: string;
  market?: string;
}

/** Service month: the paid billing period start when the member has one, else the UTC calendar month. ISO date (YYYY-MM-DD). */
export function serviceMonth(
  now: Date,
  periodStart?: string | null,
  periodEnd?: string | null,
): string {
  if (periodStart && periodEnd && new Date(periodStart) <= now && now < new Date(periodEnd))
    return new Date(periodStart).toISOString().slice(0, 10);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/** Token counts from an AI gateway response body (chat completions or responses API). */
export function tokenUsage(body: unknown): { input: number; output: number } | null {
  const u = (body as { usage?: Record<string, number> } | null)?.usage;
  if (!u) return null;
  const input = u["prompt_tokens"] ?? u["input_tokens"];
  const output = u["completion_tokens"] ?? u["output_tokens"];
  return input == null && output == null ? null : { input: input ?? 0, output: output ?? 0 };
}

export interface UsageRow {
  service_month: string;
  tier: string;
  provider: string;
  feature: string;
  unit: string;
  quantity: number;
  market: string;
  platform: string;
  ok: boolean;
}

/** Totals grouped by the chosen dimensions; counts distinct members is not needed (ids are never exposed). */
export function summariseUsage(
  rows: UsageRow[],
  by: (keyof UsageRow)[] = [
    "service_month",
    "tier",
    "provider",
    "feature",
    "market",
    "platform",
    "unit",
  ],
) {
  const out = new Map<
    string,
    Record<string, unknown> & { quantity: number; events: number; failed: number }
  >();
  for (const r of rows) {
    const key = by.map((k) => String(r[k])).join("|");
    const cur = out.get(key) ?? {
      ...Object.fromEntries(by.map((k) => [k, r[k]])),
      quantity: 0,
      events: 0,
      failed: 0,
    };
    cur.quantity += Number(r.quantity);
    cur.events += 1;
    if (!r.ok) cur.failed += 1;
    out.set(key, cur);
  }
  return [...out.values()].sort(
    (a, b) =>
      String(b["service_month"] ?? "").localeCompare(String(a["service_month"] ?? "")) ||
      b.quantity - a.quantity,
  );
}
