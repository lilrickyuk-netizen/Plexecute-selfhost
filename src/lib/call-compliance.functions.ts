import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  if (!(data ?? []).some((r: { role: string }) => r.role === "admin")) throw new Error("Forbidden");
}

export const getCallManifest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("call_market_manifest").select("*").order("country");
    const { CALL_CONSENT_VERSION, DISCLOSURE_SCRIPT_VERSION } = await import("@/lib/calling");
    return {
      rows: data ?? [],
      current: { consent: CALL_CONSENT_VERSION, disclosure: DISCLOSURE_SCRIPT_VERSION },
    };
  });

const t = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .nullable();
export const saveCallMarket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        country: z.string().regex(/^[A-Z]{2}$/),
        enabled: z.boolean(),
        signed_off_by: z.string().trim().max(120).nullable(),
        review_ref: z.string().trim().max(200).nullable(),
        permitted_start: t,
        permitted_end: t,
        consent_version: z.string().max(60).nullable(),
        disclosure_version: z.string().max(60).nullable(),
        max_attempts_per_occurrence: z.number().int().min(1).max(6).nullable(),
        max_per_24h: z.number().int().min(1).max(12).nullable(),
        pro_retry_allowed: z.boolean(),
        min_answer_rate: z.number().min(0).max(1).nullable(),
        notes: z.string().max(1000).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    // Only the owner signs off: the name is taken from the signed-in owner, never typed in.
    if (data.signed_off_by) {
      const { data: me } = await context.supabase
        .from("profiles")
        .select("display_name")
        .eq("id", context.userId)
        .maybeSingle();
      data.signed_off_by = me?.display_name?.trim() || "Owner";
    }
    if (
      data.enabled &&
      !(
        data.signed_off_by &&
        data.permitted_start &&
        data.permitted_end &&
        data.consent_version &&
        data.disclosure_version
      )
    )
      return {
        ok: false,
        error:
          "To switch a country on, fill in who signed it off, allowed hours and both approved versions.",
      };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prev } = await supabaseAdmin
      .from("call_market_manifest")
      .select("signed_off_by,review_ref,signed_off_at")
      .eq("country", data.country)
      .maybeSingle();
    const signoffChanged =
      prev?.signed_off_by !== data.signed_off_by || prev?.review_ref !== data.review_ref;
    const row = {
      ...data,
      approval_basis: !data.signed_off_by
        ? "not_reviewed"
        : data.review_ref
          ? "externally_reviewed"
          : "owner_self_approval",
      signed_off_at: data.signed_off_by
        ? signoffChanged || !prev?.signed_off_at
          ? new Date().toISOString()
          : prev.signed_off_at
        : null,
      updated_by: context.userId,
    };
    const { error } = await supabaseAdmin
      .from("call_market_manifest")
      .upsert(row, { onConflict: "country" });
    if (error) return { ok: false, error: error.message };
    await supabaseAdmin.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "admin",
      action: "calls.market_saved",
      resource_type: "call_market_manifest",
      outcome: "succeeded",
      metadata: row,
    });
    return { ok: true, error: null };
  });

/** Kill switch for one market or GLOBAL. Takes effect immediately: queued calls in scope are cancelled. */
export const setCallKillSwitch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ country: z.string().regex(/^([A-Z]{2}|GLOBAL)$/), killed: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("call_market_manifest")
      .upsert(
        { country: data.country, killed: data.killed, updated_by: context.userId },
        { onConflict: "country" },
      );
    let cancelled = 0;
    if (data.killed) {
      let users: string[] | null = null;
      if (data.country !== "GLOBAL") {
        const { data: ph } = await supabaseAdmin
          .from("phone_numbers")
          .select("user_id")
          .eq("country", data.country);
        users = (ph ?? []).map((p) => p.user_id);
      }
      if (users === null || users.length) {
        let q = supabaseAdmin
          .from("call_campaigns")
          .update({
            state: "CANCELLED",
            stop_reason: data.country === "GLOBAL" ? "global_kill_switch" : "market_kill_switch",
            next_attempt_at: null,
          })
          .in("state", ["CALL_QUEUED", "RETRY_SCHEDULED"]);
        if (users) q = q.in("user_id", users);
        const { data: c } = await q.select("id");
        cancelled = c?.length ?? 0;
      }
    }
    await supabaseAdmin.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "admin",
      action: data.killed ? "calls.kill_switch_on" : "calls.kill_switch_off",
      resource_type: "call_market_manifest",
      outcome: "succeeded",
      metadata: { country: data.country, cancelled },
    });
    return { ok: true, cancelled };
  });
