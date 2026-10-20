// Universal first step: a goal with no ready-made starter gets its pathway built by the existing
// universal goal engine (research + pathway validation) before its first session is shown.
// Milestones are attached to the member's existing goal; no new goal, no invented links
// (sources come only from the research step, otherwise the step runs without one).
import { draftPathwayCore } from "./pathway.functions";

type Db = any;
// These domains already get concrete sessions from Training, Wellness and Nutrition.
const OWN_SYSTEM = new Set(["training", "cardio", "mobility", "meal_prep", "nutrition"]);
const RETRY_MS = 24 * 3600_000;

export async function prepareGoalPathway(
  db: Db,
  userId: string,
  g: {
    id: string;
    title: string;
    domain: string;
    current_state: string | null;
    pathway?: unknown;
    weekly_minutes?: number | null;
    session_minutes?: number | null;
  },
) {
  if (g.domain === "training") return starterProgramme(userId, g);
  if (OWN_SYSTEM.has(g.domain)) return false;
  const prev = (g.pathway ?? {}) as { first_step_failed_at?: string };
  if (prev.first_step_failed_at && Date.now() - Date.parse(prev.first_step_failed_at) < RETRY_MS)
    return false;
  const markFailed = () =>
    db
      .from("goals")
      .update({
        pathway: {
          ...((g.pathway as object) ?? {}),
          first_step_failed_at: new Date().toISOString(),
        },
      })
      .eq("id", g.id);
  // One retry for transient AI/research failures; after that the Plan page tries again later.
  let r: Awaited<ReturnType<typeof draftPathwayCore>> | null = null;
  for (let a = 0; a < 2 && (!r || r.status !== "draft" || r.errors.length); a++)
    r = await draft(db, userId, g).catch((e) => {
      console.error("first step draft", e);
      return null;
    });
  if (!r || r.status !== "draft" || r.errors.length || !r.draft.milestones.length) {
    await markFailed();
    return false;
  }

  const d = r.draft;
  // Re-check under the goal: another request may have attached a pathway meanwhile.
  const { count } = await db
    .from("goal_milestones")
    .select("id", { count: "exact", head: true })
    .eq("goal_id", g.id);
  if ((count ?? 0) > 0) return false;
  const rows = d.milestones.map((m, i) => ({
    user_id: userId,
    goal_id: g.id,
    key: m.key,
    title: m.title,
    position: i,
    stage: m.stage,
    depends_on: m.depends_on,
    effort_hours: m.effort_hours,
    min_weeks: m.min_weeks,
    cost: m.cost,
    evidence_type: m.evidence,
    capability: m.capability,
    is_major: m.major,
    status: m.depends_on.length ? "pending" : "active",
    actions: m.actions,
    sources: m.source_refs.map((x) => d.sources[x]).filter(Boolean),
  }));
  const { error } = await db.from("goal_milestones").insert(rows);
  if (error) {
    console.error("dynamic milestones", error);
    return false;
  }
  await db
    .from("goals")
    .update({
      success_definition: d.success.definition,
      pathway: {
        ...d,
        milestones: undefined,
        assessment: r.assessment,
        prepared_by: "universal_first_step",
        accepted_at: new Date().toISOString(),
      },
    })
    .eq("id", g.id)
    .is("success_definition", null);
  return true;
}

function draft(db: Db, userId: string, g: { title: string; current_state: string | null }) {
  return draftPathwayCore(db, userId, {
    firstStep: true,
    goal: g.title,
    feedback: `Prepare this goal so its first scheduled session is executable now. Member's starting point: ${g.current_state?.trim() || "not stated — assume a complete beginner"}. Stage 1 must start with one concrete first action the member can do in a single session (e.g. 'Calculate your required monthly saving and current gap', 'Learn and practise 10 basic greetings'). Do not require a web resource when the step doesn't need one.`,
  });
}

/** Fitness goals get a real first workout: a conservative beginner bodyweight programme from the Training engine, which the member can change in Training. */
async function starterProgramme(
  userId: string,
  g: { id: string; weekly_minutes?: number | null; session_minutes?: number | null },
) {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const { count } = await db
    .from("training_programmes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "active");
  if ((count ?? 0) > 0) return false;
  if (await (await import("./safety.server")).guardMutation(userId, "progressive_training"))
    return false;
  const { buildProgramme, TRAINING_POLICY_VERSION } = await import("./training");
  const sessionMinutes = Math.min(60, Math.max(20, g.session_minutes ?? 45));
  const days = Math.min(4, Math.max(2, Math.round((g.weekly_minutes ?? 135) / sessionMinutes)));
  const input = {
    goal: "general" as const,
    experience: "novice" as const,
    equipment: "bodyweight" as const,
    days,
    sessionMinutes,
    limitations: [] as never[],
  };
  const built = buildProgramme(input);
  const { data: prog, error } = await db
    .from("training_programmes")
    .insert({
      user_id: userId,
      version: 1,
      goal: input.goal,
      experience: input.experience,
      equipment: input.equipment,
      days_per_week: days,
      session_minutes: sessionMinutes,
      template_key: built.template_key,
      policy_version: TRAINING_POLICY_VERSION,
    })
    .select("id")
    .single();
  if (error || !prog) {
    console.error("starter programme", error);
    return false;
  }
  const { error: pe } = await db
    .from("programme_prescriptions")
    .insert(built.prescriptions.map((p) => ({ ...p, user_id: userId, programme_id: prog.id })));
  if (pe) {
    console.error("starter prescriptions", pe);
    await db.from("training_programmes").delete().eq("id", prog.id);
    return false;
  }
  await db.from("audit_events").insert({
    user_id: userId,
    actor_type: "system",
    action: "training.programme_created",
    resource_type: "training_programme",
    resource_id: prog.id,
    outcome: "succeeded",
    metadata: { version: 1, starter: true, goal_id: g.id, ...input },
  });
  return true;
}
