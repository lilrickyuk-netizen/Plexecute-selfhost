import { createFileRoute } from "@tanstack/react-router";

// Call every 30 minutes with header Authorization: Bearer <CRON_SECRET>: polls wearables (backs up missed webhooks, retries degraded ones).
export const Route = createFileRoute("/api/public/cron/wearables")({
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
        ).runTick(supabaseAdmin, "wearables", 30 * 60000, async () => {
          const { syncWearable } = await import("@/lib/wearables.server");
          const cutoff = new Date(Date.now() - 6 * 36e5).toISOString();
          const { data } = await supabaseAdmin
            .from("wearable_connections")
            .select("id")
            .in("status", ["active", "degraded"])
            .or(`last_sync_at.is.null,last_sync_at.lt.${cutoff}`)
            .order("last_sync_at", { ascending: true, nullsFirst: true })
            .limit(25);
          const out: Record<string, number> = {};
          for (const c of data ?? []) {
            const s = await syncWearable(supabaseAdmin, c.id);
            out[s] = (out[s] ?? 0) + 1;
          }
          return { synced: data?.length ?? 0, results: out };
        });
        return Response.json(tick, { status: tick.status === "dead" ? 500 : 200 });
      },
    },
  },
});
