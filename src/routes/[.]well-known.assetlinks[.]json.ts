import { createFileRoute } from "@tanstack/react-router";
import { assetLinks } from "@/lib/platform";

/** Android App Links + credential sharing. 404 until ANDROID_PACKAGE_NAME and ANDROID_SHA256_CERT_FINGERPRINTS are set. */
export const Route = createFileRoute("/.well-known/assetlinks.json")({
  server: {
    handlers: {
      GET: async () => {
        const body = assetLinks(process.env);
        if (!body) return new Response("Not configured", { status: 404 });
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
        });
      },
    },
  },
});
