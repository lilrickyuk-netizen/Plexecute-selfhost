import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getSafety = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { policyFor, crisisResources } = await import("./safety");
    const { data: flags } = await context.supabase
      .from("safety_flags")
      .select("id,signal,raised_at")
      .is("cleared_at", null)
      .order("raised_at", { ascending: false });
    const { data: events } = await context.supabase
      .from("safety_events")
      .select("id,domain,stage,state,signals,intervention,created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    const { data: p } = await context.supabase
      .from("profiles")
      .select("timezone")
      .eq("id", context.userId)
      .single();
    const policy = policyFor((flags ?? []).map((f) => f.signal as never));
    return {
      flags: flags ?? [],
      events: events ?? [],
      policy,
      resources: crisisResources(p?.timezone),
    };
  });

/** §62.3 user declaration of pregnancy/postpartum. */
export const declarePregnancy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ on: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { recordSafety } = await import("./safety.server");
    if (data.on)
      await recordSafety(context.userId, "user", "declaration", ["pregnancy_postpartum"]);
    else await clear(context.userId, "pregnancy_postpartum");
    return { ok: true };
  });

export const clearSafetyFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        signal: z.enum([
          "exercise_red_flag",
          "pain",
          "pregnancy_postpartum",
          "eating_disorder_risk",
          "self_harm_crisis",
          "immediate_danger",
        ]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await clear(context.userId, data.signal);
    return { ok: true };
  });

async function clear(userId: string, signal: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { recordSafety } = await import("./safety.server");
  await supabaseAdmin
    .from("safety_flags")
    .update({ cleared_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("signal", signal)
    .is("cleared_at", null);
  await recordSafety(userId, "user", "clear", [], [`cleared_${signal}`]);
}
