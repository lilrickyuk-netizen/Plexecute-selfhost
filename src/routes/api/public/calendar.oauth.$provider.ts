import { createFileRoute } from "@tanstack/react-router";

// OAuth redirect target for Google / Microsoft calendar connections. The signed state binds it to the user.
export const Route = createFileRoute("/api/public/calendar/oauth/$provider")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const back = (q: string) =>
          Response.redirect(`${url.origin}/app/settings?calendar=${q}#calendar`, 302);
        if (params.provider !== "google" && params.provider !== "microsoft")
          return new Response("Not found", { status: 404 });
        const m = await import("@/lib/calendar.server");
        if (!m.providerConfig(params.provider)) return back("not_configured");
        if (url.searchParams.get("error")) return back("declined");
        const state = await m.verifyState(url.searchParams.get("state") ?? "");
        const code = url.searchParams.get("code");
        if (!state || state.p !== params.provider || !code) return back("invalid");
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await m.completeConnect(supabaseAdmin, params.provider, code, state, url.origin);
          return back("connected");
        } catch (e) {
          console.error("calendar oauth", e);
          return back("failed");
        }
      },
    },
  },
});
