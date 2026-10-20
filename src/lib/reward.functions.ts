import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { periodEligibility } from "@/lib/reward";

/** The caller's reward progress (recomputed deterministically) and history. Read-only: nothing here can qualify a user. */
export const getMyReward = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: sub } = await context.supabase
      .from("subscriptions")
      .select(
        "tier,status,billing_interval,current_period_start,current_period_end,trial_ends_at,subscription_id,customer_id",
      )
      .maybeSingle();
    const el = periodEligibility(sub ?? null);
    if (el.ok) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await (await import("@/lib/reward.server")).refreshProgress(supabaseAdmin, context.userId);
    }
    const { data: history } = await context.supabase
      .from("execution_rewards")
      .select(
        "id,period_start,period_end,required_count,completed_count,state,amount_pence,earned_at,applied_at,last_error",
      )
      .order("period_start", { ascending: false })
      .limit(12);
    return {
      tier: sub?.tier ?? "free",
      eligible: el.ok,
      reason: el.ok ? null : el.reason,
      current: el.ok
        ? ((history ?? []).find(
            (h) => h.period_start === new Date(sub!.current_period_start!).toISOString(),
          ) ?? null)
        : null,
      history: history ?? [],
    };
  });
