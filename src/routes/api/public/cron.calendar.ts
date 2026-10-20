import { createFileRoute } from "@tanstack/react-router";

// Call every 15 minutes with header Authorization: Bearer <CRON_SECRET>: syncs calendars, renews notifications, retries degraded ones.
export const Route = createFileRoute("/api/public/cron/calendar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { env } = await import("@/lib/integrations.server");
        const secret = env("CRON_SECRET");
        if (
          !(await import("@/lib/security")).bearerMatches(
            request.headers.get("authorization"),
            secret,
          )
        )
          return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const tick = await (
          await import("@/lib/jobs.server")
        ).runTick(supabaseAdmin, "calendar", 15 * 60000, async () => {
          const { syncConnection } = await import("@/lib/calendar.server");
          const cutoff = new Date(Date.now() - 14 * 60000).toISOString();
          const { data } = await supabaseAdmin
            .from("calendar_connections")
            .select("id")
            .in("status", ["active", "degraded"])
            .neq("provider", "device")
            .or(`last_sync_at.is.null,last_sync_at.lt.${cutoff}`)
            .limit(50);
          const out: Record<string, number> = {};
          for (const c of data ?? []) {
            const s = await syncConnection(
              supabaseAdmin,
              c.id,
              env("APP_BASE_URL") ?? new URL(request.url).origin,
            );
            out[s] = (out[s] ?? 0) + 1;
          }
          return { synced: data?.length ?? 0, results: out };
        });
        return Response.json(tick, { status: tick.status === "dead" ? 500 : 200 });
      },
    },
  },
});
