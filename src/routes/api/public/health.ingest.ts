import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { HEALTH_KINDS, filterByPermission, hashToken } from "@/lib/health";

// Ingest endpoint for the native companion (Apple HealthKit / Android Health Connect) or a shortcut.
// Auth: Authorization: Bearer <connection key from Settings> (granular categories), or the legacy personal health key.
const Body = z.object({
  source: z.enum(["apple_health", "health_connect", "shortcut", "other"]),
  samples: z
    .array(
      z.object({
        kind: z.enum(HEALTH_KINDS),
        value: z.number().finite().min(0).max(1e6),
        recorded_at: z.string().datetime(),
        end_at: z.string().datetime().nullish(),
        provider_event_id: z.string().max(200).nullish(),
        source_device: z.string().max(120).nullish(),
        provider_updated_at: z.string().datetime().nullish(),
        deleted: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const Route = createFileRoute("/api/public/health/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        if (token.length < 30 || token.length > 100)
          return new Response("Unauthorized", { status: 401 });
        {
          const sec = await import("@/lib/security.server");
          if (!(await sec.rateLimit("health_ingest", await sec.hashSubject(token))))
            return sec.tooMany();
        }
        const parsed = Body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        let userId: string | null = null,
          connectionId: string | null = null,
          granted: string[] | null = null;
        const { data: conn } = await db
          .from("health_connections")
          .select("id,user_id,platform,categories,rejected_count")
          .eq("token_hash", await hashToken(token))
          .eq("status", "active")
          .maybeSingle();
        if (conn) {
          if (parsed.data.source !== conn.platform)
            return Response.json(
              { error: "source does not match this connection" },
              { status: 403 },
            );
          userId = conn.user_id;
          connectionId = conn.id;
          granted = conn.categories;
        } else if (z.string().uuid().safeParse(token).success) {
          const { data: p } = await db
            .from("profiles")
            .select("id")
            .eq("health_token", token)
            .maybeSingle();
          userId = p?.id ?? null;
        }
        if (!userId) return new Response("Unauthorized", { status: 401 });
        const { ok, refused } = granted
          ? filterByPermission(parsed.data.samples, granted)
          : { ok: parsed.data.samples, refused: [] };
        try {
          const { storeHealthSamples } = await import("@/lib/health.server");
          const r = await storeHealthSamples(db, userId, parsed.data.source, ok, connectionId);
          if (connectionId)
            await db
              .from("health_connections")
              .update({
                last_received_at: new Date().toISOString(),
                rejected_count: (conn?.rejected_count ?? 0) + refused.length,
              })
              .eq("id", connectionId);
          return Response.json({ ...r, refused: refused.length });
        } catch (e) {
          console.error("health ingest", e);
          return Response.json({ error: "store failed" }, { status: 500 });
        }
      },
    },
  },
});
