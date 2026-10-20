import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SUPPORT_CATEGORIES, cleanDiagnostics, looksUrgent, supportFor } from "./support";

/** Sends a help request to the support inbox (durable job) with the member's tier target. */
export const submitSupportRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        category: z.enum(SUPPORT_CATEGORIES),
        message: z.string().trim().min(10).max(4000),
        diagnostics: z.record(z.string(), z.unknown()).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // Urgent wording is answered with emergency guidance, never queued as an ordinary ticket.
    if (looksUrgent(data.message)) return { ok: false as const, urgent: true as const };
    if (!(await (await import("./security.server")).rateLimit("support_request", context.userId)))
      throw new Error("Too many requests today. Try again tomorrow.");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: p } = await context.supabase
      .from("profiles")
      .select("tier")
      .eq("id", context.userId)
      .single();
    const tier = p?.tier ?? "free";
    const model = supportFor(tier);
    const { data: row, error } = await db
      .from("support_requests")
      .insert({
        user_id: context.userId,
        category: data.category,
        message: data.message,
        tier,
        priority: model.priority,
        target_label: model.target,
        diagnostics: cleanDiagnostics(data.diagnostics as never) as never,
      })
      .select("id")
      .single();
    if (error || !row) throw new Error("Couldn't send your request.");
    const job = await (
      await import("./jobs.server")
    ).runJob(db, "email.support", `support-email:${row.id}`, { request_id: row.id });
    await db.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "user",
      action: "support.request_sent",
      resource_type: "support_request",
      resource_id: row.id,
      outcome: "ok",
      metadata: { category: data.category, emailed: job?.status === "succeeded" },
    });
    return {
      ok: true as const,
      urgent: false as const,
      id: row.id,
      target: model.target,
      emailed: job?.status === "succeeded",
    };
  });
