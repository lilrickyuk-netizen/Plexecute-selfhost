import { createFileRoute } from "@tanstack/react-router";
import { WEARABLES, type Wearable } from "@/lib/wearables";

// Provider change notifications (at-least-once). Bodies are never trusted as data: a verified or
// identified notification only triggers an idempotent re-read from the provider with our own tokens.
const hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export const Route = createFileRoute("/api/public/wearables/webhook/$provider")({
  server: {
    handlers: {
      // Subscription verification handshakes.
      GET: async ({ request, params }) => {
        const url = new URL(request.url),
          { env } = await import("@/lib/integrations.server");
        if (params.provider === "strava") {
          const ok = (await import("@/lib/security")).safeEqual(
            url.searchParams.get("hub.verify_token"),
            env("STRAVA_WEBHOOK_VERIFY_TOKEN"),
          );
          return ok
            ? Response.json({ "hub.challenge": url.searchParams.get("hub.challenge") })
            : new Response("Forbidden", { status: 403 });
        }
        if (params.provider === "fitbit") {
          const v = env("FITBIT_SUBSCRIBER_VERIFY");
          return new Response(null, {
            status: (await import("@/lib/security")).safeEqual(url.searchParams.get("verify"), v)
              ? 204
              : 404,
          });
        }
        if (params.provider === "oura") {
          const v = env("OURA_WEBHOOK_VERIFY_TOKEN");
          return (await import("@/lib/security")).safeEqual(
            url.searchParams.get("verification_token"),
            v,
          )
            ? Response.json({ challenge: url.searchParams.get("challenge") })
            : new Response("Forbidden", { status: 403 });
        }
        return new Response("Not found", { status: 404 });
      },
      POST: async ({ request, params }) => {
        if (!(WEARABLES as readonly string[]).includes(params.provider))
          return new Response("Not found", { status: 404 });
        const p = params.provider as Wearable,
          url = new URL(request.url),
          raw = await request.text();
        const m = await import("@/lib/wearables.server"),
          { env } = await import("@/lib/integrations.server");
        const body = (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })();
        const ids = new Set<string>();
        if (p === "whoop") {
          if (
            !(await m.verifyWhoop(
              raw,
              request.headers.get("x-whoop-signature"),
              request.headers.get("x-whoop-signature-timestamp"),
            ))
          )
            return new Response("Bad signature", { status: 401 });
          if (body?.user_id != null) ids.add(String(body.user_id));
        } else if (p === "fitbit") {
          if (!(await m.verifyFitbit(raw, request.headers.get("x-fitbit-signature"))))
            return new Response("Bad signature", { status: 404 });
          for (const n of Array.isArray(body) ? body : [])
            if (n?.ownerId) ids.add(String(n.ownerId));
        } else if (p === "oura") {
          const s = env("OURA_CLIENT_SECRET"),
            sig = request.headers.get("x-oura-signature"),
            ts = request.headers.get("x-oura-timestamp") ?? "";
          if (!s || !sig) return new Response("Bad signature", { status: 401 });
          const k = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(s),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"],
          );
          if (
            hex(
              await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(ts + raw)),
            ).toLowerCase() !== sig.toLowerCase()
          )
            return new Response("Bad signature", { status: 401 });
          if (body?.user_id) ids.add(String(body.user_id));
        } else if (p === "strava") {
          // Strava events are unsigned; they only name an athlete, and we re-read with that athlete's own token.
          if (body?.owner_id != null) ids.add(String(body.owner_id));
        } else if (p === "garmin") {
          const t = env("GARMIN_WEBHOOK_TOKEN");
          if (!(await import("@/lib/security")).safeEqual(url.searchParams.get("token"), t))
            return new Response("Unauthorized", { status: 401 });
          for (const arr of Object.values(body ?? {}))
            if (Array.isArray(arr)) for (const r of arr) if (r?.userId) ids.add(String(r.userId));
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let n = 0;
        for (const ext of ids)
          for (const id of await m.connectionsForExternal(supabaseAdmin, p, ext)) {
            // Strava events are unsigned: never disconnect from them, and throttle the re-read so
            // forged events cannot force repeated syncs. A real revocation surfaces in the sync itself.
            if (p === "strava") {
              const { rateLimit } = await import("@/lib/security.server");
              if (!(await rateLimit("health_ingest", `strava-webhook:${id}`))) continue;
            }
            await m.syncWearable(supabaseAdmin, id);
            n++;
          }
        return Response.json({ ok: true, synced: n });
      },
    },
  },
});
