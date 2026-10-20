import { createFileRoute } from "@tanstack/react-router";
import { WEARABLES, type Wearable } from "@/lib/wearables";

// OAuth redirect target for wearable connections. The signed state binds it to the user and the pending connection.
export const Route = createFileRoute("/api/public/wearables/oauth/$provider")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const back = (q: string) =>
          Response.redirect(`${url.origin}/app/settings?wearable=${q}#wearables`, 302);
        if (!(WEARABLES as readonly string[]).includes(params.provider))
          return new Response("Not found", { status: 404 });
        const p = params.provider as Wearable;
        const m = await import("@/lib/wearables.server");
        if (!m.wearableConfig(p)) return back("not_configured");
        if (url.searchParams.get("error")) return back("declined");
        const state = await m.verifyState(url.searchParams.get("state") ?? "");
        const code = url.searchParams.get("code");
        if (!state || state.p !== p || !code) return back("invalid");
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await m.completeConnect(supabaseAdmin, p, code, state, url.origin);
          return back("connected");
        } catch (e) {
          console.error("wearable oauth", p, e);
          return back("failed");
        }
      },
    },
  },
});
