import { createFileRoute } from "@tanstack/react-router";

// Provider change notifications (at-least-once). Each is verified against the per-connection secret; the sync it triggers is idempotent.
export const Route = createFileRoute("/api/public/calendar/webhook/$provider")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const url = new URL(request.url);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const m = await import("@/lib/calendar.server");
        if (params.provider === "google") {
          const channelId = request.headers.get("x-goog-channel-id") ?? "",
            secret = request.headers.get("x-goog-channel-token") ?? "";
          const id =
            channelId && secret
              ? await m.connectionForWebhook(supabaseAdmin, { channelId, secret })
              : null;
          if (!id) return new Response("Unknown channel", { status: 404 });
          if (request.headers.get("x-goog-resource-state") !== "sync")
            await m.syncConnection(supabaseAdmin, id, url.origin);
          return new Response(null, { status: 204 });
        }
        if (params.provider === "microsoft") {
          const token = url.searchParams.get("validationToken");
          if (token) return new Response(token, { headers: { "Content-Type": "text/plain" } });
          const body = (await request.json().catch(() => null)) as {
            value?: { subscriptionId: string; clientState?: string }[];
          } | null;
          const ids = new Set<string>();
          for (const n of body?.value ?? []) {
            const id = await m.connectionForWebhook(supabaseAdmin, {
              subscriptionId: n.subscriptionId,
              secret: n.clientState ?? "",
            });
            if (id) ids.add(id);
          }
          if (!ids.size) return new Response("Unknown subscription", { status: 404 });
          for (const id of ids) await m.syncConnection(supabaseAdmin, id, url.origin);
          return new Response(null, { status: 202 });
        }
        return new Response("Not found", { status: 404 });
      },
    },
  },
});
