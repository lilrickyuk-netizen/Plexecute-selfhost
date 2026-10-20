import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Every minute: queues Coach prompts at their exact instant a few minutes ahead and sends every
// prompt whose instant has arrived. The 5-minute reminders scan stays as the recovery net.
export const Route = createFileRoute("/api/public/cron/prompts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const m = await import("@/lib/integrations.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const origin = m.env("APP_BASE_URL") ?? new URL(request.url).origin;
        const { runTick } = await import("@/lib/jobs.server");
        const tick = await runTick(supabaseAdmin, "prompts", 60000, async () => {
          const now = new Date();
          const queued = await (
            await import("@/lib/push-schedule.server")
          ).queuePlanPrompts(supabaseAdmin, now);
          const delivery = await (
            await import("@/lib/notify.server")
          ).dispatchDue(supabaseAdmin, origin, new Date());
          return { queued, delivery };
        });
        return Response.json({ tick }, { status: tick.status === "dead" ? 500 : 200 });
      },
    },
  },
});
