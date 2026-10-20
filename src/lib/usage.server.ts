import { serviceMonth, tokenUsage, type UsageInput } from "./usage";

/** Record usage for cost measurement. Never throws: metering must not break the member's action. */
export async function recordUsage(items: UsageInput | UsageInput[]): Promise<void> {
  const list = (Array.isArray(items) ? items : [items]).filter(
    (i) => i.quantity > 0 || i.ok === false,
  );
  if (!list.length) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date();
    const ctx = new Map<string, { tier: string; month: string; market: string }>();
    for (const uid of new Set(list.map((i) => i.userId).filter((x): x is string => !!x))) {
      const [{ data: p }, { data: s }, { data: ph }] = await Promise.all([
        supabaseAdmin.from("profiles").select("tier").eq("id", uid).maybeSingle(),
        supabaseAdmin
          .from("subscriptions")
          .select("current_period_start,current_period_end,status")
          .eq("user_id", uid)
          .maybeSingle(),
        supabaseAdmin.from("phone_numbers").select("country").eq("user_id", uid).maybeSingle(),
      ]);
      const trial = s?.status === "trialing";
      ctx.set(uid, {
        tier: (p?.tier ?? "free") + (trial ? "_trial" : ""),
        month: serviceMonth(now, s?.current_period_start, s?.current_period_end),
        market: ph?.country ?? "unknown",
      });
    }
    const fallback = { tier: "none", month: serviceMonth(now), market: "unknown" };
    await supabaseAdmin.from("usage_events").insert(
      list.map((i) => {
        const c = (i.userId && ctx.get(i.userId)) || fallback;
        return {
          user_id: i.userId,
          service_month: c.month,
          tier: c.tier,
          provider: i.provider,
          feature: i.feature,
          unit: i.unit,
          quantity: Math.max(0, i.quantity),
          market: i.market ?? c.market,
          platform: i.platform ?? "web",
          ok: i.ok ?? true,
        };
      }),
    );
  } catch (e) {
    console.error("usage metering failed", e instanceof Error ? e.message : "error");
  }
}

/** Convenience: record an AI call's real token counts (or one failed request). */
export async function recordAiUsage(
  userId: string | null,
  feature: string,
  model: string,
  body: unknown,
  ok = true,
) {
  const t = tokenUsage(body);
  const provider = `lovable_ai:${model}`;
  // Money is reserved and settled by meteredAiFetch; this function records quantities only.
  await recordUsage([
    { userId, provider, feature, unit: "requests", quantity: 1, ok },
    ...(t
      ? [
          { userId, provider, feature, unit: "input_tokens" as const, quantity: t.input, ok },
          { userId, provider, feature, unit: "output_tokens" as const, quantity: t.output, ok },
        ]
      : []),
  ]);
}
