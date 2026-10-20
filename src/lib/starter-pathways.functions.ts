import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Seeds the starter syllabus/milestones for the member's active goals that have none yet.
 * Idempotent: a goal that already has topics or milestones is never touched. No AI, no provider calls.
 */
export const seedStarterPathways = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase: db, userId } = context;
    const { starterFor, topicTag } = await import("./starter-pathways");
    const { data: goals } = await db
      .from("goals")
      .select("id,title,domain,current_state,status,pathway,weekly_minutes,session_minutes")
      .eq("user_id", userId)
      .eq("status", "active");
    let seeded = 0;
    const dynamic: {
      id: string;
      title: string;
      domain: string;
      current_state: string | null;
      pathway?: unknown;
      weekly_minutes?: number | null;
      session_minutes?: number | null;
    }[] = [];
    for (const g of goals ?? []) {
      // Starters are beginner routes only; a member who says they are past the basics gets none.
      if (
        /\b(intermediate|advanced|experienced|already know|senior)\b/i.test(
          `${g.title} ${g.current_state ?? ""}`,
        )
      )
        continue;
      const s = starterFor(g.title, g.domain);
      if (!s) {
        dynamic.push(g);
        continue;
      }
      const [t, m] = await Promise.all([
        db.from("learning_topics").select("id", { count: "exact", head: true }).eq("goal_id", g.id),
        db.from("goal_milestones").select("id", { count: "exact", head: true }).eq("goal_id", g.id),
      ]);
      if ((t.count ?? 0) > 0 || (m.count ?? 0) > 0) {
        // Topics seeded earlier but their saved links are missing: add the links only.
        if (s.topics && (t.count ?? 0) > 0) {
          const { count: rc } = await db
            .from("learning_resources")
            .select("id", { count: "exact", head: true })
            .eq("goal_id", g.id);
          const { data: mine } = await db
            .from("learning_topics")
            .select("title")
            .eq("goal_id", g.id);
          const titles = new Set((mine ?? []).map((x) => x.title));
          const missing = s.topics.filter((x) => titles.has(x.title));
          if (!rc && missing.length)
            await db.from("learning_resources").insert(
              missing.map((x) => ({
                user_id: userId,
                goal_id: g.id,
                title: x.resource.title,
                url: x.resource.url,
                kind: x.resource.kind,
                content: topicTag(x.title),
              })),
            );
        }
        continue;
      }
      if (s.topics) {
        const { error } = await db.from("learning_topics").insert(
          s.topics.map((x, i) => ({
            user_id: userId,
            goal_id: g.id,
            title: x.title,
            position: i,
          })),
        );
        if (error) {
          console.error("starter topics", error);
          continue;
        }
        const rr = await db.from("learning_resources").insert(
          s.topics.map((x) => ({
            user_id: userId,
            goal_id: g.id,
            title: x.resource.title,
            url: x.resource.url,
            kind: x.resource.kind,
            content: topicTag(x.title),
          })),
        );
        if (rr.error) console.error("starter resources", rr.error);
      }
      if (s.milestones) {
        const { error } = await db.from("goal_milestones").insert(
          s.milestones.map((x, i) => ({
            user_id: userId,
            goal_id: g.id,
            key: x.key,
            title: x.title,
            stage: i + 1,
            position: i,
            depends_on: x.depends_on,
            actions: x.actions as never,
            sources: x.sources.map((src) => ({
              ...src,
              trust: "official",
              retrieved_at: "2026-10-13",
              fact: src.title,
              jurisdiction: null,
            })) as never,
            evidence_type: x.evidence_type,
            status: "pending",
          })),
        );
        if (error) {
          console.error("starter milestones", error);
          continue;
        }
      }
      seeded++;
    }
    // No ready-made starter: build the pathway now from the universal goal engine, before any session appears.
    const { prepareGoalPathway } = await import("./universal-first-step.server");
    const results = await Promise.all(
      dynamic.slice(0, 4).map((g) =>
        prepareGoalPathway(db, userId, g).catch((e) => {
          console.error("dynamic pathway", e);
          return false;
        }),
      ),
    );
    seeded += results.filter(Boolean).length;
    // Every onboarding goal becomes a Goal Mission so feasibility, blockers and follow-up start from day one.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const MS = await import("./mission.server");
      for (const g of (goals ?? []).slice(0, 8))
        await MS.advanceMission(supabaseAdmin, userId, {
          goal_id: g.id,
          title: g.title,
          member_text: `${g.title} ${g.current_state ?? ""}`,
          domains: [g.domain],
          contract: {
            desired_outcome: g.title,
            ...(g.current_state ? { current_state: g.current_state } : {}),
          },
        });
    } catch (e) {
      console.error("onboarding missions", e);
    }
    return { seeded };
  });
