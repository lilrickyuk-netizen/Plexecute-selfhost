import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Every minute: places requested and planned calls on time. Single-flight per 1-minute slot;
// scheduled_calls rows are claimed atomically, so overlapping runs can never ring twice.
export const Route = createFileRoute("/api/public/cron/calls")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const m = await import("@/lib/integrations.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const origin = m.env("APP_BASE_URL") ?? new URL(request.url).origin;
        const { runTick } = await import("@/lib/jobs.server");
        const tick = await runTick(supabaseAdmin, "calls", 60000, async () =>
          (await import("@/lib/calling.server")).processCalls(supabaseAdmin, origin, new Date()),
        );
        return Response.json({ tick }, { status: tick.status === "dead" ? 500 : 200 });
      },
    },
  },
});
