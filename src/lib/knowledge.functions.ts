import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const searchKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ q: z.string().min(1).max(300), domain: z.string().max(40).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { retrieveEvidence } = await import("./knowledge.server");
    const { localDayKey } = await import("./tz");
    const { data: p } = await context.supabase
      .from("profiles")
      .select("timezone")
      .eq("id", context.userId)
      .maybeSingle();
    const b = await retrieveEvidence(context.supabase as never, data.q, {
      limit: 12,
      today: localDayKey(new Date(), p?.timezone),
      ...(data.domain ? { domains: [data.domain as never] } : {}),
    });
    return {
      ids: b.evidence.map((e) => e.chunk_id),
      uncertainty: b.uncertainty,
      dropped_weaker: b.dropped_weaker,
      method: b.method,
    };
  });

/** Admin only: syncs the source manifest and rebuilds the meaning-based search index. */
export const rebuildKnowledgeIndex = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(data ?? []).some((r) => r.role === "admin")) throw new Error("Admins only");
    const { syncKnowledgeIndex } = await import("./knowledge.server");
    return syncKnowledgeIndex();
  });
