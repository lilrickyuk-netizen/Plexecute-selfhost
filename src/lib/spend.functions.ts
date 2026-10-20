import { safeReturnOrigin } from "@/lib/return-origin";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Member-safe availability only; internal accounting stays server-side. */
export const getSpendSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const s = await import("./spend.server");
    const st = await s.spendState(context.userId);
    const { memberUsageStatus } = await import("./spend");
    return {
      tier: st.tier,
      ...memberUsageStatus(st, st.tier),
    };
  });

/** Plexecute AI Credit: £14.99 (US: converted dollar price) adds the standard credit pack. Credited only by the signed webhook after payment. */
export const buyAiCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        confirm: z.literal(true),
        countryConfirmed: z.enum(["GB", "US"]),
        origin: z.string().url(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const m = await import("./integrations.server");
    const { marketFor } = await import("./billing");
    const { AI_CREDIT } = await import("./spend");
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("timezone,billing_country")
      .eq("id", context.userId)
      .single();
    const market = marketFor(prof);
    if (data.countryConfirmed !== market) return { url: null, error: "country_mismatch" as const };
    const price = m.env(market === "US" ? AI_CREDIT.envUsd : AI_CREDIT.env);
    if (!m.env("STRIPE_SECRET_KEY") || !price)
      return { url: null, error: "not_configured" as const };
    if (!(await (await import("./flags.server")).flagOn("billing_checkout")))
      return { url: null, error: "paused" as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("customer_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const { data: u } = await context.supabase.auth.getUser();
    const s = await m.stripe("checkout/sessions", "POST", {
      mode: "payment",
      ...(sub?.customer_id
        ? { customer: sub.customer_id }
        : { customer_email: u.user?.email ?? undefined }),
      client_reference_id: context.userId,
      line_items: { 0: { price, quantity: 1 } },
      success_url: `${safeReturnOrigin(data.origin)}/app/billing?status=ai_credit`,
      cancel_url: `${safeReturnOrigin(data.origin)}/app/billing`,
      billing_address_collection: "required",
      metadata: { user_id: context.userId, kind: "ai_credit" },
      payment_intent_data: { metadata: { user_id: context.userId, kind: "ai_credit" } },
    });
    return { url: s["url"] as string, error: null };
  });
