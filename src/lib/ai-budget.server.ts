// V3 §5.2: the Free plan's internal AI budget is 25,000 input + 5,000 output tokens per
// user-local calendar day, enforced on the server BEFORE any provider call. Paid tiers are
// not token-capped (their coach turns are). The reservation is atomic (one row per user per
// local day, SELECT ... FOR UPDATE), so concurrent requests cannot slip past the limit.

export const FREE_AI_BUDGET = { input: 25_000, output: 5_000 } as const;

export const AI_BUDGET_MESSAGE =
  "You've used today's free AI allowance. It resets at midnight; Pro and Execute include far more AI.";

async function localDay(userId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  const { localDayKey } = await import("@/lib/tz");
  return localDayKey(new Date(), data?.timezone);
}

/** Reserve an estimated slice of today's Free AI budget. Returns false when the budget is used up. Paid tiers always pass. */
export const RESTRICTED_MESSAGE =
  "You've paused AI processing of your data in Settings → Privacy. Lift the pause to use this.";

/** V3 §59/§79 restriction: no AI provider sees a member's data while they have restricted processing. Every tier. */
export async function assertAiProcessingAllowed(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("processing_restricted")
    .eq("id", userId)
    .maybeSingle();
  if (data?.processing_restricted) throw new Error(RESTRICTED_MESSAGE);
}

export async function reserveFreeAiBudget(
  userId: string,
  tier: string | null | undefined,
  estInput: number,
  estOutput: number,
): Promise<boolean> {
  await assertAiProcessingAllowed(userId);
  if (tier !== "free") {
    // Pro/Execute: combined monthly allowance of real AI + call cost, then Plexecute AI Credit.
    const { spendState } = await import("./spend.server");
    const { aiAllowed, AI_CREDIT_MESSAGE } = await import("./spend");
    const st = await spendState(userId);
    if (st.allowanceMicro > 0 && !aiAllowed(st)) throw new Error(AI_CREDIT_MESSAGE);
    return true;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("reserve_ai_budget", {
    _user_id: userId,
    _day: await localDay(userId),
    _in: Math.max(1, Math.ceil(estInput)),
    _out: Math.max(1, Math.ceil(estOutput)),
    _max_in: FREE_AI_BUDGET.input,
    _max_out: FREE_AI_BUDGET.output,
  });
  if (error) throw new Error("AI usage could not be checked.");
  if (data === true) return true;
  // Free daily allowance used up: bought Plexecute AI Credit keeps AI features going until it runs out.
  const { spendState } = await import("./spend.server");
  if ((await spendState(userId)).creditMicro <= 0) return false;
  // Record the tokens past the free cap so the real cost is charged to credit afterwards.
  await supabaseAdmin.rpc("reserve_ai_budget", {
    _user_id: userId,
    _day: await localDay(userId),
    _in: Math.max(1, Math.ceil(estInput)) + FREE_AI_BUDGET.input,
    _out: Math.max(1, Math.ceil(estOutput)),
    _max_in: Number.MAX_SAFE_INTEGER,
    _max_out: Number.MAX_SAFE_INTEGER,
  });
  return true;
}

/** Reconcile a reservation with the provider's real token counts (call after the response; negative deltas unwind an over-estimate). */
export async function settleAiUsage(
  userId: string,
  tier: string | null | undefined,
  estInput: number,
  estOutput: number,
  actual: { input?: number | undefined; output?: number | undefined } | null | undefined,
): Promise<void> {
  if (tier !== "free" || !actual || (actual.input == null && actual.output == null)) return;
  const dIn = Math.ceil(actual.input ?? estInput) - Math.ceil(estInput);
  const dOut = Math.ceil(actual.output ?? estOutput) - Math.ceil(estOutput);
  if (!dIn && !dOut) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.rpc("reserve_ai_budget", {
    _user_id: userId,
    _day: await localDay(userId),
    _in: dIn,
    _out: dOut,
    _max_in: Number.MAX_SAFE_INTEGER,
    _max_out: Number.MAX_SAFE_INTEGER,
  });
}
