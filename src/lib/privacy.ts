// V3 §60 / §78.2 / §79: one registry of every table that holds a person's data, so export,
// "delete all my data" and account deletion can never silently miss a domain.

/** Every public table keyed by user_id (profiles is keyed by id and handled separately). */
export const USER_TABLES = [
  "ai_credit_ledger",
  "ai_usage",
  "goal_missions",
  "appointment_booking_events",
  "appointment_bookings",
  "audit_events",
  "auto_adapt_permissions",
  "behaviour_feedback",
  "cancellation_reasons",
  "calendar_busy",
  "calendar_connections",
  "calendar_credentials",
  "calendar_event_links",
  "call_campaigns",
  "call_logs",
  "career_research",
  "coach_messages",
  "coach_tool_calls",
  "commitments",
  "scheduled_calls",
  "coach_pending_actions",
  "coach_standing_orders",
  "consent_records",
  "daily_logs",
  "data_rights_requests",
  "entitlement_ledger",
  "evidence_claims",
  "execution_rewards",
  "experiment_entries",
  "experiments",
  "food_entries",
  "meal_photo_estimates",
  "food_inventory",
  "meal_prep_preferences",
  "goal_intentions",
  "goal_metric_entries",
  "goal_milestones",
  "goal_reflections",
  "goals",
  "health_connections",
  "health_samples",
  "intervention_decisions",
  "learning_assessments",
  "learning_resources",
  "learning_searches",
  "learning_topics",
  "lesson_progress",
  "life_twin_facts",
  "meal_plans",
  "movement_sessions",
  "notification_preferences",
  "notifications",
  "owner_member_tags",
  "owner_feedback",
  "owner_notes",
  "nutrition_targets",
  "outcome_ledger",
  "phone_numbers",
  "plan_block_events",
  "plan_blocks",
  "plan_property_locks",
  "plan_versions",
  "professional_messages",
  "professional_proposals",
  "professional_shares",
  "programme_prescriptions",
  "progression_events",
  "push_devices",
  "recovery_checkins",
  "research_findings",
  "research_sources",
  "retrieval_items",
  "retrieval_reviews",
  "safety_events",
  "safety_flags",
  "saved_meals",
  "saved_places",
  "journeys",
  "journey_events",
  "life_links",
  "intelligence_events",
  "spend_ledger",
  "usage_reservations",
  "subscriptions",
  "support_requests",
  "training_programmes",
  "usage_events",
  "user_foods",
  "user_roles",
  "wearable_connections",
  "wearable_credentials",
  "wellness_preferences",
  "wellness_sessions",
  "workout_sessions",
  "workout_sets",
] as const;
export type UserTable = (typeof USER_TABLES)[number];

/** Secrets: never exported (tokens/encrypted numbers), but always deleted. */
export const SECRET_TABLES: readonly UserTable[] = [
  "calendar_credentials",
  "wearable_credentials",
  "phone_numbers",
];

/** Kept by "delete all my data" (account stays): account settings, billing and legal evidence. */
export const KEEP_ON_WIPE: readonly UserTable[] = [
  "subscriptions",
  "entitlement_ledger",
  "execution_rewards",
  "consent_records",
  "audit_events",
  "data_rights_requests",
  "user_roles",
  "phone_numbers",
  "notification_preferences",
  "auto_adapt_permissions",
  "wellness_preferences",
  "push_devices",
  "usage_events",
];

export const EXPORT_TABLES = USER_TABLES.filter((t) => !SECRET_TABLES.includes(t));
export const WIPE_TABLES = USER_TABLES.filter((t) => !KEEP_ON_WIPE.includes(t));

/** Children before parents so deletes never trip references between domain tables. */
export function deletionOrder(tables: readonly string[]): string[] {
  const late = [
    "plan_blocks",
    "plan_versions",
    "goals",
    "experiments",
    "training_programmes",
    "learning_topics",
    "call_campaigns",
    "subscriptions",
    "user_roles",
  ];
  return [...tables].sort((a, b) => late.indexOf(a) - late.indexOf(b));
}

export const RIGHTS_TYPES = [
  "access",
  "rectification",
  "erasure",
  "restriction",
  "objection",
  "portability",
  "consent_withdrawal",
  "complaint",
] as const;
export type RightsType = (typeof RIGHTS_TYPES)[number];

export const RIGHTS_LABEL: Record<RightsType, string> = {
  access: "See a copy of my data",
  rectification: "Correct something about me",
  erasure: "Delete my data",
  restriction: "Pause use of my data",
  objection: "Object to how my data is used",
  portability: "Take my data elsewhere",
  consent_withdrawal: "Withdraw a consent",
  complaint: "Make a privacy complaint",
};

/** UK target: 28 days so we stay inside the one-calendar-month legal deadline. */
export const RIGHTS_DUE_DAYS = 28;
export function rightsDueAt(received: Date): Date {
  return new Date(received.getTime() + RIGHTS_DUE_DAYS * 864e5);
}
export function isOverdue(r: { status: string; due_at: string }, now = new Date()): boolean {
  return (
    !["completed", "rejected", "withdrawn", "paused"].includes(r.status) && new Date(r.due_at) < now
  );
}

/** §79 locked schedule, mirrored by public.apply_retention() (runs daily). */
export const RETENTION_SCHEDULE = [
  { what: "Coach messages", keep: "12 months, or sooner if you delete them" },
  { what: "Notification history", keep: "12 months" },
  { what: "Call outcomes", keep: "24 months (no audio or transcript is ever stored)" },
  { what: "Health and wearable readings", keep: "24 months" },
  { what: "Security and safety records", keep: "24 months" },
  { what: "Coach tool activity (no message content)", keep: "90 days" },
  { what: "Your profile, plans, goals and progress", keep: "While your account is open" },
  {
    what: "Payment records",
    keep: "7 years, as the law requires, with no health or coaching content",
  },
] as const;
