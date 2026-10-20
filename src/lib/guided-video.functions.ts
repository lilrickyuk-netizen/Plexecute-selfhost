import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseWellnessIntent, snapMinutes } from "./guided-video";

const sel = z.object({
  activity: z.enum(["yoga", "meditation"]),
  focus: z.string().min(1).max(40),
  minutes: z.number().int().min(1).max(90),
});

export const findVideos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => sel.parse(i))
  .handler(async ({ data, context }) => {
    const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    const { findGuidedVideos } = await import("./guided-video.server");
    return findGuidedVideos(db, context.userId, data);
  });

/** Reads a planned wellness block so the member lands straight on matching choices. */
export const guidedForBlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ blockId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: b } = await context.supabase
      .from("plan_blocks")
      .select("id,title,starts_at,duration_min,status,domain,goal_id")
      .eq("id", data.blockId)
      .maybeSingle();
    if (!b) return null;
    const mins = b.duration_min ?? 10;
    let text = b.title ?? "";
    if (b.goal_id) {
      const { data: g } = await context.supabase
        .from("goals")
        .select("title")
        .eq("id", b.goal_id)
        .maybeSingle();
      if (g?.title) text = `${g.title} ${text}`;
    }
    const hour = new Date(b.starts_at).getUTCHours();
    const intent = parseWellnessIntent(text, mins);
    // A plain "Meditation" block takes its purpose from the time of day.
    if (intent.activity === "meditation" && !/:/.test(text) && intent.focus === "relaxation")
      intent.focus = hour < 11 ? "morning" : hour >= 19 ? "evening" : "relaxation";
    return {
      ...intent,
      minutes: snapMinutes(intent.activity, mins || intent.minutes),
      title: b.title,
      status: b.status,
    };
  });

export const addPractice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    sel
      .extend({
        perWeek: z.number().int().min(1).max(14),
        time: z.enum(["morning", "midday", "evening", "any"]),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { addPracticeGoal } = await import("./guided-video.server");
    const r = await addPracticeGoal(context.supabase, context.userId, data);
    const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    await db.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "user",
      action: "wellness.practice_added",
      resource_type: "goal",
      resource_id: r.id,
      outcome: "succeeded",
      metadata: {
        activity: data.activity,
        focus: data.focus,
        minutes: data.minutes,
        per_week: data.perWeek,
      },
    });
    return r;
  });

export const setGuidedFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ sessionId: z.string().uuid(), feedback: z.enum(["helpful", "okay", "not_for_me"]) })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: s } = await context.supabase
      .from("wellness_sessions")
      .select("id")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!s) throw new Error("Session not found.");
    const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    const useful = { helpful: 5, okay: 3, not_for_me: 1 }[data.feedback];
    await db.from("wellness_sessions").update({ feedback: data.feedback, useful }).eq("id", s.id);
    return { ok: true };
  });

/** Focus/length combinations that currently have at least one verified matching video. Only these are offered. */
export const videoAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    const { rankChoices } = await import("./guided-video");
    const { data } = await db
      .from("guided_video_cache")
      .select("activity,focus,minutes,candidates");
    const out: string[] = [];
    for (const r of data ?? []) {
      const sel = {
        activity: r.activity as "yoga" | "meditation",
        focus: r.focus,
        minutes: r.minutes,
      };
      const c = rankChoices((r.candidates ?? []) as never, sel, {
        avoidCreators: [],
        likedCreators: [],
        avoidVideos: [],
      });
      if (c.length) out.push(`${r.activity}:${r.focus}:${r.minutes}`);
    }
    return out;
  });
