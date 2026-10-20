import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Shows exactly what deleting a goal removes and keeps, plus the token needed to confirm. */
export const previewGoalDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ goalId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const d = await import("./deletion.server");
    const imp = await d.goalImpact(supabaseAdmin, context.userId, data.goalId);
    return { ...imp, text: d.describeImpact(imp) };
  });

export const deleteGoalConfirmed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ goalId: z.string().uuid(), confirm: z.literal(true), token: z.string().min(8) })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const d = await import("./deletion.server");
    return d.deleteGoal(supabaseAdmin, context.userId, data.goalId, data.token, "screen");
  });

async function tzOf(db: { from: (t: string) => any }, id: string) {
  const { data } = await db.from("profiles").select("timezone").eq("id", id).maybeSingle();
  return (data?.timezone as string | null) ?? null;
}

export const previewPlanDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ week: z.string().max(20).optional() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const d = await import("./deletion.server");
    const tz = await tzOf(context.supabase, context.userId);
    const imp = await d.planImpact(
      supabaseAdmin,
      context.userId,
      d.weekStartFor(data.week, tz),
      tz,
    );
    return { ...imp, text: d.describeImpact(imp) };
  });

export const deletePlanConfirmed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        confirm: z.literal(true),
        token: z.string().min(8),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const d = await import("./deletion.server");
    const tz = await tzOf(context.supabase, context.userId);
    return d.deletePlan(supabaseAdmin, context.userId, data.weekStart, tz, data.token, "screen");
  });
