import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  analyse,
  buildSchedule,
  conditionOn,
  experimentGate,
  EXPERIMENT_POLICY_VERSION,
  MIN_OBS,
  type Segment,
} from "./experiments";

const txt = (max: number) => z.string().trim().max(max);

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

/** Safety gate runs before activation (V3 §43); schedule is fixed here, before any observation. */
export const createExperiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        question: txt(200).min(1),
        hypothesis: txt(500),
        metric: txt(60).min(1),
        variantA: txt(120).min(1),
        variantB: txt(120).min(1),
        confounders: txt(500),
        days: z.union([z.literal(28), z.literal(56)]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await (
      await import("./entitlements.server")
    ).requireCapability(context.supabase, context.userId, "experiments");
    const { currentPolicy, recordSafety } = await import("./safety.server");
    const { detectSignals } = await import("./safety");
    const policy = await currentPolicy(context.userId);
    const texts = [data.question, data.hypothesis, data.metric, data.variantA, data.variantB];
    const gate = experimentGate(texts, policy);
    const sig = detectSignals(texts.join(" "));
    if (sig.length) await recordSafety(context.userId, "user", "input", sig);
    if (!gate.ok) return { ok: false as const, reasons: gate.reasons };
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("timezone")
      .eq("id", context.userId)
      .single();
    const { localDayKey } = await import("./tz");
    const start = localDayKey(new Date(), prof?.timezone);
    const schedule = buildSchedule(start, data.days);
    const db = await admin();
    const { error } = await db.from("experiments").insert({
      user_id: context.userId,
      title: data.question,
      question: data.question,
      hypothesis: data.hypothesis,
      metric: data.metric,
      variant_a: data.variantA,
      variant_b: data.variantB,
      confounders: data.confounders || null,
      start_date: start,
      end_date: schedule[schedule.length - 1]!.to,
      baseline_days: 14,
      test_days: data.days - 14,
      min_obs: MIN_OBS,
      schedule,
      design: "ab_blocks",
      safety_checked_at: new Date().toISOString(),
      policy_version: EXPERIMENT_POLICY_VERSION,
    });
    if (error) throw new Error("Couldn't start the experiment.");
    return { ok: true as const, reasons: [] };
  });

/** Condition is taken from the pre-set schedule, never chosen by the client. */
export const logExperiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({ id: z.string().uuid(), value: z.number().finite(), note: txt(300).optional() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: x } = await context.supabase
      .from("experiments")
      .select("id,status,schedule,design")
      .eq("id", data.id)
      .single();
    if (!x || x.status !== "active") throw new Error("This experiment isn't running.");
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("timezone")
      .eq("id", context.userId)
      .single();
    const { localDayKey } = await import("./tz");
    const day = localDayKey(new Date(), prof?.timezone);
    const condition = x.design === "ab_blocks" ? conditionOn(x.schedule as Segment[], day) : null;
    if (x.design === "ab_blocks" && !condition)
      throw new Error("Today is outside this experiment's dates.");
    const { error } = await (await admin()).from("experiment_entries").upsert(
      {
        experiment_id: x.id,
        user_id: context.userId,
        entry_date: day,
        value: data.value,
        condition,
        note: data.note || null,
      },
      { onConflict: "experiment_id,entry_date" },
    );
    if (error) throw new Error("Couldn't save that reading.");
    return { ok: true, condition };
  });

export const finishExperiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["completed", "abandoned"]),
        conclusion: txt(1000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: x } = await context.supabase
      .from("experiments")
      .select("*, experiment_entries(entry_date,value,condition)")
      .eq("id", data.id)
      .single();
    if (!x || x.status !== "active") throw new Error("This experiment isn't running.");
    let result = null;
    if (x.design === "ab_blocks") {
      const { data: prof } = await context.supabase
        .from("profiles")
        .select("timezone")
        .eq("id", context.userId)
        .single();
      const { localDayKey } = await import("./tz");
      result = analyse(
        x.schedule as Segment[],
        x.experiment_entries,
        x.min_obs,
        x.confounders,
        localDayKey(new Date(), prof?.timezone),
      );
    }
    const { error } = await (
      await admin()
    )
      .from("experiments")
      .update({ status: data.status, conclusion: data.conclusion || null, result })
      .eq("id", x.id)
      .eq("user_id", context.userId);
    if (error) throw new Error("Couldn't finish the experiment.");
    await (
      await import("./outcomes.server")
    )
      .refreshOutcomes(await admin(), context.userId)
      .catch(() => 0);
    return { ok: true };
  });
