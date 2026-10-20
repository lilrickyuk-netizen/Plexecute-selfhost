import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildSession,
  hasDistress,
  recommend,
  SESSION_TYPES,
  WELLNESS_RULE_VERSION,
  type SessionType,
  type WellnessLog,
  type WellnessPrefs,
} from "./wellness";

const typeEnum = z.enum(Object.keys(SESSION_TYPES) as [SessionType, ...SessionType[]]);
const DEFAULTS = {
  enabled: true,
  session_types: ["mindfulness", "breath", "body_scan"],
  experience: "beginner" as const,
  min_minutes: 5,
  max_minutes: 15,
  preferred_time: "evening",
  guidance: "text",
  sessions_per_week: 3,
  reminders: true,
  allow_auto_move: false,
};

export const getWellness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ hour: z.number().int().min(0).max(23), override: typeEnum.nullable().optional() })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { assessRecovery } = await import("./recovery-state");
    const { localDayKey } = await import("./tz");
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("timezone")
      .eq("id", context.userId)
      .maybeSingle();
    const { data: ci } = await context.supabase
      .from("recovery_checkins")
      .select("sleep_quality,energy,soreness,stress,ill_or_injured")
      .eq("check_date", localDayKey(new Date(), prof?.timezone))
      .maybeSingle();
    const recovery = assessRecovery({ checkin: ci ?? null }).state;
    const [{ data: p }, { data: hist }] = await Promise.all([
      context.supabase
        .from("wellness_preferences")
        .select("*")
        .eq("user_id", context.userId)
        .maybeSingle(),
      context.supabase
        .from("wellness_sessions")
        .select("session_type,planned_minutes,actual_minutes,completion_state,useful,created_at")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    const prefs = { ...DEFAULTS, ...(p ?? {}) };
    const rec = recommend(
      prefs as WellnessPrefs,
      (hist ?? []) as WellnessLog[],
      data.hour,
      recovery,
    );
    const type = data.override ?? rec.type;
    return { prefs, saved: !!p, recommendation: rec, session: buildSession(type, rec.minutes) };
  });

export const saveWellnessPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        session_types: z.array(typeEnum).min(1).max(8),
        experience: z.enum(["beginner", "some", "experienced"]),
        min_minutes: z.number().int().min(2).max(60),
        max_minutes: z.number().int().min(2).max(90),
        preferred_time: z.enum(["morning", "midday", "evening", "any"]),
        guidance: z.enum(["text", "audio", "timer"]),
        sessions_per_week: z.number().int().min(1).max(14),
        reminders: z.boolean(),
        allow_auto_move: z.boolean(),
      })
      .refine((v) => v.max_minutes >= v.min_minutes, "Longest must be at least the shortest")
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("wellness_preferences")
      .upsert({ user_id: userId, ...data });
    if (error) throw new Error("Your wellness settings could not be saved.");
    // The reminders switch controls session-due reminders for the member.
    await supabase.from("profiles").update({ reminders_enabled: data.reminders }).eq("id", userId);
    // Wellness is an ordinary goal competing for real time in the planner.
    const minutes = Math.round((data.min_minutes + data.max_minutes) / 2);
    const goal = {
      title: "Meditation",
      domain: "wellness",
      weekly_minutes: minutes * data.sessions_per_week,
      minimum_weekly_minutes: data.min_minutes * Math.min(2, data.sessions_per_week),
      session_minutes: minutes,
      preferred_time: data.preferred_time,
      status: data.enabled ? "active" : "paused",
    };
    const { data: existing } = await supabase
      .from("goals")
      .select("id")
      .eq("domain", "wellness")
      .eq("title", "Meditation")
      .maybeSingle();
    if (existing) await supabase.from("goals").update(goal).eq("id", existing.id);
    else if (data.enabled)
      await supabase.from("goals").insert({
        ...goal,
        user_id: userId,
        priority: 3,
        why: "Wellness sessions set up in Wellness.",
      });
    const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    await db.from("audit_events").insert({
      user_id: userId,
      actor_type: "user",
      action: "wellness.preferences_saved",
      resource_type: "wellness_preferences",
      resource_id: userId,
      outcome: "succeeded",
      metadata: { enabled: data.enabled, per_week: data.sessions_per_week },
    });
    return { ok: true };
  });

export const logWellness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        type: z.union([typeEnum, z.enum(["yoga", "guided_meditation"])]),
        activity: z.enum(["meditation", "yoga"]).optional(),
        focus: z.string().max(40).nullable().optional(),
        video: z
          .object({
            videoId: z.string().max(20),
            url: z.string().url().max(200),
            title: z.string().max(300),
            creator: z.string().max(120),
            seconds: z.number().int().min(0).max(36000),
          })
          .nullable()
          .optional(),
        clientId: z.string().uuid().nullable().optional(),
        plannedMinutes: z.number().int().min(1).max(90),
        actualMinutes: z.number().int().min(0).max(180),
        state: z.enum(["completed", "partial", "stopped"]),
        calmBefore: z.number().int().min(1).max(5).nullable(),
        calmAfter: z.number().int().min(1).max(5).nullable(),
        useful: z.number().int().min(1).max(5).nullable(),
        note: z.string().max(500).nullable(),
        blockId: z.string().uuid().nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    // Idempotent: a repeated tap (same client id) or a second completion of the same planned block returns the first record.
    if (data.clientId) {
      const { data: dup } = await db
        .from("wellness_sessions")
        .select("id,safety_flag")
        .eq("user_id", userId)
        .eq("client_id", data.clientId)
        .maybeSingle();
      if (dup) return { id: dup.id, safety: dup.safety_flag, duplicate: true };
    }
    if (data.blockId) {
      const { data: dup } = await db
        .from("wellness_sessions")
        .select("id,safety_flag")
        .eq("user_id", userId)
        .eq("block_id", data.blockId)
        .eq("completion_state", "completed")
        .maybeSingle();
      if (dup) return { id: dup.id, safety: dup.safety_flag, duplicate: true };
    }
    const flag = hasDistress(data.note);
    await (await import("./safety.server")).screenText(userId, "wellness", data.note);
    let blockId: string | null = null;
    if (data.blockId) {
      const { data: b } = await context.supabase
        .from("plan_blocks")
        .select("id,status")
        .eq("id", data.blockId)
        .maybeSingle();
      if (b) {
        blockId = b.id;
        const to = data.state === "completed" ? "done" : "partial";
        await db
          .from("plan_blocks")
          .update({ status: to, completed_at: new Date().toISOString() })
          .eq("id", b.id);
        await db.from("plan_block_events").insert({
          user_id: userId,
          block_id: b.id,
          event_type: data.state === "completed" ? "completed" : "partial",
          from_status: b.status,
          to_status: to,
          occurred_at: new Date().toISOString(),
          actor_type: "user",
          metadata: { minutes: data.actualMinutes },
        });
      }
    }
    const { data: saved, error } = await db
      .from("wellness_sessions")
      .insert({
        user_id: userId,
        block_id: blockId,
        session_type: data.type,
        script_key: data.video ? `video:${data.video.videoId}` : `${data.type}_v1`,
        activity: data.activity ?? (data.type === "yoga" ? "yoga" : "meditation"),
        focus: data.focus ?? null,
        video: data.video ?? null,
        client_id: data.clientId ?? null,
        planned_minutes: data.plannedMinutes,
        actual_minutes: data.actualMinutes,
        completion_state: data.state,
        calm_before: data.calmBefore,
        calm_after: data.calmAfter,
        useful: data.useful,
        note: data.note?.trim() || null,
        safety_flag: flag,
        rule_version: WELLNESS_RULE_VERSION,
      })
      .select("id")
      .single();
    if (error || !saved) throw new Error("The session could not be saved.");
    const evidenceClass = blockId
      ? await (await import("./verification.server")).verifyBlock(db, userId, blockId)
      : "supported";
    await db.from("outcome_ledger").insert({
      user_id: userId,
      domain: "wellness",
      metric: "session_minutes",
      value: data.actualMinutes,
      unit: "min",
      evidence_class: evidenceClass,
      source: "manual",
      confidence: 0.7,
      observed_at: new Date().toISOString(),
      metadata: {
        session_id: saved.id,
        state: data.state,
        type: data.type,
        activity: data.activity ?? null,
        focus: data.focus ?? null,
        video: data.video?.videoId ?? null,
      },
    });
    await db.from("audit_events").insert({
      user_id: userId,
      actor_type: "user",
      action: "wellness.session_logged",
      resource_type: "wellness_session",
      resource_id: saved.id,
      outcome: "succeeded",
      metadata: { safety: flag },
    });
    return { id: saved.id, safety: flag, duplicate: false };
  });
