import { safeReturnOrigin } from "@/lib/return-origin";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Member-safe: only whether paid plans and email are switched on (no provider health or secrets). */
export const getMemberServiceStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const m = await import("./integrations.server");
    const flags = await import("./flags.server");
    return {
      payments:
        m.stripeConfigured() &&
        !!m.env("STRIPE_WEBHOOK_SECRET") &&
        (await flags.flagOn("billing_checkout")),
      email: m.emailConfigured() && (await flags.flagOn("email_notifications")),
    };
  });

export const getIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Service status is internal: admins only. Members get the Connections page instead.
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(roles ?? []).some((r: { role: string }) => r.role === "admin"))
      throw new Error("Forbidden");
    const m = await import("./integrations.server");
    const { serviceState } = await import("./resilience");
    type ServiceState = import("./resilience").ServiceState;
    const flags = await import("./flags.server");
    // Step 67: recent outcomes per outside service (service role; provider_calls is not member-readable).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: calls } = await supabaseAdmin
      .from("provider_calls")
      .select("provider,ok")
      .order("created_at", { ascending: false })
      .limit(200);
    const recentBy = (name: string) =>
      (calls ?? [])
        .filter((c) => c.provider === name)
        .slice(0, 5)
        .map((c) => c.ok as boolean);
    const health = async (
      configured: boolean,
      provider: string,
      flag?: string,
    ): Promise<ServiceState> =>
      serviceState({
        configured,
        pausedByFlag: flag ? !(await flags.flagOn(flag)) : false,
        recent: recentBy(provider),
      });
    return {
      payments: await health(
        m.stripeConfigured() && !!m.env("STRIPE_WEBHOOK_SECRET"),
        "Stripe payments",
        "billing_checkout",
      ),
      calls: await health(m.twilioConfigured(), "Twilio calls", "calls_outbound"),
      email: await health(m.emailConfigured(), "Resend email", "email_notifications"),
      ai: await health(!!m.env("OPENAI_API_KEY"), "AI coach", "coach_ai"),
      cron: serviceState({ configured: !!m.env("CRON_SECRET") }),
      food: await health(
        !!(m.env("FATSECRET_CLIENT_ID") && m.env("FATSECRET_CLIENT_SECRET")),
        "FatSecret food",
      ),
      googleCalendar: await health(
        !!(m.env("GOOGLE_CALENDAR_CLIENT_ID") && m.env("GOOGLE_CALENDAR_CLIENT_SECRET")),
        "Google calendar",
        "calendar_sync",
      ),
      microsoftCalendar: await health(
        !!(m.env("MICROSOFT_CALENDAR_CLIENT_ID") && m.env("MICROSOFT_CALENDAR_CLIENT_SECRET")),
        "Microsoft calendar",
        "calendar_sync",
      ),
      wearables: {
        whoop: await health(!!m.env("WHOOP_CLIENT_ID"), "WHOOP", "wearable_sync"),
        oura: await health(!!m.env("OURA_CLIENT_ID"), "Oura", "wearable_sync"),
        fitbit: await health(!!m.env("FITBIT_CLIENT_ID"), "Fitbit", "wearable_sync"),
        strava: await health(!!m.env("STRAVA_CLIENT_ID"), "Strava", "wearable_sync"),
        garmin: await health(!!m.env("GARMIN_CLIENT_ID"), "Garmin", "wearable_sync"),
      },
    };
  });

export const startCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        tier: z.enum(["pro", "execute"]),
        interval: z.enum(["month", "year"]).default("month"),
        trial: z.boolean(),
        disclosureAccepted: z.boolean().optional(),
        countryConfirmed: z.enum(["GB", "US"]),
        origin: z.string().url(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const m = await import("./integrations.server");
    const B = await import("./billing");
    const { supabase, userId, claims } = context;
    const { data: profTz } = await supabase
      .from("profiles")
      .select("timezone,billing_country")
      .eq("id", userId)
      .single();
    const market = B.marketFor(profTz);
    // The member must confirm their billing-address country matches their billing country before paying.
    if (data.countryConfirmed !== market) return { url: null, error: "country_mismatch" as const };
    const price = m.env(B.priceEnvFor(data.tier, data.interval, market));
    if (!m.env("STRIPE_SECRET_KEY") || !price)
      return { url: null, error: "not_configured" as const };
    if (!(await (await import("./flags.server")).flagOn("billing_checkout")))
      return { url: null, error: "paused" as const };
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (sub && ["active", "trialing", "past_due"].includes(sub.status))
      return { url: null, error: "already_subscribed" as const };
    const trial = data.trial && !sub?.trial_used;
    // §5.3: a trial starts only after the user saw and accepted the full disclosure.
    if (trial && !data.disclosureAccepted)
      return { url: null, error: "disclosure_required" as const };
    const session = await m.stripe("checkout/sessions", "POST", {
      mode: "subscription",
      success_url: `${safeReturnOrigin(data.origin)}/app/billing?status=success`,
      cancel_url: `${safeReturnOrigin(data.origin)}/app/billing?status=cancelled`,
      client_reference_id: userId,
      customer: sub?.customer_id ?? undefined,
      customer_email: sub?.customer_id ? undefined : (claims as { email?: string }).email,
      line_items: { 0: { price, quantity: 1 } },
      // Stripe Tax works out UK VAT and each US state's sales tax from the billing address.
      // Unset = leave tax to the Stripe account default (Managed Payments requires automatic tax on).
      automatic_tax:
        m.env("STRIPE_AUTOMATIC_TAX") === "false"
          ? { enabled: false }
          : m.env("STRIPE_AUTOMATIC_TAX") === "true"
            ? { enabled: true }
            : undefined,
      billing_address_collection: "required",
      customer_update:
        sub?.customer_id && m.env("STRIPE_AUTOMATIC_TAX") === "true"
          ? { address: "auto" }
          : undefined,
      subscription_data: {
        metadata: { user_id: userId },
        trial_period_days: trial ? 7 : undefined,
      },
      metadata: { user_id: userId },
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_events").insert({
      user_id: userId,
      actor_type: "user",
      action: "billing.checkout_started",
      resource_type: "subscription",
      outcome: "succeeded",
      metadata: { tier: data.tier, interval: data.interval, trial },
    });
    return { url: session["url"] as string, error: null };
  });

/** §55: explicit 60-minute top-up purchase (Execute only). Minutes are credited only by the signed webhook after payment. */
export const buyVoiceTopUp = createServerFn({ method: "POST" })
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
    const { VOICE_TOPUP, providerState, canBuyTopUp, marketFor } = await import("./billing");
    const { data: profTz } = await context.supabase
      .from("profiles")
      .select("timezone,billing_country")
      .eq("id", context.userId)
      .single();
    if (data.countryConfirmed !== marketFor(profTz))
      return { url: null, error: "country_mismatch" as const };
    const price = m.env(marketFor(profTz) === "US" ? VOICE_TOPUP.envUsd : VOICE_TOPUP.env);
    if (!m.env("STRIPE_SECRET_KEY") || !price)
      return { url: null, error: "not_configured" as const };
    if (!(await (await import("./flags.server")).flagOn("billing_checkout")))
      return { url: null, error: "paused" as const };
    const { data: sub } = await context.supabase
      .from("subscriptions")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!sub?.customer_id || !canBuyTopUp(sub.tier, providerState(sub).state))
      return { url: null, error: "execute_only" as const };
    const s = await m.stripe("checkout/sessions", "POST", {
      mode: "payment",
      customer: sub.customer_id,
      client_reference_id: context.userId,
      line_items: { 0: { price, quantity: 1 } },
      success_url: `${safeReturnOrigin(data.origin)}/app/billing?status=topup`,
      cancel_url: `${safeReturnOrigin(data.origin)}/app/billing`,
      metadata: { user_id: context.userId, kind: "voice_topup" },
      payment_intent_data: { metadata: { user_id: context.userId, kind: "voice_topup" } },
    });
    return { url: s["url"] as string, error: null };
  });

/** §54 restore: re-reads provider state; never fabricates entitlement. */
export const restoreSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const m = await import("./integrations.server");
    if (!m.env("STRIPE_SECRET_KEY"))
      return { restored: false as const, reason: "not_configured" as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return (await import("./billing.server")).restoreFromProvider(supabaseAdmin, context.userId);
  });

export const getTrialDisclosure = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ tier: z.enum(["pro", "execute"]), interval: z.enum(["month", "year"]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const B = await import("./billing");
    const { data: profTz } = await context.supabase
      .from("profiles")
      .select("timezone,billing_country")
      .eq("id", context.userId)
      .single();
    const d = B.trialDisclosure(data.tier, data.interval, new Date(), B.marketFor(profTz));
    return { ...d, renewalDate: d.renewalDate.toISOString() };
  });

/** Plan state, allowance usage with 80/100% warnings, and wallet history. */
export const getBillingOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const B = await import("./billing");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cs = await import("./calling.server");
    const [{ data: sub }, { data: prof }, { data: ledger }] = await Promise.all([
      context.supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("profiles")
        .select("tier,timezone,billing_country")
        .eq("id", context.userId)
        .single(),
      context.supabase
        .from("entitlement_ledger")
        .select("id,capability,amount,reason,created_at")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    const tier = prof?.tier ?? "free";
    const ps = B.providerState(sub);
    const callUsage =
      tier === "pro" || tier === "execute"
        ? {
            ended:
              !(await (
                await import("./spend.server")
              ).callSpendOk(context.userId, supabaseAdmin)) ||
              (tier === "execute" &&
                !(await cs.executeEligibility(supabaseAdmin, context.userId)).secondsLeft),
          }
        : null;
    return {
      tier,
      market: B.marketFor(prof),
      state: ps.state,
      sub,
      canBuyTopUp: B.canBuyTopUp(tier, ps.state),
      callUsage,
      wallet: (ledger ?? []).filter((l) => l.capability === B.VOICE_TOPUP.capability),
    };
  });

export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ origin: z.string().url() }).parse(i))
  .handler(async ({ data, context }) => {
    const m = await import("./integrations.server");
    if (!m.env("STRIPE_SECRET_KEY")) return { url: null, error: "not_configured" as const };
    const { data: sub } = await context.supabase
      .from("subscriptions")
      .select("customer_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!sub?.customer_id) return { url: null, error: "no_customer" as const };
    const s = await m.stripe("billing_portal/sessions", "POST", {
      customer: sub.customer_id,
      return_url: `${safeReturnOrigin(data.origin)}/app/billing`,
    });
    return { url: s["url"] as string, error: null };
  });

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const m = await import("./integrations.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { deleteAccountJob } = await import("./privacy.functions");
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    return deleteAccountJob(supabaseAdmin, context.userId, async () => {
      if (
        sub?.subscription_id &&
        ["active", "trialing", "past_due"].includes(sub.status) &&
        m.env("STRIPE_SECRET_KEY")
      ) {
        await fetch(`https://api.stripe.com/v1/subscriptions/${sub.subscription_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${m.env("STRIPE_SECRET_KEY")}` },
        });
      }
    });
  });

export const wipeMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { wipeUserData } = await import("./privacy.functions");
    const removed = await wipeUserData(supabaseAdmin, context.userId);
    await supabaseAdmin.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "user",
      action: "data_rights.wipe_all",
      resource_type: "data_rights",
      outcome: "succeeded",
      metadata: { tables: Object.keys(removed).length },
    });
    return { ok: true };
  });

export const requestAccountabilityCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ origin: z.string().url() }).parse(i))
  .handler(async ({ data, context }) => {
    const m = await import("./integrations.server");
    if (!m.twilioConfigured()) return { ok: false, error: "not_configured" as const };
    const { data: p } = await context.supabase
      .from("profiles")
      .select("tier,phone_number")
      .eq("id", context.userId)
      .single();
    if (!p || p.tier === "free") return { ok: false, error: "upgrade" as const };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (p.tier === "pro") {
      // V3 §64.8: Pro calls are campaigns from the monthly allowance (verified number, consent, 2 tries).
      const r = await (
        await import("@/lib/calling.server")
      ).startProCampaign(supabaseAdmin, {
        userId: context.userId,
        blockId: null,
        trigger: "call_now",
        dedupe: `now:${Date.now()}`,
        origin: safeReturnOrigin(data.origin),
      });
      return r.ok ? { ok: true, error: null } : { ok: false, error: r.reason as "limit" };
    }
    const r = await (
      await import("@/lib/calling.server")
    ).startExecuteCampaign(supabaseAdmin, {
      userId: context.userId,
      blockId: null,
      trigger: "call_now",
      dedupe: `now:${Date.now()}`,
      origin: safeReturnOrigin(data.origin),
    });
    return r.ok ? { ok: true, error: null } : { ok: false, error: r.reason as "limit" };
  });
