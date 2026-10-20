import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { summariseProviders } from "./observability";

/** Browser errors from the app. Public (errors can happen signed out), rate limited, message scrubbed server-side. */
export const reportClientError = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({ message: z.string().max(1000), route: z.string().max(300) }).parse(i),
  )
  .handler(async ({ data }) => {
    const { rateLimit, hashSubject } = await import("./security.server");
    const ip =
      getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-forwarded-for") ?? "unknown";
    if (!(await rateLimit("client_error", await hashSubject(ip)))) return { ok: false };
    await (
      await import("./observability.server")
    ).captureError(data.message, { source: "client", route: data.route });
    return { ok: true };
  });

/** App health for admins: error groups, provider health, queue health and monitoring switches. Counts only. */
export const getAppHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(roles ?? []).some((r) => r.role === "admin")) throw new Error("Forbidden");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 864e5).toISOString();
    const [{ data: errs }, { data: calls }] = await Promise.all([
      db
        .from("error_events")
        .select("source,fingerprint,route,message,created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000),
      db
        .from("provider_calls")
        .select("provider,ok,latency_ms,created_at")
        .gte("created_at", since)
        .limit(20000),
    ]);
    const groups = new Map<
      string,
      { message: string; route: string | null; source: string; count: number; last: string }
    >();
    for (const e of errs ?? []) {
      const g = groups.get(e.fingerprint);
      if (g) g.count++;
      else
        groups.set(e.fingerprint, {
          message: e.message,
          route: e.route,
          source: e.source,
          count: 1,
          last: e.created_at,
        });
    }
    const bySource: Record<string, number> = {};
    for (const e of errs ?? []) bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    return {
      errors24h: errs?.length ?? 0,
      bySource,
      topErrors: [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 10),
      providers: summariseProviders(calls ?? []),
      monitoring: {
        errorTracking: !!process.env["SENTRY_DSN"],
        productAnalytics: !!process.env["POSTHOG_KEY"],
      },
    };
  });
