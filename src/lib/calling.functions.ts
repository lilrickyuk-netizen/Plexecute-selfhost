import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseE164, CALL_CONSENT_VERSION } from "@/lib/calling";
import { OCCURRENCE_KINDS } from "@/lib/occurrences";
import { COACHING_STYLES } from "@/lib/coaching-style";

export const getCallingStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cs = await import("@/lib/calling.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: phone }, { data: p }, { data: campaigns }, usage] = await Promise.all([
      supabaseAdmin
        .from("phone_numbers")
        .select("last4,country,verified_at")
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("profiles")
        .select("tier,call_consent_version,call_consent_at,calls_stopped_at")
        .eq("id", context.userId)
        .single(),
      context.supabase
        .from("call_campaigns")
        .select(
          "id,block_id,trigger,state,attempts,max_attempts,acknowledgement,connected_seconds,consumed_at,stop_reason,created_at,next_attempt_at,call_logs(summary,voice_provider)",
        )
        .order("created_at", { ascending: false })
        .limit(40),
      cs.usageFor(supabaseAdmin, context.userId),
    ]);
    const blockIds = [
      ...new Set((campaigns ?? []).map((c) => c.block_id).filter(Boolean)),
    ] as string[];
    const { data: blocks } = blockIds.length
      ? await context.supabase.from("plan_blocks").select("id,title").in("id", blockIds)
      : { data: [] };
    const titles = Object.fromEntries((blocks ?? []).map((b) => [b.id, b.title]));
    return {
      tier: p?.tier ?? "free",
      phone: phone
        ? { last4: phone.last4, country: phone.country, verified: !!phone.verified_at }
        : null,
      consented: p?.call_consent_version === CALL_CONSENT_VERSION,
      consentAt: p?.call_consent_at ?? null,
      stopped: !!p?.calls_stopped_at,
      config: {
        calls: cs.callingReady(),
        verify: cs.verifyConfigured(),
        markets: await cs.approvedMarkets(supabaseAdmin),
        voice: (await import("@/lib/voice.server")).voiceLiveReady(),
      },
      usage: {
        ended:
          usage.secondsLeft <= 0 ||
          !(await (await import("./spend.server")).callSpendOk(context.userId, supabaseAdmin)),
      },
      execute:
        p?.tier === "execute"
          ? await (async () => {
              const e = await cs.executeEligibility(supabaseAdmin, context.userId);
              const { data: prefs } = await context.supabase
                .from("profiles")
                .select(
                  "call_morning_enabled,call_morning_time,call_due_enabled,call_missed_enabled,call_evening_enabled,call_evening_time,call_max_attempts",
                )
                .eq("id", context.userId)
                .single();
              const { data: month } = await context.supabase
                .from("call_campaigns")
                .select("state,attempts,acknowledgement,connected_seconds")
                .eq("policy", "execute")
                .gte("created_at", new Date(Date.now() - 30 * 864e5).toISOString());
              const { callAnalytics } = await import("@/lib/calling");
              return {
                ended:
                  e.secondsLeft <= 0 ||
                  !(await (
                    await import("./spend.server")
                  ).callSpendOk(context.userId, supabaseAdmin)),
                attemptsLast24h: e.attemptsLast24h,
                hold: e.hold,
                prefs,
                analytics: callAnalytics(month ?? []),
                windowEnd: e.window.end.toISOString(),
              };
            })()
          : null,
      campaigns: (campaigns ?? []).map((c) => ({
        ...c,
        title: c.block_id ? (titles[c.block_id] ?? "Session") : "Check-in",
      })),
    };
  });

export const startPhoneVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ phone: z.string().min(8).max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    const cs = await import("@/lib/calling.server");
    const parsed = parseE164(data.phone);
    if (!parsed)
      return { ok: false, error: "Enter the number in international format, like +447700900123." };
    if (!cs.verifyConfigured() || !cs.encryptionConfigured())
      return { ok: false, error: "Phone verification isn't switched on yet." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await cs.sendVerification(parsed.e164);
    await (
      await import("./usage.server")
    ).recordUsage({
      userId: context.userId,
      provider: "twilio_verify",
      feature: "phone_verification",
      unit: "messages",
      quantity: 1,
    });
    // A changed number is unverified and needs renewed consent (§64.5).
    await supabaseAdmin.from("phone_numbers").upsert(
      {
        user_id: context.userId,
        e164_enc: await cs.encryptPhone(parsed.e164),
        last4: parsed.e164.slice(-4),
        country: parsed.country,
        verified_at: null,
      },
      { onConflict: "user_id" },
    );
    await supabaseAdmin
      .from("profiles")
      .update({ call_consent_version: null, call_consent_at: null })
      .eq("id", context.userId);
    return { ok: true, error: null };
  });

export const confirmPhoneVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string().regex(/^\d{4,10}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const cs = await import("@/lib/calling.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("phone_numbers")
      .select("e164_enc")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!row) return { ok: false, error: "Start verification first." };
    const ok = await cs.checkVerification(await cs.decryptPhone(row.e164_enc), data.code);
    if (!ok) return { ok: false, error: "That code didn't work. Check it and try again." };
    await supabaseAdmin
      .from("phone_numbers")
      .update({ verified_at: new Date().toISOString() })
      .eq("user_id", context.userId);
    await supabaseAdmin.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "user",
      action: "phone.verified",
      resource_type: "phone_number",
      outcome: "succeeded",
      metadata: {},
    });
    return { ok: true, error: null };
  });

/** Consent to automated AI calls, recorded with version, time, device and IP (§64.5). */
export const setCallConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ agree: z.boolean(), device: z.string().max(200).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const ip = getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-forwarded-for") ?? null;
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("profiles")
      .update(
        data.agree
          ? {
              call_consent_version: CALL_CONSENT_VERSION,
              call_consent_at: now,
              calls_stopped_at: null,
            }
          : {
              call_consent_version: null,
              call_consent_at: null,
              calls_stopped_at: now,
              calls_enabled: false,
            },
      )
      .eq("id", context.userId);
    await supabaseAdmin.from("consent_records").insert({
      user_id: context.userId,
      purpose: "accountability_calls",
      action: data.agree ? "granted" : "withdrawn",
      policy_version: CALL_CONSENT_VERSION,
      metadata: { device: data.device ?? null, ip },
    });
    if (!data.agree)
      await supabaseAdmin
        .from("call_campaigns")
        .update({ state: "CANCELLED", stop_reason: "consent_withdrawn", next_attempt_at: null })
        .eq("user_id", context.userId)
        .in("state", ["CALL_QUEUED", "RETRY_SCHEDULED"]);
    return { ok: true };
  });

/** STOP ALL CALLS: one action, no second confirmation (§63/§64.9). */
export const stopAllCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("profiles")
      .update({ calls_stopped_at: now, calls_enabled: false })
      .eq("id", context.userId);
    await supabaseAdmin
      .from("call_campaigns")
      .update({ state: "CANCELLED", stop_reason: "stop_all_calls", next_attempt_at: null })
      .eq("user_id", context.userId)
      .in("state", ["CALL_QUEUED", "RETRY_SCHEDULED"]);
    await supabaseAdmin.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "user",
      action: "calls.stop_all",
      resource_type: "profile",
      outcome: "succeeded",
      metadata: {},
    });
    return { ok: true };
  });

export const resumeCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("profiles")
      .update({ calls_stopped_at: null })
      .eq("id", context.userId);
    await supabaseAdmin.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "user",
      action: "calls.resumed",
      resource_type: "profile",
      outcome: "succeeded",
      metadata: {},
    });
    return { ok: true };
  });

/** Ask for a call when a session is due (any life area). */
export const setSessionCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ blockId: z.string().uuid(), on: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: p } = await context.supabase
      .from("profiles")
      .select("tier")
      .eq("id", context.userId)
      .single();
    if (data.on && p?.tier === "free")
      return { ok: false, error: "Calls are part of Pro and Execute." };
    const { error } = await context.supabase
      .from("plan_blocks")
      .update({ call_requested: data.on })
      .eq("id", data.blockId);
    if (error) return { ok: false, error: "Couldn't update that session." };
    return { ok: true, error: null };
  });

export const callMeNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ origin: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    const cs = await import("@/lib/calling.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: p } = await context.supabase
      .from("profiles")
      .select("tier")
      .eq("id", context.userId)
      .single();
    const args = {
      userId: context.userId,
      blockId: null,
      trigger: "call_now" as const,
      dedupe: `now:${Date.now()}`,
      origin: data.origin,
    };
    const r =
      p?.tier === "execute"
        ? await cs.startExecuteCampaign(supabaseAdmin, args)
        : await cs.startProCampaign(supabaseAdmin, args);
    return r.ok ? { ok: true, reason: null } : { ok: false, reason: r.reason };
  });

export const saveExecuteCallPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        call_morning_enabled: z.boolean(),
        call_morning_time: z.string().regex(/^\d{2}:\d{2}$/),
        call_due_enabled: z.boolean(),
        call_missed_enabled: z.boolean(),
        call_evening_enabled: z.boolean(),
        call_evening_time: z.string().regex(/^\d{2}:\d{2}$/),
        call_max_attempts: z.number().int().min(1).max(6),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await (await import("./security.server")).rateLimit("call_settings", context.userId)))
      throw new Error("Too many call-setting changes this hour. Try again later.");
    const { data: p } = await context.supabase
      .from("profiles")
      .select("tier")
      .eq("id", context.userId)
      .single();
    if (p?.tier !== "execute")
      return { ok: false, error: "Persistent calling is part of Execute." };
    const { error } = await context.supabase.from("profiles").update(data).eq("id", context.userId);
    if (error) return { ok: false, error: "Couldn't save." };
    return { ok: true, error: null };
  });

/** Step 47 call settings (Pro and Execute): task types, conversation length, voicemail and call tone. Every change is audited. */
export const saveCallSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        call_allowed_kinds: z
          .array(z.enum(OCCURRENCE_KINDS))
          .max(OCCURRENCE_KINDS.length)
          .nullable(),
        call_max_minutes: z.number().int().min(1).max(10),
        call_voicemail_policy: z.enum(["none", "generic"]),
        call_style: z.enum(COACHING_STYLES).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    if (!(await (await import("./security.server")).rateLimit("call_settings", context.userId)))
      throw new Error("Too many call-setting changes this hour. Try again later.");
    const { data: p } = await context.supabase
      .from("profiles")
      .select("tier")
      .eq("id", context.userId)
      .single();
    if (p?.tier === "free" || !p) return { ok: false, error: "Calls are part of Pro and Execute." };
    const row = {
      ...data,
      call_allowed_kinds:
        data.call_allowed_kinds && data.call_allowed_kinds.length < OCCURRENCE_KINDS.length
          ? data.call_allowed_kinds
          : null,
    };
    const { error } = await context.supabase.from("profiles").update(row).eq("id", context.userId);
    if (error) return { ok: false, error: "Couldn't save." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "user",
      action: "calls.settings_changed",
      resource_type: "profile",
      outcome: "succeeded",
      metadata: row,
    });
    // Immediate enforcement: queued retries for task types now switched off are cancelled.
    if (row.call_allowed_kinds) {
      const { data: open } = await supabaseAdmin
        .from("call_campaigns")
        .select("id,block_id")
        .eq("user_id", context.userId)
        .in("state", ["CALL_QUEUED", "RETRY_SCHEDULED"])
        .not("block_id", "is", null);
      const ids = (open ?? []).map((o) => o.block_id!);
      if (ids.length) {
        const { data: bl } = await supabaseAdmin
          .from("plan_blocks")
          .select("id,occurrence_kind")
          .in("id", ids);
        const off = new Set(
          (bl ?? [])
            .filter((b) => !row.call_allowed_kinds!.includes(b.occurrence_kind as never))
            .map((b) => b.id),
        );
        const cancel = (open ?? []).filter((o) => off.has(o.block_id!)).map((o) => o.id);
        if (cancel.length)
          await supabaseAdmin
            .from("call_campaigns")
            .update({
              state: "CANCELLED",
              stop_reason: "task_type_not_allowed",
              next_attempt_at: null,
            })
            .in("id", cancel);
      }
    }
    return { ok: true, error: null };
  });

/** The user's own call consent and settings history (verification, consent, stop/resume, setting changes). */
export const getCallAuditHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: cons }, { data: aud }, { data: cfg }] = await Promise.all([
      supabaseAdmin
        .from("consent_records")
        .select("action,policy_version,created_at,metadata")
        .eq("user_id", context.userId)
        .eq("purpose", "accountability_calls")
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("audit_events")
        .select("action,created_at")
        .eq("user_id", context.userId)
        .or("action.like.calls.%,action.like.phone.%")
        .order("created_at", { ascending: false })
        .limit(50),
      context.supabase
        .from("profiles")
        .select(
          "call_allowed_kinds,call_max_minutes,call_voicemail_policy,call_style,coaching_style",
        )
        .eq("id", context.userId)
        .single(),
    ]);
    const events = [
      ...(cons ?? []).map((r) => ({
        at: r.created_at,
        what:
          r.action === "granted"
            ? "Agreed to calls"
            : (r.metadata as { via?: string } | null)?.via === "call_keypad"
              ? "Stopped all calls from a call"
              : "Withdrew call consent",
      })),
      ...(aud ?? []).map((r) => ({
        at: r.created_at,
        what:
          (
            {
              "phone.verified": "Phone number verified",
              "calls.stop_all": "Stopped all calls",
              "calls.resumed": "Allowed calls again",
              "calls.settings_changed": "Changed call settings",
            } as Record<string, string>
          )[r.action] ?? r.action,
      })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 50);
    return { settings: cfg, events };
  });
