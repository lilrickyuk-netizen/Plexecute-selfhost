import { localDayKey, localDayRange } from "./tz";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildProgramme,
  deloadSignal,
  decideProgression,
  EX,
  substitutes,
  TRAINING_POLICY_VERSION,
  type Exposure,
} from "./training";
import { assessRecovery } from "./recovery-state";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

export const createProgramme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        goal: z.enum(["strength", "hypertrophy", "general", "conditioning", "mixed"]),
        experience: z.enum(["novice", "intermediate"]),
        equipment: z.enum(["gym", "home", "bodyweight"]),
        days: z.number().int().min(2).max(6),
        sessionMinutes: z.number().int().min(20).max(120),
        limitations: z
          .array(z.enum(["knee_pain", "back_pain", "shoulder_pain", "wrist_pain"]))
          .max(4),
        preferredTime: z.enum(["morning", "midday", "evening", "any"]).optional(),
        preferredDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
        preferredStart: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional(),
        exercises: z.array(z.string().max(40)).max(12).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const blocked = await (
      await import("./safety.server")
    ).guardMutation(context.userId, "progressive_training");
    if (blocked) throw new Error(blocked);
    const db = await admin();
    const { data: prev } = await context.supabase
      .from("training_programmes")
      .select("id,version")
      .eq("status", "active")
      .order("version", { ascending: false })
      .limit(1);
    const version = (prev?.[0]?.version ?? 0) + 1;
    const built = buildProgramme(data);
    await db
      .from("training_programmes")
      .update({ status: "superseded" })
      .eq("user_id", context.userId)
      .eq("status", "active");
    const { data: prog, error } = await db
      .from("training_programmes")
      .insert({
        user_id: context.userId,
        version,
        goal: data.goal,
        experience: data.experience,
        equipment: data.equipment,
        days_per_week: data.days,
        session_minutes: data.sessionMinutes,
        template_key: built.template_key,
        policy_version: TRAINING_POLICY_VERSION,
      })
      .select("id")
      .single();
    if (error || !prog) throw new Error("The programme could not be created.");
    const { error: pe } = await db
      .from("programme_prescriptions")
      .insert(
        built.prescriptions.map((p) => ({ ...p, user_id: context.userId, programme_id: prog.id })),
      );
    if (pe) throw new Error("The programme exercises could not be saved.");
    // The programme competes for real time in the planner as a training goal (scheduled as workout occurrences on the next approved plan).
    const goal = {
      weekly_minutes: data.days * data.sessionMinutes,
      minimum_weekly_minutes: Math.min(2, data.days) * data.sessionMinutes,
      session_minutes: data.sessionMinutes,
      status: "active",
      ...(data.preferredTime ? { preferred_time: data.preferredTime } : {}),
      ...(data.preferredDays ? { preferred_days: data.preferredDays } : {}),
      ...(data.preferredStart ? { preferred_start: data.preferredStart } : {}),
    };
    const { data: tg } = await context.supabase
      .from("goals")
      .select("id")
      .eq("domain", "training")
      .in("status", ["active", "paused"])
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (tg) await context.supabase.from("goals").update(goal).eq("id", tg.id);
    else
      await context.supabase.from("goals").insert({
        ...goal,
        user_id: context.userId,
        title: "Training programme",
        domain: "training",
        priority: 3,
        preferred_time: data.preferredTime ?? "any",
        why: "Workouts from your training programme.",
      });
    await (await import("./training-goal.server")).unifyTrainingGoal(context.userId);
    await db.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "user",
      action: "training.programme_created",
      resource_type: "training_programme",
      resource_id: prog.id,
      outcome: "succeeded",
      metadata: { version, ...data },
    });
    return { id: prog.id, version };
  });

async function userTz(supabase: SupabaseClient<Database>) {
  const { data } = await supabase.from("profiles").select("timezone").maybeSingle();
  return data?.timezone ?? "UTC";
}
async function todaysRecovery(supabase: SupabaseClient<Database>) {
  const today = localDayKey(new Date(), await userTz(supabase));
  const since = new Date(Date.now() - 8 * 864e5).toISOString();
  const [{ data }, { data: samples }] = await Promise.all([
    supabase
      .from("recovery_checkins")
      .select("sleep_quality,energy,soreness,stress,ill_or_injured")
      .eq("check_date", today)
      .maybeSingle(),
    supabase
      .from("health_samples")
      .select("kind,value,recorded_at")
      .eq("is_deleted", false)
      .in("kind", ["sleep_hours", "resting_hr", "hrv_ms"])
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: false }),
  ]);
  return assessRecovery({ checkin: data ?? null, ...wearableEvidence(samples ?? []) }).state;
}

/** Wearable evidence: latest reading in the last 24h compared with the earlier 7-day average. */
export function wearableEvidence(
  samples: { kind: string; value: number; recorded_at: string }[],
  now = Date.now(),
) {
  const pick = (k: string) => {
    const xs = samples
      .filter((s) => s.kind === k)
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
    const latest =
      xs[0] && now - Date.parse(xs[0].recorded_at) <= 864e5 ? Number(xs[0].value) : null;
    const base = xs.slice(1).map((s) => Number(s.value));
    return { latest, avg: base.length >= 3 ? base.reduce((a, b) => a + b, 0) / base.length : null };
  };
  const sleep = pick("sleep_hours"),
    rhr = pick("resting_hr"),
    hrv = pick("hrv_ms");
  return {
    sleepHours: sleep.latest,
    sleepHistory: samples
      .filter((s) => s.kind === "sleep_hours" && now - Date.parse(s.recorded_at) <= 7 * 864e5)
      .sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
      .map((s) => Number(s.value)),
    restingHrDelta: rhr.latest != null && rhr.avg != null ? rhr.latest - rhr.avg : null,
    hrvDropPct: hrv.latest != null && hrv.avg ? ((hrv.avg - hrv.latest) / hrv.avg) * 100 : null,
  };
}

export const startWorkout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ programmeId: z.string().uuid(), dayIndex: z.number().int().min(0).max(5) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: prog } = await context.supabase
      .from("training_programmes")
      .select("id")
      .eq("id", data.programmeId)
      .maybeSingle();
    if (!prog) throw new Error("Programme not found.");
    const stop = await (
      await import("./safety.server")
    ).guardMutation(context.userId, "training_session");
    if (stop) throw new Error(stop);
    const recovery = await todaysRecovery(context.supabase);
    const db = await admin();
    await db
      .from("workout_sessions")
      .update({ status: "abandoned", completed_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("status", "in_progress");
    // Canonical occurrence: link to today's planned workout and move it to in progress.
    const [dayStart, dayEnd] = localDayRange(new Date(), await userTz(context.supabase));
    const { data: block } = await context.supabase
      .from("plan_blocks")
      .select("id,status")
      .eq("occurrence_kind", "workout")
      .in("status", [
        "planned",
        "scheduled",
        "upcoming",
        "due",
        "contacting",
        "acknowledged",
        "snoozed",
      ])
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString())
      .order("starts_at")
      .limit(1)
      .maybeSingle();
    const { data: s, error } = await db
      .from("workout_sessions")
      .insert({
        user_id: context.userId,
        programme_id: prog.id,
        day_index: data.dayIndex,
        recovery_state: recovery,
        block_id: block?.id ?? null,
      })
      .select("id,recovery_state")
      .single();
    if (error || !s) throw new Error("The workout could not be started.");
    if (block) {
      await db
        .from("plan_blocks")
        .update({ status: "in_progress", started_at: new Date().toISOString() })
        .eq("id", block.id);
      await db.from("plan_block_events").insert({
        user_id: context.userId,
        block_id: block.id,
        event_type: "start",
        from_status: block.status,
        to_status: "in_progress",
        reason_code: "workout_started",
        metadata: { workout_session_id: s.id },
      });
    }
    return s;
  });

export const logWorkoutSet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        prescriptionId: z.string().uuid(),
        weightKg: z.number().min(0).max(600),
        reps: z.number().int().min(0).max(100),
        rir: z.number().min(0).max(6).nullable(),
        clientOpId: z.string().min(8).max(80).optional(),
        clientRecordedAt: z.string().datetime().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    if (data.clientOpId) {
      // §56 offline outbox: a replayed set returns the original row instead of duplicating it.
      const { data: prior } = await context.supabase
        .from("workout_sets")
        .select("set_number")
        .eq("client_op_id", data.clientOpId)
        .maybeSingle();
      if (prior) return { ok: true, setNumber: prior.set_number, restSec: 0, duplicate: true };
    }
    const [{ data: session }, { data: rx }] = await Promise.all([
      context.supabase
        .from("workout_sessions")
        .select("id,status")
        .eq("id", data.sessionId)
        .maybeSingle(),
      context.supabase
        .from("programme_prescriptions")
        .select("*")
        .eq("id", data.prescriptionId)
        .maybeSingle(),
    ]);
    if (!session || session.status !== "in_progress")
      throw new Error("This workout is not in progress.");
    if (!rx) throw new Error("Exercise not found.");
    const { count } = await context.supabase
      .from("workout_sets")
      .select("id", { count: "exact", head: true })
      .eq("session_id", session.id)
      .eq("prescription_id", rx.id);
    const db = await admin();
    const ex = EX[rx.exercise_key];
    const { error } = await db.from("workout_sets").insert({
      user_id: context.userId,
      session_id: session.id,
      prescription_id: rx.id,
      set_number: (count ?? 0) + 1,
      exercise: ex?.name ?? rx.exercise_key,
      weight_kg: data.weightKg,
      reps: data.reps,
      rir: data.rir,
      rpe: data.rir == null ? null : 10 - data.rir,
      client_op_id: data.clientOpId ?? null,
      client_recorded_at: data.clientRecordedAt ?? null,
    });
    if (error?.code === "23505" && data.clientOpId)
      return { ok: true, setNumber: (count ?? 0) + 1, restSec: rx.rest_sec, duplicate: true };
    if (error) throw new Error("The set could not be saved.");
    if (rx.load_kg == null && ex?.loaded && data.weightKg > 0) {
      await db
        .from("programme_prescriptions")
        .update({ load_kg: data.weightKg, revision: rx.revision + 1 })
        .eq("id", rx.id);
      await db.from("progression_events").insert({
        user_id: context.userId,
        prescription_id: rx.id,
        rule: "initial_load_from_first_set",
        prior: { load_kg: null },
        next: { load_kg: data.weightKg },
        evidence: { session_id: session.id },
      });
    }
    return { ok: true, setNumber: (count ?? 0) + 1, restSec: rx.rest_sec };
  });

export const finishWorkout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        outcome: z.enum(["completed", "safety_stopped"]),
        note: z.string().trim().max(500).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: session } = await context.supabase
      .from("workout_sessions")
      .select("*")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (session && data.outcome === "completed")
      void (await import("./observability.server")).track("workout_finished", context.userId);
    if (!session || session.status !== "in_progress")
      throw new Error("This workout is not in progress.");
    const db = await admin();
    const now = new Date().toISOString();
    await db
      .from("workout_sessions")
      .update({ status: data.outcome, completed_at: now, note: data.note ?? null })
      .eq("id", session.id);
    let evidenceClass: string = "self_reported";
    if (session.block_id) {
      const to = data.outcome === "completed" ? "done" : "safety_stopped";
      await db
        .from("plan_blocks")
        .update({ status: to, completed_at: now })
        .eq("id", session.block_id)
        .eq("status", "in_progress");
      await db.from("plan_block_events").insert({
        user_id: context.userId,
        block_id: session.block_id,
        event_type: data.outcome === "completed" ? "complete" : "safety_stop",
        from_status: "in_progress",
        to_status: to,
        reason_code: "workout_finished",
        actor_type: "user",
        metadata: { workout_session_id: session.id },
      });
      evidenceClass = await (
        await import("./verification.server")
      ).verifyBlock(db, context.userId, session.block_id);
    }
    const changes: { exercise: string; rule: string; why: string }[] = [];
    if (data.outcome === "completed" && session.programme_id != null) {
      const { data: rxs } = await context.supabase
        .from("programme_prescriptions")
        .select("*")
        .eq("programme_id", session.programme_id)
        .eq("day_index", session.day_index ?? 0);
      const { data: permRows } = await context.supabase
        .from("auto_adapt_permissions")
        .select("permission,enabled");
      const autoLoad = (await import("./auto-adapt")).toMap(
        permRows,
      ).ADJUST_WORKOUT_LOAD_WITHIN_ENGINE_RULE;
      for (const rx of rxs ?? []) {
        const { data: sets } = await context.supabase
          .from("workout_sets")
          .select("session_id,weight_kg,reps,rir,set_number,created_at")
          .eq("prescription_id", rx.id)
          .order("created_at", { ascending: false })
          .limit(60);
        const bySession = new Map<string, Exposure>();
        for (const s of sets ?? []) {
          if (!s.session_id) continue;
          if (!bySession.has(s.session_id))
            bySession.set(s.session_id, { session_id: s.session_id, sets: [] });
          bySession.get(s.session_id)!.sets.push({
            weight_kg: Number(s.weight_kg),
            reps: s.reps,
            rir: s.rir == null ? null : Number(s.rir),
          });
        }
        // Comparable exposures: done at the current prescribed load.
        const exposures = [...bySession.values()]
          .map((e) => ({ ...e, sets: e.sets.reverse() }))
          .filter(
            (e) => rx.load_kg == null || e.sets.every((s) => s.weight_kg === Number(rx.load_kg)),
          )
          .slice(0, 2);
        const decision = decideProgression(
          { ...rx, load_kg: rx.load_kg == null ? null : Number(rx.load_kg) },
          exposures,
          session.recovery_state,
        );
        if (decision.rule === "hold") continue;
        if (!autoLoad) {
          await db.from("progression_events").insert({
            user_id: context.userId,
            prescription_id: rx.id,
            rule: `suggested_${decision.rule}`,
            prior: {
              load_kg: rx.load_kg,
              rep_min: rx.rep_min,
              rep_max: rx.rep_max,
              revision: rx.revision,
            },
            next: decision.next,
            evidence: {
              sessions: exposures.map((e) => e.session_id),
              recovery: session.recovery_state,
              why: decision.why,
              applied: false,
              reason: "auto_adapt_off",
            },
          });
          changes.push({
            exercise: EX[rx.exercise_key]?.name ?? rx.exercise_key,
            rule: `suggested_${decision.rule}`,
            why: `Suggestion only (automatic weight changes are off): ${decision.why}`,
          });
          continue;
        }
        await db
          .from("programme_prescriptions")
          .update({
            load_kg: decision.next.load_kg,
            rep_min: decision.next.rep_min,
            rep_max: decision.next.rep_max,
            revision: rx.revision + 1,
          })
          .eq("id", rx.id);
        await db.from("progression_events").insert({
          user_id: context.userId,
          prescription_id: rx.id,
          rule: decision.rule,
          prior: {
            load_kg: rx.load_kg,
            rep_min: rx.rep_min,
            rep_max: rx.rep_max,
            revision: rx.revision,
          },
          next: decision.next,
          evidence: {
            sessions: exposures.map((e) => e.session_id),
            recovery: session.recovery_state,
            why: decision.why,
          },
        });
        changes.push({
          exercise: EX[rx.exercise_key]?.name ?? rx.exercise_key,
          rule: decision.rule,
          why: decision.why,
        });
      }
      await db.from("outcome_ledger").insert({
        user_id: context.userId,
        domain: "training",
        metric: "workout_completed",
        value: 1,
        unit: "session",
        evidence_class: evidenceClass,
        source: "workout_logger",
        observed_at: now,
        metadata: { session_id: session.id },
      });

      // V3 §44.6: deload only from a combination of decline, poor recovery and soreness; at most once per 21 days.
      const since14 = new Date(Date.now() - 14 * 864e5).toISOString();
      const since21 = new Date(Date.now() - 21 * 864e5).toISOString();
      const [{ data: regress }, { data: recent }, { data: checks }, { data: lastDeload }] =
        await Promise.all([
          context.supabase
            .from("progression_events")
            .select("id")
            .eq("rule", "regression_load")
            .gte("created_at", since14),
          context.supabase
            .from("workout_sessions")
            .select("recovery_state")
            .order("started_at", { ascending: false })
            .limit(5),
          context.supabase
            .from("recovery_checkins")
            .select("soreness")
            .order("check_date", { ascending: false })
            .limit(3),
          context.supabase
            .from("progression_events")
            .select("id")
            .eq("rule", "deload")
            .gte("created_at", since21)
            .limit(1),
        ]);
      const soreHigh = (checks ?? []).filter((c) => c.soreness >= 4).length >= 2;
      const signal = deloadSignal(
        regress?.length ?? 0,
        (recent ?? []).map((r) => r.recovery_state),
        soreHigh,
      );
      if (signal.deload && !lastDeload?.length) {
        const { data: all } = await context.supabase
          .from("programme_prescriptions")
          .select("*")
          .eq("programme_id", session.programme_id);
        for (const rx of all ?? []) {
          const next = {
            sets: Math.max(1, Math.ceil(rx.sets / 2)),
            load_kg: rx.load_kg == null ? null : Math.round(Number(rx.load_kg) * 0.9 * 2) / 2,
          };
          await db
            .from("programme_prescriptions")
            .update({ ...next, revision: rx.revision + 1 })
            .eq("id", rx.id);
          await db.from("progression_events").insert({
            user_id: context.userId,
            prescription_id: rx.id,
            rule: "deload",
            prior: { sets: rx.sets, load_kg: rx.load_kg, revision: rx.revision },
            next,
            evidence: {
              regressions_14d: regress?.length ?? 0,
              recovery: (recent ?? []).map((r) => r.recovery_state),
              sore_high: soreHigh,
              why: signal.why,
            },
          });
        }
        changes.push({ exercise: "Whole programme", rule: "deload", why: signal.why });
      }
    }
    await db.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "user",
      action: `training.workout_${data.outcome}`,
      resource_type: "workout_session",
      resource_id: session.id,
      outcome: "succeeded",
      metadata: { changes: changes.length },
    });
    return { changes };
  });

export const substituteExercise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ prescriptionId: z.string().uuid(), exerciseKey: z.string().min(1).max(60) })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: rx } = await context.supabase
      .from("programme_prescriptions")
      .select("*, training_programmes(equipment)")
      .eq("id", data.prescriptionId)
      .maybeSingle();
    if (!rx) throw new Error("Exercise not found.");
    const equipment = (rx.training_programmes as { equipment: string } | null)?.equipment as
      "gym" | "home" | "bodyweight";
    if (!substitutes(rx.exercise_key, equipment).some((e) => e.key === data.exerciseKey))
      throw new Error("That swap isn't a matching movement for your equipment.");
    const db = await admin();
    await db
      .from("programme_prescriptions")
      .update({ exercise_key: data.exerciseKey, load_kg: null, revision: rx.revision + 1 })
      .eq("id", rx.id);
    await db.from("progression_events").insert({
      user_id: context.userId,
      prescription_id: rx.id,
      rule: "substitution",
      prior: { exercise_key: rx.exercise_key, load_kg: rx.load_kg },
      next: { exercise_key: data.exerciseKey, load_kg: null },
      evidence: { reason: "user_requested" },
    });
    return { ok: true };
  });
