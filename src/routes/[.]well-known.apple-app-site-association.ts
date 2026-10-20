import { createFileRoute } from "@tanstack/react-router";
import { appleAppSiteAssociation } from "@/lib/platform";

/** iOS universal links + shared web credentials. 404 until APPLE_TEAM_ID and IOS_BUNDLE_ID are set. */
export const Route = createFileRoute("/.well-known/apple-app-site-association")({
  server: {
    handlers: {
      GET: async () => {
        const body = appleAppSiteAssociation(process.env);
        if (!body) return new Response("Not configured", { status: 404 });
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
        });
      },
    },
  },
});
