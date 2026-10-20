import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const m = await import("@/lib/integrations.server");
        const secret = m.env("STRIPE_WEBHOOK_SECRET");
        if (!secret) return new Response("Webhook not configured", { status: 503 });
        const raw = await request.text();
        if (
          !(await m.verifyStripeSignature(raw, request.headers.get("stripe-signature"), secret))
        ) {
          return new Response("Invalid signature", { status: 400 });
        }
        const event = JSON.parse(raw) as {
          id: string;
          type: string;
          data: { object: Record<string, unknown> };
        };
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("billing_events").insert({ id: event.id, type: event.type }); // record only; duplicates ignored
        // Durable, idempotent processing: retried with backoff, dead-lettered after the ceiling, replayable by admins.
        await (
          await import("@/lib/jobs.server")
        ).runJob(
          supabaseAdmin,
          "stripe.event",
          `stripe:${event.id}`,
          { event_id: event.id, type: event.type },
          event,
        );
        return new Response("ok");
      },
    },
  },
});
