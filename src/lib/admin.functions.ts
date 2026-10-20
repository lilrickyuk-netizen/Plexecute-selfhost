import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Caller's own admin status, read through RLS (own role rows only). */
export const getMyAdminStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    return { isAdmin: (data ?? []).some((r) => r.role === "admin") };
  });

/** Aggregate, privacy-safe operational overview. Never returns user PII. */
export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(roles ?? []).some((r) => r.role === "admin")) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const count = async (
      t:
        | "profiles"
        | "plan_blocks"
        | "coach_messages"
        | "call_logs"
        | "billing_events"
        | "audit_events",
      recent = false,
    ) => {
      let q = supabaseAdmin.from(t).select("*", { count: "exact", head: true });
      if (recent) q = q.gte(t === "billing_events" ? "received_at" : "created_at", since);
      const { count: c } = await q;
      return c ?? 0;
    };
    const [users, newUsers, blocks7, coach7, calls7, billing7, audit7, tiers] = await Promise.all([
      count("profiles"),
      count("profiles", true),
      count("plan_blocks", true),
      count("coach_messages", true),
      count("call_logs", true),
      count("billing_events", true),
      count("audit_events", true),
      supabaseAdmin.from("profiles").select("tier"),
    ]);
    const tierCounts: Record<string, number> = {};
    for (const p of tiers.data ?? []) tierCounts[p.tier] = (tierCounts[p.tier] ?? 0) + 1;
    const m = await import("./integrations.server");
    const { data: rw } = await supabaseAdmin.from("execution_rewards").select("state,last_error");
    const rewards: Record<string, number> = {
      IN_PROGRESS: 0,
      EARNED: 0,
      NOT_EARNED: 0,
      APPLIED: 0,
      EXPIRED: 0,
      needs_attention: 0,
    };
    for (const r of rw ?? []) {
      rewards[r.state] = (rewards[r.state] ?? 0) + 1;
      if (r.state === "EARNED" && r.last_error) rewards["needs_attention"]!++;
    }
    return {
      rewards,
      users,
      newUsers,
      blocks7,
      coach7,
      calls7,
      billing7,
      audit7,
      tierCounts,
      services: {
        payments: m.stripeConfigured(),
        calls: m.twilioConfigured(),
        email: m.emailConfigured(),
        cron: !!m.env("CRON_SECRET"),
      },
    };
  });
