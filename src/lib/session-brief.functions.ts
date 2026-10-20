import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getSessionBrief = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ blockId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { loadSessionBrief } = await import("./session-brief.server");
    return loadSessionBrief(context.supabase, context.userId, data.blockId);
  });

export const getSessionBriefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ blockIds: z.array(z.string().uuid()).max(60) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { loadSessionBrief } = await import("./session-brief.server");
    const out = await Promise.all(
      data.blockIds.map((id) => loadSessionBrief(context.supabase, context.userId, id)),
    );
    return out.filter((x): x is NonNullable<typeof x> => !!x);
  });
