import { createFileRoute } from "@tanstack/react-router";

/** §57 glance feed for native widgets/watch/Live Activities. Auth: the signed-in user's bearer token (verified with Auth).
 *  Actions go through the existing transitionPlanBlock function with an idempotency key. */
export const Route = createFileRoute("/api/public/glance")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Unauthorized", { status: 401 });
        {
          const sec = await import("@/lib/security.server");
          if (!(await sec.rateLimit("glance", await sec.hashSubject(token)))) return sec.tooMany();
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: u, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !u.user) return new Response("Unauthorized", { status: 401 });
        const userId = u.user.id;
        const { data: p } = await supabaseAdmin
          .from("profiles")
          .select("timezone")
          .eq("id", userId)
          .maybeSingle();
        const tz = p?.timezone || "UTC";
        const { localDayRange } = await import("@/lib/tz");
        const [from, to] = localDayRange(new Date(), tz);
        const { data: blocks } = await supabaseAdmin
          .from("plan_blocks")
          .select(
            "id,title,domain,status,starts_at,duration_min,is_protected,started_at,occurrence_kind,source_type",
          )
          .eq("user_id", userId)
          .gte("starts_at", from.toISOString())
          .lt("starts_at", to.toISOString())
          .neq("status", "rescheduled")
          .order("starts_at");
        const pol = await (await import("@/lib/safety.server")).currentPolicy(userId);
        const { buildGlance } = await import("@/lib/glance");
        const g = buildGlance((blocks ?? []) as never, {
          tz,
          safetyPaused: pol.pauseAccountability,
        });
        return Response.json(g, { headers: { "cache-control": "private, no-store" } });
      },
    },
  },
});
