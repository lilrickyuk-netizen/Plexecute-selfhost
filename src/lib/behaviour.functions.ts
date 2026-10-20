import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { reasonPattern } from "./behaviour";

const gid = z.object({ goalId: z.string().uuid() });

/** Everything the goal page needs for behaviour mechanisms, including the missed-reason pattern (V3 §42: n>=5 and 14 days). */
export const getBehaviour = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => gid.parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const [{ data: intentions }, { data: reflections }, { data: blocks }] = await Promise.all([
      db
        .from("goal_intentions")
        .select("*")
        .eq("goal_id", data.goalId)
        .eq("active", true)
        .order("created_at"),
      db
        .from("goal_reflections")
        .select("*")
        .eq("goal_id", data.goalId)
        .order("created_at", { ascending: false })
        .limit(10),
      db
        .from("plan_blocks")
        .select("id")
        .eq("goal_id", data.goalId)
        .gte("starts_at", new Date(Date.now() - 28 * 864e5).toISOString()),
    ]);
    const ids = (blocks ?? []).map((b) => b.id);
    const { data: ev } = ids.length
      ? await db
          .from("plan_block_events")
          .select("missed_reason,occurred_at")
          .in("block_id", ids)
          .not("missed_reason", "is", null)
      : { data: [] as { missed_reason: string | null }[] };
    const rows = (ev ?? []).map((e) => ({
      reason: e.missed_reason,
      at: (e as { occurred_at?: string }).occurred_at,
    }));
    return {
      intentions: intentions ?? [],
      reflections: reflections ?? [],
      pattern: reasonPattern(rows),
      missedCount: rows.length,
      windowDays: 28,
    };
  });

export const addIntention = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        goalId: z.string().uuid(),
        kind: z.enum(["intention", "obstacle", "cue"]),
        when: z.string().trim().min(1).max(200),
        then: z.string().trim().min(1).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("goal_intentions").insert({
      user_id: context.userId,
      goal_id: data.goalId,
      kind: data.kind,
      when_text: data.when,
      then_text: data.then,
    });
    if (error) throw new Error("Couldn't save that plan.");
    return { ok: true };
  });

export const removeIntention = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await context.supabase.from("goal_intentions").update({ active: false }).eq("id", data.id);
    return { ok: true };
  });

export const addReflection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        goalId: z.string().uuid(),
        wentWell: z.string().trim().max(500),
        gotInWay: z.string().trim().max(500),
        changeNext: z.string().trim().max(500),
      })
      .refine((v) => v.wentWell || v.gotInWay || v.changeNext)
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { screenText } = await import("./safety.server");
    await screenText(
      context.userId,
      "user",
      [data.wentWell, data.gotInWay, data.changeNext].join(" \n"),
    );
    const { error } = await context.supabase.from("goal_reflections").insert({
      user_id: context.userId,
      goal_id: data.goalId,
      went_well: data.wentWell || null,
      got_in_way: data.gotInWay || null,
      change_next: data.changeNext || null,
    });
    if (error) throw new Error("Couldn't save your reflection.");
    return { ok: true };
  });

/** Personal Behaviour Model (V3 §42): observations with sample and window; user corrections hide or flag them. */
export const getBehaviourModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await (
      await import("./entitlements.server")
    ).requireCapability(context.supabase, context.userId, "behaviour_model");
    const db = context.supabase;
    const { buildBehaviourModel, MODEL_WINDOW_DAYS } = await import("./behaviour-model");
    const since = new Date(Date.now() - MODEL_WINDOW_DAYS * 864e5).toISOString();
    const [
      { data: prof },
      { data: blocks },
      { data: checkins },
      { data: notes },
      { data: calls },
      { data: food },
      { data: fb },
    ] = await Promise.all([
      db.from("profiles").select("timezone").eq("id", context.userId).single(),
      db
        .from("plan_blocks")
        .select("id,domain,starts_at,duration_min,status")
        .gte("starts_at", since)
        .lte("starts_at", new Date().toISOString())
        .limit(2000),
      db
        .from("recovery_checkins")
        .select("check_date,readiness")
        .gte("check_date", since.slice(0, 10)),
      db.from("notifications").select("created_at,read_at").gte("created_at", since).limit(2000),
      db.from("call_logs").select("created_at,outcome,status").gte("created_at", since),
      db.from("food_entries").select("eaten_on").gte("eaten_on", since.slice(0, 10)).limit(5000),
      db.from("behaviour_feedback").select("observation_key,verdict,note"),
    ]);
    const ids = (blocks ?? []).map((b) => b.id);
    const events: { block_id: string; to_status: string }[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db
        .from("plan_block_events")
        .select("block_id,to_status")
        .in("block_id", ids.slice(i, i + 200))
        .in("to_status", ["snoozed", "rescheduled"]);
      events.push(...(data ?? []));
    }
    const observations = buildBehaviourModel({
      tz: prof?.timezone ?? "Europe/London",
      now: new Date(),
      blocks: blocks ?? [],
      events,
      checkins: checkins ?? [],
      notifications: notes ?? [],
      calls: calls ?? [],
      foodDays: (food ?? []).map((f) => f.eaten_on),
    });
    // V3 §36: finished experiments feed the model only when they met their minimum observations, worded descriptively.
    const { data: exps } = await db
      .from("experiments")
      .select("id,question,metric,variant_a,variant_b,result,end_date")
      .eq("status", "completed")
      .eq("design", "ab_blocks");
    for (const x of exps ?? []) {
      const r = x.result as {
        enough?: boolean;
        a?: { n: number; mean: number };
        b?: { n: number; mean: number };
        confidence?: string;
      } | null;
      if (!r?.enough || !r.a || !r.b) continue;
      observations.push({
        key: `experiment:${x.id}`,
        title: `Experiment: ${x.question}`,
        kind: "count",
        sample: r.a.n + r.b.n,
        days: 28,
        enough: true,
        text: `${x.metric} averaged ${r.a.mean.toFixed(1)} with "${x.variant_a}" (${r.a.n} readings) and ${r.b.mean.toFixed(1)} with "${x.variant_b}" (${r.b.n} readings). Confidence: ${r.confidence}. This describes what happened; it isn't proof of cause.`,
      });
    }
    return { observations, feedback: fb ?? [] };
  });

export const setBehaviourFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        key: z.string().min(1).max(80),
        verdict: z.enum(["hidden", "wrong"]).nullable(),
        note: z.string().trim().max(300).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    if (!data.verdict) {
      await db
        .from("behaviour_feedback")
        .delete()
        .eq("user_id", context.userId)
        .eq("observation_key", data.key);
      return { ok: true };
    }
    const { error } = await db.from("behaviour_feedback").upsert({
      user_id: context.userId,
      observation_key: data.key,
      verdict: data.verdict,
      note: data.note || null,
    });
    if (error) throw new Error("Couldn't save that.");
    return { ok: true };
  });
