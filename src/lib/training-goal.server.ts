// Applies the one-training-owner rule to saved data: the keeper goal takes the programme's frequency, duplicates are
// superseded, and their missions and sessions are re-linked (future duplicate sessions cancelled with events).
import { PROGRAMME_GOAL_TITLE, planTrainingGoalMerge, type GoalLite } from "./training-goal";

type Db = any;
const LIVE = ["planned", "scheduled", "upcoming", "due", "snoozed"];

export async function unifyTrainingGoal(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as Db;
  const { data: progs } = await db
    .from("training_programmes")
    .select("id,days_per_week,session_minutes")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1);
  const prog = progs?.[0];
  const { data: goals } = await db
    .from("goals")
    .select("id,title,domain,status,created_at,preferred_time,preferred_days,preferred_start,why")
    .eq("user_id", userId)
    .in("status", ["active", "proposed", "paused"]);
  const plan = planTrainingGoalMerge((goals ?? []) as GoalLite[], !!prog);
  if (!plan || !prog) return { changed: false };
  const all = (goals ?? []) as any[];
  const keeper = all.find((g) => g.id === plan.keeperId)!;
  const merged = all.filter((g) => plan.mergeIds.includes(g.id));
  // The programme goal carries the member's latest day/time choices; keep them on the keeper.
  const src = merged.find((g) => g.domain === "training") ?? keeper;
  const anyActive = [keeper, ...merged].some((g) => g.status === "active");
  const { error } = await db
    .from("goals")
    .update({
      domain: "training",
      weekly_minutes: prog.days_per_week * prog.session_minutes,
      minimum_weekly_minutes: Math.min(2, prog.days_per_week) * prog.session_minutes,
      session_minutes: prog.session_minutes,
      preferred_time: src.preferred_time ?? keeper.preferred_time ?? "any",
      preferred_days: src.preferred_days ?? keeper.preferred_days ?? null,
      preferred_start: src.preferred_start ?? keeper.preferred_start ?? null,
      ...(anyActive ? { status: "active" } : {}),
      ...(keeper.title === PROGRAMME_GOAL_TITLE
        ? {}
        : { why: keeper.why ?? "Workouts from your training programme." }),
    })
    .eq("id", keeper.id)
    .eq("user_id", userId);
  if (error) return { changed: false, error: error.message };
  if (!merged.length) return { changed: false, keeper_goal_id: keeper.id };
  let cancelled = 0;
  for (const g of merged) {
    await db
      .from("goals")
      .update({
        status: "superseded",
        why: `Same training as "${keeper.title}"; its workouts come from your programme.`,
      })
      .eq("id", g.id)
      .eq("user_id", userId);
    await db
      .from("goal_missions")
      .update({ goal_id: keeper.id })
      .eq("user_id", userId)
      .eq("goal_id", g.id);
    // History and progress follow the keeper; future duplicates of the same training are cancelled.
    const { data: blocks } = await db
      .from("plan_blocks")
      .select("id,status,starts_at")
      .eq("user_id", userId)
      .eq("goal_id", g.id);
    const now = new Date().toISOString();
    for (const b of (blocks ?? []) as any[]) {
      if (b.starts_at >= now && LIVE.includes(b.status)) {
        const { error: ce } = await db
          .from("plan_blocks")
          .update({
            status: "cancelled",
            note: `Duplicate of your programme workout ("${keeper.title}")`,
          })
          .eq("id", b.id)
          .eq("user_id", userId);
        if (!ce) {
          cancelled++;
          await db.from("plan_block_events").insert({
            user_id: userId,
            block_id: b.id,
            event_type: "cancelled",
            from_status: b.status,
            to_status: "cancelled",
            reason_code: "duplicate_training_goal",
            metadata: { keeper_goal: keeper.id },
          });
        }
      } else {
        await db
          .from("plan_blocks")
          .update({ goal_id: keeper.id })
          .eq("id", b.id)
          .eq("user_id", userId);
      }
    }
  }
  await db.from("audit_events").insert({
    user_id: userId,
    actor_type: "system",
    action: "training.goal_unified",
    resource_type: "goal",
    resource_id: keeper.id,
    outcome: "succeeded",
    metadata: { merged: plan.mergeIds, cancelled_future_sessions: cancelled },
  });
  return {
    changed: true,
    keeper_goal_id: keeper.id,
    merged: plan.mergeIds,
    cancelled_future_sessions: cancelled,
  };
}
