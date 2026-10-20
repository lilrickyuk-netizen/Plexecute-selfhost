import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { currentConsents, type ConsentRow } from "./consent";

export const getMyConsents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("consent_records")
      .select("purpose,action,policy_version,created_at,scope,source,provider,domain,subject_id")
      .order("created_at", { ascending: false })
      .limit(500);
    const rows = (data ?? []) as ConsentRow[];
    return { current: currentConsents(rows), history: rows.slice(0, 100) };
  });

/** Onboarding acknowledgements (terms, safety notice, age) recorded server-side with their versions. */
export const recordOnboardingConsents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ adult: z.literal(true), safety: z.literal(true) }).parse(d))
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordConsent } = await import("./consent.server");
    for (const purpose of [
      "terms_and_privacy",
      "safety_acknowledgement",
      "age_confirmation",
    ] as const)
      await recordConsent(supabaseAdmin, {
        userId: context.userId,
        purpose,
        granted: true,
        source: "onboarding",
      });
    return { ok: true };
  });
