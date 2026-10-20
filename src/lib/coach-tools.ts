import { COACH_ACTION_TOOLS, type CoachActionTool } from "./coach-action-names";
// V3 §14 / §59 Coach modes and tool registry. Pure gating rules shared by server and tests.
export type CoachMode = "EXPERT" | "COACH" | "EXECUTION" | "REVIEW";
export const COACH_MODES: { key: CoachMode; label: string; hint: string }[] = [
  {
    key: "EXPERT",
    label: "Expert",
    hint: "Tell me what to do using validated specialist engines.",
  },
  { key: "COACH", label: "Coach", hint: "Help me reason through the goal or obstacle." },
  { key: "EXECUTION", label: "Execution", hint: "Keep me moving against my accepted plan." },
  { key: "REVIEW", label: "Review", hint: "Analyse what happened and improve the next plan." },
];

export type ToolName =
  | "get_life_twin"
  | "get_goals"
  | "get_plan"
  | "get_today"
  | "get_execution_history"
  | "request_replan"
  | "propose_goal_change"
  | "propose_new_goal"
  | "get_training_context"
  | "get_nutrition_context"
  | "get_recovery_context"
  | "get_learning_context"
  | "get_behaviour_patterns"
  | "get_experiments"
  | "get_outcomes"
  | "start_experiment_proposal"
  | "log_user_statement"
  | "search_food"
  | "propose_food_log"
  | "request_calendar_change"
  | "request_call_setting_change"
  | "get_knowledge_evidence"
  | "get_schedule_context"
  | "get_journal_context"
  | "schedule_commitment"
  | "schedule_meals"
  | "estimate_energy_needs"
  | "cancel_scheduled_call"
  | "set_notification_preferences"
  | "get_call_readiness"
  | "start_phone_verification"
  | "confirm_phone_code"
  | "give_call_consent"
  | "get_life_intelligence"
  | "explain_plan_item"
  | "get_session_brief"
  | "brief_my_day"
  | "review_my_week"
  | "get_mission"
  | "advance_mission"
  | "fix_repeated_misses"
  | "triage_tonight"
  | "protect_recurring_time"
  | "research_topic"
  | "schedule_execution_queue"
  | "update_execution_task"
  | "build_learning_pathway"
  | CoachActionTool;

/** Free tier: core reads + allowance-limited replan/food assist. Everything else is paid-only. */
export const FREE_TOOLS: ToolName[] = [
  "schedule_execution_queue",
  "build_learning_pathway",
  "triage_tonight",
  "update_execution_task",
  "get_life_twin",
  "get_goals",
  "get_plan",
  "get_today",
  "get_execution_history",
  "get_training_context",
  "get_nutrition_context",
  "get_recovery_context",
  "get_learning_context",
  "get_knowledge_evidence",
  "log_user_statement",
  "search_food",
  "request_replan",
  "propose_food_log",
  "get_schedule_context",
  "get_journal_context",
  "schedule_commitment",
  "schedule_meals",
  "estimate_energy_needs",
  "cancel_scheduled_call",
  "set_notification_preferences",
  // Life Intelligence reads: deterministic, no extra model cost.
  "get_life_intelligence",
  "explain_plan_item",
  "get_session_brief",
  "brief_my_day",
  "review_my_week",
  // Goal Mission orchestration: deterministic, no extra model cost.
  "get_mission",
  "advance_mission",
  "fix_repeated_misses",
  // Execution tools: each runs the same domain rules/entitlement checks as the screens.
  ...COACH_ACTION_TOOLS,
];

/**
 * Tables the Coach can never read or write, enforced by the guarded client in coach-tools.server.ts
 * (any .from() on these throws). Payment, account-security, secret, admin and owner data.
 */
export const COACH_DENIED_TABLES = [
  "subscriptions",
  "billing_events",
  "entitlement_ledger",
  "execution_rewards",
  "phone_numbers",
  "calendar_credentials",
  "wearable_credentials",
  "health_connections",
  "push_devices",
  "user_roles",
  "admin_access_log",
  "owner_cohorts",
  "owner_feedback",
  "owner_member_tags",
  "owner_notes",
  "feature_flags",
  "incidents",
  "error_events",
  "provider_calls",
  "usage_events",
  "rate_limits",
  "deletion_jobs",
  "data_rights_requests",
  "retention_runs",
  "background_jobs",
  "background_job_events",
  "call_market_manifest",
] as const;
export function coachMayAccess(table: string) {
  return !(COACH_DENIED_TABLES as readonly string[]).includes(table);
}
/** Allowances from V3 §5: AI replan 1 per rolling 7 days, AI food assist 1 per user-local day (Free). */
export const FREE_ALLOWANCE: Partial<
  Record<ToolName, { count: number; window: "rolling7d" | "localDay" }>
> = {
  request_replan: { count: 1, window: "rolling7d" },
  propose_food_log: { count: 1, window: "localDay" },
  log_food: { count: 1, window: "localDay" },
};

export type Gate = { allowed: true } | { allowed: false; reason: "paid_only" | "allowance_used" };
export function gateTool(tool: ToolName, tier: string, usedInWindow: number): Gate {
  if (tier !== "free") return { allowed: true };
  if (!FREE_TOOLS.includes(tool)) return { allowed: false, reason: "paid_only" };
  const a = FREE_ALLOWANCE[tool];
  if (a && usedInWindow >= a.count) return { allowed: false, reason: "allowance_used" };
  return { allowed: true };
}

export type CoachAction =
  | { kind: "replan"; label: string; reason: string }
  | { kind: "link"; label: string; to: string; reason: string }
  /** Destructive/material change waiting for the member's Confirm (coach_pending_actions). */
  | { kind: "confirm"; id: string; label: string; reason: string }
  /** Plan proposal approved through the normal approveWeekPlan path. */
  | { kind: "approve_plan"; proposalId: string; label: string; reason: string };

export type OutputContract = {
  recommendation_type: string;
  source_of_truth: "ENGINE" | "USER_DATA" | "KNOWLEDGE" | "AI_SYNTHESIS";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  requires_user_confirmation: boolean;
  safety_flags: string[];
  evidence_refs: string[];
};

/** Derives the §60 contract from what tools actually ran, never from model self-report. */
export function deriveContract(
  mode: CoachMode,
  used: ToolName[],
  evidenceRefs: string[],
  actions: CoachAction[],
  safety: string[],
): OutputContract {
  const engine = used.some((t) => /context|get_plan|get_today|replan/.test(t));
  const knowledge = evidenceRefs.length > 0;
  const userData = used.some((t) => /twin|goals|history|patterns|experiments/.test(t));
  const source = engine
    ? "ENGINE"
    : knowledge
      ? "KNOWLEDGE"
      : userData
        ? "USER_DATA"
        : "AI_SYNTHESIS";
  const confidence =
    engine && knowledge ? "HIGH" : engine || knowledge ? "MEDIUM" : userData ? "LOW" : "UNKNOWN";
  return {
    recommendation_type: mode.toLowerCase(),
    source_of_truth: source,
    confidence,
    requires_user_confirmation: actions.length > 0,
    safety_flags: safety,
    evidence_refs: evidenceRefs,
  };
}

export const MODE_PROMPT: Record<CoachMode, string> = {
  EXPERT:
    "Mode EXPERT: answer with what the specialist engines and knowledge say. Call the relevant context tools and get_knowledge_evidence before advising.",
  COACH:
    "Mode COACH: help the user reason through the goal or obstacle with questions and options; let them choose.",
  EXECUTION:
    "Mode EXECUTION: keep the user moving on the accepted plan. Call get_today first and name the single next action.",
  REVIEW:
    "Mode REVIEW: analyse what happened. Call get_execution_history and get_behaviour_patterns, then suggest improvements; use request_replan only if a material change is needed.",
};
