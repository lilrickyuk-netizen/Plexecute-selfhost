// Coach → Learning: one bridge into the existing Learning system. It never teaches by itself:
// resources come from runLearningDiscovery (the same search the Learning page uses), the pathway
// is saved in the same Learning records (learning_searches + learning goal topics/resources) and
// sessions go on the plan through the shared execution queue.
import { learningSubjectKey } from "./learning-subject";
import { addDaysKey, localDayKey, zonedInstant } from "./tz";

type Ctx = { db: any; userId: string; tz: string | null; [k: string]: unknown };
type Level = "beginner" | "intermediate" | "advanced";

const KIND: Record<string, string> = {
  course: "course",
  book: "book",
  article: "article",
  video: "video",
  webinar: "video",
  practice: "other",
  other: "other",
};

async function existingPathway(ctx: Ctx, key: string) {
  const [{ data: goals }, { data: searches }] = await Promise.all([
    ctx.db
      .from("goals")
      .select("id,title,status,session_minutes")
      .eq("user_id", ctx.userId)
      .eq("domain", "learning")
      .in("status", ["active", "paused"])
      .limit(50),
    ctx.db
      .from("learning_searches")
      .select("id,subject,level,summary,resources,created_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const goal = (goals ?? []).find((g: any) => learningSubjectKey(g.title) === key) ?? null;
  const search = (searches ?? []).find((s: any) => learningSubjectKey(s.subject) === key) ?? null;
  return { goal, search };
}

async function upcomingSessions(ctx: Ctx, goalId: string) {
  const { data } = await ctx.db
    .from("plan_blocks")
    .select("id,title,starts_at,duration_min,status")
    .eq("user_id", ctx.userId)
    .eq("goal_id", goalId)
    .in("status", ["planned", "scheduled", "upcoming"])
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(10);
  return (data ?? []) as any[];
}

export async function buildLearningPathway(ctx: Ctx, a: Record<string, unknown>) {
  const subject = String(a["subject"] ?? "")
    .trim()
    .slice(0, 200);
  if (subject.length < 2) return { error: "subject_required" };
  const level = (
    ["beginner", "intermediate", "advanced"].includes(String(a["level"])) ? a["level"] : "beginner"
  ) as Level;
  const minutes = Math.min(120, Math.max(15, Number(a["session_minutes"]) || 30));
  const startTime = /^\d{1,2}:\d{2}$/.test(String(a["start_time"] ?? ""))
    ? String(a["start_time"])
    : null;
  const key = learningSubjectKey(subject);

  let { goal, search } = await existingPathway(ctx, key);
  const reused = { goal: !!goal, resources: !!search };

  // 1. Resources: reuse the saved Learning search, otherwise run the real Learning discovery.
  if (!search) {
    try {
      const L = await import("./learn-resources.functions");
      const out = await L.runLearningDiscovery(
        { subject, level },
        { userId: ctx.userId, supabase: ctx.db },
      );
      search = { id: out.id, subject, level, summary: out.summary, resources: out.resources };
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : "learning_search_failed",
        note: "Tell the member the Learning search failed and nothing was created. Do not substitute generic advice or invented links.",
      };
    }
  }
  const resources = ((search.resources ?? []) as any[]).filter((r) => /^https:\/\//.test(r?.url));
  if (!resources.length) return { error: "no_verified_resources" };

  // 2. Learning goal holding the structured pathway (topics + resources), reused if present.
  if (!goal) {
    const title = `Learn ${subject.replace(/^learn(ing)?\s+/i, "")}`.slice(0, 120);
    const { data: g, error } = await ctx.db
      .from("goals")
      .insert({
        user_id: ctx.userId,
        title,
        domain: "learning",
        status: "active",
        session_minutes: minutes,
        weekly_minutes: minutes * 3,
        why: typeof a["why"] === "string" ? String(a["why"]).slice(0, 500) : null,
        success_type: "milestones",
      })
      .select("id,title,status,session_minutes")
      .single();
    if (error || !g) return { error: "goal_not_saved" };
    goal = g;
    const ordered = resources.slice(0, 8);
    await ctx.db.from("learning_topics").insert(
      ordered.map((r, i) => ({
        user_id: ctx.userId,
        goal_id: g.id,
        position: i,
        title: String(r.title).slice(0, 200),
      })),
    );
    await ctx.db.from("learning_resources").insert(
      ordered.map((r) => ({
        user_id: ctx.userId,
        goal_id: g.id,
        title: String(r.title).slice(0, 200),
        kind: KIND[r.type] ?? "other",
        url: String(r.url).slice(0, 500),
      })),
    );
  }

  // 3. Execution-ready sessions on the plan, only when none are already upcoming (no duplicates).
  let sessions = await upcomingSessions(ctx, goal.id);
  if (!sessions.length) {
    const Q = await import("./execution-queue.server");
    const today = localDayKey(new Date(), ctx.tz ?? "UTC");
    const want = startTime
      ? Number(startTime.split(":")[0]) * 60 + Number(startTime.split(":")[1])
      : 18 * 60 + 30;
    for (let i = 0; i < 3; i++) {
      const r = resources[i % resources.length];
      const day = addDaysKey(today, i + 1);
      // First free slot from the wanted time, so sessions never overlap anything already planned.
      const base = zonedInstant(day, 0, ctx.tz ?? "UTC").getTime();
      const { data: dayBlocks } = await ctx.db
        .from("plan_blocks")
        .select("starts_at,duration_min")
        .eq("user_id", ctx.userId)
        .in("status", ["planned", "scheduled", "upcoming", "in_progress"])
        .gte("starts_at", new Date(base).toISOString())
        .lt("starts_at", new Date(base + 864e5).toISOString());
      let at = want;
      for (let guard = 0; guard < 30; guard++) {
        const clash = ((dayBlocks ?? []) as any[]).find((b) => {
          const s0 = Math.round((Date.parse(b.starts_at) - base) / 60000);
          return at < s0 + (b.duration_min ?? 30) && at + minutes > s0;
        });
        if (!clash) break;
        at =
          Math.round((Date.parse(clash.starts_at) - base) / 60000) +
          (clash.duration_min ?? 30) +
          10;
      }
      const hhmm = `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;
      await Q.scheduleExecutionQueue(ctx as never, {
        day,
        goal_id: goal.id,
        domain: "learning",
        tasks: [
          {
            title: `${(subject.charAt(0).toUpperCase() + subject.slice(1)).slice(0, 50)} study ${i + 1}: ${String(r.title).slice(0, 60)}`,
            start_time: hhmm,
            minutes,
            destination: r.provider || null,
            link: r.url,
            action: `Open ${r.title} and work through it for ${minutes} minutes, applying it to: ${subject}.`,
            first_step: `Open the link and start the first section.`,
            done_when: `${minutes} focused minutes done and three takeaways written down`,
            record: "Three takeaways and one thing to apply",
          },
        ],
      });
    }
    sessions = await upcomingSessions(ctx, goal.id);
  }

  return {
    reused,
    learning_search_id: search.id,
    goal_id: goal.id,
    goal_title: goal.title,
    summary: search.summary ?? null,
    resources: resources.slice(0, 8).map((r) => ({
      title: r.title,
      type: r.type,
      free: r.free,
      url: r.url,
      provider: r.provider,
    })),
    sessions: sessions.map((s) => ({
      title: s.title,
      starts_at: s.starts_at,
      minutes: s.duration_min,
    })),
    first_session: sessions[0]
      ? {
          title: sessions[0].title,
          when_local: new Date(sessions[0].starts_at).toLocaleString("en-GB", {
            timeZone: ctx.tz ?? "UTC",
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          }),
          minutes: sessions[0].duration_min,
        }
      : null,
    sessions_scheduled: sessions.length,
    open_in_learning: "/app/learning",
    open_goal: `/app/goals/${goal.id}`,
    note: reused.goal
      ? "This pathway already exists in Learning; report its current state, do not create another."
      : "Tell the member it was built in Learning: name real resources from this result, the first session (first_session.when_local; sessions ARE already on their plan when sessions_scheduled > 0), and that they can open it in Learning or continue here. No generic advice.",
  };
}
