import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { localDayKey, localDayRange, weekKeyOf, zonedInstant } from "./tz";
import { assessRecovery } from "./recovery-state";
import { wearableEvidence } from "./training.functions";
import {
  recoveryGate,
  weeklyCardio,
  CARDIO_GOALS,
  type CardioGoal,
  type Intensity,
  buildMobilitySession,
  CARDIO_POLICY_VERSION,
  hasRedFlag,
  MOBILITY_POLICY_VERSION,
  mobilityLevel,
  prescribeCardio,
  type CardioLog,
  type MobilityLog,
} from "./movement";

const intensity = z.enum(["easy", "moderate", "vigorous"]);
const mobOpts = {
  experience: z.enum(["new", "some", "experienced"]).default("some"),
  intent: z.enum(["mobility", "flexibility", "control"]).default("mobility"),
  pace: z.enum(["gentle", "steady"]).default("steady"),
  equipment: z
    .array(z.enum(["strap", "blocks", "wall"]))
    .max(3)
    .default(["wall"]),
};
const region = z.enum(["hips", "hamstrings", "spine", "shoulders", "ankles", "full_body"]);
const restriction = z.enum(["knee", "back", "shoulder", "wrist"]);

export const getMovementPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        intensity,
        region,
        minutes: z.number().int().min(5).max(60),
        restrictions: z.array(restriction).max(4),
        goal: z.enum(["health", "endurance", "fat_loss"]).default("health"),
        ...mobOpts,
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: prof } = await sb.from("profiles").select("timezone").maybeSingle();
    const tz = prof?.timezone ?? "UTC";
    const now = new Date();
    const weekStart = zonedInstant(weekKeyOf(now, tz), 0, tz);
    const [dayStart, dayEnd] = localDayRange(now, tz);
    const [{ data: checkin }, { data: samples }, { data: weekRows }, { data: block }] =
      await Promise.all([
        sb
          .from("recovery_checkins")
          .select("sleep_quality,energy,soreness,stress,ill_or_injured")
          .eq("check_date", localDayKey(now, tz))
          .maybeSingle(),
        sb
          .from("health_samples")
          .select("kind,value,recorded_at")
          .eq("is_deleted", false)
          .in("kind", ["sleep_hours", "resting_hr", "hrv_ms", "steps"])
          .gte("recorded_at", new Date(now.getTime() - 8 * 864e5).toISOString())
          .order("recorded_at", { ascending: false }),
        sb
          .from("movement_sessions")
          .select("duration_min,prescribed,completed")
          .eq("kind", "cardio")
          .gte("created_at", weekStart.toISOString()),
        sb
          .from("plan_blocks")
          .select("id,title,starts_at,duration_min,status")
          .eq("occurrence_kind", "cardio")
          .gte("starts_at", dayStart.toISOString())
          .lt("starts_at", dayEnd.toISOString())
          .order("starts_at")
          .limit(1)
          .maybeSingle(),
      ]);
    const rec = assessRecovery({ checkin: checkin ?? null, ...wearableEvidence(samples ?? []) });
    const stepsByDay = new Map<string, number>();
    for (const s of samples ?? [])
      if (s.kind === "steps" && new Date(s.recorded_at) >= weekStart) {
        const k = localDayKey(s.recorded_at, tz);
        stepsByDay.set(k, Math.max(stepsByDay.get(k) ?? 0, Number(s.value)));
      }
    const weekly = {
      ...weeklyCardio(
        data.goal as CardioGoal,
        (weekRows ?? []) as unknown as {
          duration_min: number;
          prescribed: { intensity?: Intensity };
          completed: boolean;
        }[],
        [...stepsByDay.values()],
      ),
      goal: CARDIO_GOALS[data.goal as CardioGoal],
    };
    const { data: rows } = await context.supabase
      .from("movement_sessions")
      .select("kind,duration_min,rpe,completed,pain_flag,tolerance,level,prescribed")
      .order("created_at", { ascending: false })
      .limit(40);
    const cardioHist = (rows ?? []).filter((r) => r.kind === "cardio") as unknown as CardioLog[];
    const mobHist = (rows ?? []).filter((r) => r.kind === "mobility") as unknown as MobilityLog[];
    const base = prescribeCardio(data.intensity, cardioHist);
    const gate = recoveryGate(data.intensity, base.minutes, rec.state);
    const cardio =
      gate.intensity === base.intensity
        ? { ...base, minutes: gate.minutes }
        : { ...prescribeCardio(gate.intensity, cardioHist), minutes: gate.minutes };
    const lvl = mobilityLevel(data.region, mobHist);
    const { count: trainedCount } = await sb
      .from("workout_sessions")
      .select("id", { count: "exact", head: true })
      .gte("started_at", dayStart.toISOString())
      .lt("started_at", dayEnd.toISOString());
    const built = buildMobilitySession({
      region: data.region,
      minutes: data.minutes,
      level: lvl.level,
      restrictions: data.restrictions,
      experience: data.experience,
      intent: data.intent,
      pace: data.pace,
      equipment: data.equipment,
      recovery: rec.state,
      trainedToday: (trainedCount ?? 0) > 0,
    });
    const mobility = { ...built, reason: [lvl.reason, ...built.notes].join(" ") };
    return {
      cardio: { ...cardio, recoveryState: rec.state, recoveryNote: gate.note },
      mobility,
      weekly,
      plannedToday: block ?? null,
    };
  });

export const logMovement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.literal("cardio"),
          modality: z.enum(["walking", "running", "cycling", "rowing", "swimming", "conditioning"]),
          intensity,
          prescribedMinutes: z.number().int().min(1).max(600).nullable(),
          minutes: z.number().int().min(1).max(600),
          rpe: z.number().int().min(1).max(10),
          completed: z.boolean(),
          pain: z.boolean(),
          note: z.string().max(500).nullable(),
        }),
        z.object({
          kind: z.literal("mobility"),
          region,
          minutes: z.number().int().min(1).max(180),
          restrictions: z.array(restriction).max(4),
          tolerance: z.enum(["easy", "right", "hard"]),
          completed: z.boolean(),
          pain: z.boolean(),
          note: z.string().max(500).nullable(),
        }),
      ])
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    const redFlag = data.pain || hasRedFlag(data.note);
    const { screenText, recordSafety } = await import("./safety.server");
    await screenText(context.userId, "training", data.note);
    if (data.pain) await recordSafety(context.userId, "training", "input", ["pain"]);
    let row;
    if (data.kind === "cardio") {
      row = {
        kind: "cardio",
        modality: data.modality,
        level: 1,
        prescribed: { intensity: data.intensity, minutes: data.prescribedMinutes ?? data.minutes },
        duration_min: data.minutes,
        rpe: data.rpe,
        tolerance: null,
        policy_version: CARDIO_POLICY_VERSION,
      };
    } else {
      const { data: hist } = await context.supabase
        .from("movement_sessions")
        .select("completed,tolerance,pain_flag,level,prescribed")
        .eq("kind", "mobility")
        .order("created_at", { ascending: false })
        .limit(20);
      const lvl = mobilityLevel(data.region, (hist ?? []) as unknown as MobilityLog[]).level;
      const session = buildMobilitySession({
        region: data.region,
        minutes: data.minutes,
        level: lvl,
        restrictions: data.restrictions,
      });
      row = {
        kind: "mobility",
        modality: "yoga_mobility",
        level: lvl,
        prescribed: { region: data.region, steps: session.steps.map((s) => s.key) },
        duration_min: data.minutes,
        rpe: null,
        tolerance: data.tolerance,
        policy_version: MOBILITY_POLICY_VERSION,
      };
    }
    const { data: saved, error } = await db
      .from("movement_sessions")
      .insert({
        ...row,
        user_id: context.userId,
        completed: data.completed,
        pain_flag: redFlag,
        note: data.note?.trim() || null,
      })
      .select("id")
      .single();
    if (error || !saved) throw new Error("The session could not be saved.");
    // Execution: complete today's planned cardio/mobility occurrence, if any.
    const { data: prof } = await context.supabase.from("profiles").select("timezone").maybeSingle();
    const [ds, de] = localDayRange(new Date(), prof?.timezone ?? "UTC");
    const { data: blk } = await context.supabase
      .from("plan_blocks")
      .select("id,status")
      .eq("occurrence_kind", data.kind)
      .in("status", [
        "planned",
        "scheduled",
        "upcoming",
        "due",
        "contacting",
        "acknowledged",
        "snoozed",
        "started",
        "in_progress",
      ])
      .gte("starts_at", ds.toISOString())
      .lt("starts_at", de.toISOString())
      .order("starts_at")
      .limit(1)
      .maybeSingle();
    if (blk) {
      const to = redFlag ? "safety_stopped" : data.completed ? "done" : "partial";
      const { error: be } = await db
        .from("plan_blocks")
        .update({ status: to, completed_at: new Date().toISOString() })
        .eq("id", blk.id);
      if (!be)
        await db.from("plan_block_events").insert({
          user_id: context.userId,
          block_id: blk.id,
          event_type: to === "done" ? "complete" : to === "partial" ? "partial" : "safety_stop",
          from_status: blk.status,
          to_status: to,
          reason_code: "movement_logged",
          actor_type: "user",
          actor_id: context.userId,
          source_channel: "app",
          metadata: { movement_session_id: saved.id },
        });
      if (!be)
        await (await import("./verification.server")).verifyBlock(db, context.userId, blk.id);
    }
    await db.from("outcome_ledger").insert({
      user_id: context.userId,
      domain: data.kind === "cardio" ? "cardio" : "mobility",
      metric: "session_minutes",
      value: data.minutes,
      unit: "min",
      evidence_class: "self_reported",
      source: "manual",
      confidence: 0.7,
      observed_at: new Date().toISOString(),
      metadata: { session_id: saved.id, completed: data.completed },
    });
    await db.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "user",
      action: `movement.${data.kind}_logged`,
      resource_type: "movement_session",
      resource_id: saved.id,
      outcome: "succeeded",
      metadata: { pain: redFlag },
    });
    return { id: saved.id, safety: redFlag };
  });
