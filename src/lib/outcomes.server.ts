import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  OUTCOME_POLICY_VERSION,
  bodyTrendOutcomes,
  experimentOutcomes,
  learningOutcomes,
  milestoneOutcomes,
  progressionOutcomes,
  routineOutcomes,
  weeklyOutcomes,
  wellnessOutcomes,
  type Draft,
  type ExperimentObs,
  type Progression,
} from "./outcomes";

type Db = SupabaseClient<Database>;
const WINDOW_DAYS = 180;

/** Runs every detector over the user's stored observations and appends new outcomes (service role; dedupe keeps each once). */
export async function refreshOutcomes(db: Db, userId: string, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86400000).toISOString();
  const [prof, ms, pe, blocks, goals, wp, ws, logs, topics, assess, exps] = await Promise.all([
    db.from("profiles").select("timezone").eq("id", userId).maybeSingle(),
    db
      .from("goal_milestones")
      .select("id,goal_id,title,done_at")
      .eq("user_id", userId)
      .not("done_at", "is", null),
    db
      .from("progression_events")
      .select("id,rule,created_at,prior,next,evidence,programme_prescriptions(exercise_key)")
      .eq("user_id", userId)
      .gte("created_at", since),
    db
      .from("plan_blocks")
      .select("id,status,starts_at,evidence,goal_id,is_protected,interruption_count,domain")
      .eq("user_id", userId)
      .gte("starts_at", since)
      .lte("starts_at", now.toISOString()),
    db.from("goals").select("id,title").eq("user_id", userId),
    db
      .from("wellness_preferences")
      .select("enabled,sessions_per_week")
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("wellness_sessions")
      .select("id,created_at,completion_state")
      .eq("user_id", userId)
      .gte("created_at", since),
    db
      .from("daily_logs")
      .select("id,log_date,value")
      .eq("user_id", userId)
      .eq("kind", "weight")
      .order("log_date"),
    db
      .from("learning_topics")
      .select("id,goal_id,title,done_at,parent_id")
      .eq("user_id", userId)
      .not("done_at", "is", null),
    db
      .from("learning_assessments")
      .select("id,goal_id,title,kind,score,taken_at,evidence")
      .eq("user_id", userId)
      .not("score", "is", null),
    db
      .from("experiments")
      .select("id,title,status,result,created_at,end_date,experiment_entries(id)")
      .eq("user_id", userId)
      .eq("status", "completed"),
  ]);
  const tz = prof.data?.timezone ?? null;
  const { currentPolicy } = await import("./safety.server");
  const policy = await currentPolicy(userId);
  const titles = Object.fromEntries((goals.data ?? []).map((g) => [g.id, g.title]));
  const prog: Progression[] = (pe.data ?? []).map((e) => ({
    id: e.id,
    rule: e.rule,
    created_at: e.created_at,
    prior: e.prior as Record<string, unknown>,
    next: e.next as Record<string, unknown>,
    evidence: e.evidence as Record<string, unknown>,
    exercise: (e.programme_prescriptions as { exercise_key: string } | null)?.exercise_key,
  }));
  const ex: ExperimentObs[] = (exps.data ?? []).map((x) => ({
    id: x.id,
    title: x.title,
    status: x.status,
    result: x.result as ExperimentObs["result"],
    created_at: x.created_at,
    end_date: x.end_date,
    entry_ids: (x.experiment_entries ?? []).map((e) => e.id),
  }));
  const b = blocks.data ?? [];
  const drafts: Draft[] = [
    ...milestoneOutcomes(ms.data ?? []),
    ...progressionOutcomes(prog),
    ...weeklyOutcomes(b, tz, now),
    ...routineOutcomes(b, tz, now, titles),
    ...wellnessOutcomes(
      !!wp.data?.enabled,
      wp.data?.sessions_per_week ?? 0,
      ws.data ?? [],
      tz,
      now,
    ),
    ...bodyTrendOutcomes(logs.data ?? [], !policy.blockCalorieDeficit),
    ...learningOutcomes(topics.data ?? [], assess.data ?? []),
    ...experimentOutcomes(ex),
  ];
  if (!drafts.length) return 0;
  const rows = drafts.map((d) => ({
    ...d,
    user_id: userId,
    policy_version: OUTCOME_POLICY_VERSION,
    confidence: 1,
    observation_refs: d.observation_refs as unknown as Json,
    metadata: d.metadata as Json,
  }));
  const { data, error } = await db
    .from("outcome_ledger")
    .upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`OUTCOME_LEDGER_WRITE_FAILED: ${error.message}`);
  return data?.length ?? 0;
}
