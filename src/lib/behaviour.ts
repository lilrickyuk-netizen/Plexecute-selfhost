// V3 §41 Behaviour Science Engine (locked): explicit, auditable mechanisms. A missed task is data, not moral failure.
export const BEHAVIOUR_POLICY_VERSION = "behaviour_v1";

export const MISSED_REASONS = [
  "TIME_CONFLICT",
  "WORK_OVERRUN",
  "FAMILY_COMMITMENT",
  "TRAVEL",
  "LOW_ENERGY",
  "POOR_SLEEP",
  "FORGOT",
  "ENVIRONMENT_UNAVAILABLE",
  "PAIN_OR_INJURY",
  "ILLNESS",
  "MOTIVATION",
  "TASK_TOO_LARGE",
  "PLAN_UNCLEAR",
  "OTHER",
  "DECLINE_TO_SAY",
] as const;
export type MissedReason = (typeof MISSED_REASONS)[number];

export const REASON_LABEL: Record<MissedReason, string> = {
  TIME_CONFLICT: "Something else was on at the same time",
  WORK_OVERRUN: "Work ran over",
  FAMILY_COMMITMENT: "Family needed me",
  TRAVEL: "Travelling",
  LOW_ENERGY: "Low energy",
  POOR_SLEEP: "Slept badly",
  FORGOT: "Forgot",
  ENVIRONMENT_UNAVAILABLE: "Place or equipment not available",
  PAIN_OR_INJURY: "Pain or injury",
  ILLNESS: "Unwell",
  MOTIVATION: "Didn't feel like it",
  TASK_TOO_LARGE: "Too big for the time I had",
  PLAN_UNCLEAR: "Wasn't sure what to do",
  OTHER: "Something else",
  DECLINE_TO_SAY: "Prefer not to say",
};

export type Mechanism =
  | "goal_decomposition"
  | "implementation_intention"
  | "obstacle_planning"
  | "preparation_cue"
  | "graded_scaling"
  | "self_monitoring"
  | "reflection"
  | "autonomy_choice"
  | "progress_feedback"
  | "lapse_recovery"
  | "intervention_experiment";

/** Lapse recovery: each reason maps to mechanisms the user can choose from (autonomy-supportive, never imposed). */
export type LapseOption = { mechanism: Mechanism; label: string; to?: string };
export const LAPSE_OPTIONS: Record<MissedReason, LapseOption[]> = {
  TIME_CONFLICT: [
    { mechanism: "lapse_recovery", label: "Find a catch-up time", to: "/app/plan" },
    { mechanism: "implementation_intention", label: "Add an IF/WHEN → THEN plan for clashes" },
  ],
  WORK_OVERRUN: [
    { mechanism: "lapse_recovery", label: "Find a catch-up time", to: "/app/plan" },
    { mechanism: "obstacle_planning", label: "Plan for work running over" },
  ],
  FAMILY_COMMITMENT: [
    { mechanism: "lapse_recovery", label: "Find a catch-up time", to: "/app/plan" },
    {
      mechanism: "obstacle_planning",
      label: "Add the commitment so it's planned around",
      to: "/app/commitments",
    },
  ],
  TRAVEL: [
    {
      mechanism: "obstacle_planning",
      label: "Add the trip so it's planned around",
      to: "/app/commitments",
    },
    { mechanism: "graded_scaling", label: "Plan a shorter travel version" },
  ],
  LOW_ENERGY: [
    { mechanism: "graded_scaling", label: "Make next time smaller", to: "goal" },
    { mechanism: "self_monitoring", label: "Log a recovery check-in", to: "/app/recovery" },
  ],
  POOR_SLEEP: [
    { mechanism: "self_monitoring", label: "Log a recovery check-in", to: "/app/recovery" },
    { mechanism: "graded_scaling", label: "Make next time smaller", to: "goal" },
  ],
  FORGOT: [
    { mechanism: "preparation_cue", label: "Add a preparation cue" },
    {
      mechanism: "intervention_experiment",
      label: "Test a different reminder time",
      to: "/app/experiments",
    },
  ],
  ENVIRONMENT_UNAVAILABLE: [
    { mechanism: "obstacle_planning", label: "Plan a backup place or version" },
    { mechanism: "preparation_cue", label: "Add a preparation cue" },
  ],
  PAIN_OR_INJURY: [
    { mechanism: "self_monitoring", label: "Review safety notes", to: "/app/settings" },
  ],
  ILLNESS: [
    { mechanism: "lapse_recovery", label: "Rest; repair the day if you need to", to: "/app/today" },
  ],
  MOTIVATION: [
    { mechanism: "reflection", label: "Revisit why this goal matters" },
    { mechanism: "graded_scaling", label: "Make next time smaller", to: "goal" },
    { mechanism: "autonomy_choice", label: "Pause or change this goal" },
  ],
  TASK_TOO_LARGE: [
    { mechanism: "goal_decomposition", label: "Break it into smaller steps" },
    { mechanism: "graded_scaling", label: "Make next time smaller", to: "goal" },
  ],
  PLAN_UNCLEAR: [
    { mechanism: "goal_decomposition", label: "Break it into smaller steps" },
    { mechanism: "implementation_intention", label: "Write exactly when and what" },
  ],
  OTHER: [{ mechanism: "lapse_recovery", label: "Find a catch-up time", to: "/app/plan" }],
  DECLINE_TO_SAY: [{ mechanism: "lapse_recovery", label: "Find a catch-up time", to: "/app/plan" }],
};

/** Neutral acknowledgement; never moralising. */
export function lapseMessage(reason: MissedReason): string {
  if (reason === "PAIN_OR_INJURY" || reason === "ILLNESS")
    return "Noted. Looking after yourself comes first.";
  return "Noted. A missed session is useful information, not a failure.";
}

/** Reasons that point at the body route through the central safety engine. */
export const SAFETY_REASON: Partial<Record<MissedReason, "pain">> = { PAIN_OR_INJURY: "pain" };

/** Pattern from missed reasons over a window. Patterns are only shown with a minimum sample (V3 §42). */
export const MIN_SAMPLE = 5;
export const MIN_DAYS = 14;
export function reasonPattern(
  rows: { reason: string | null; at?: string | undefined }[],
): { reason: MissedReason; count: number; share: number; sample: number } | null {
  const dated = rows
    .map((r) => r.at)
    .filter(Boolean)
    .map((a) => new Date(a!).getTime());
  if (dated.length && (Math.max(...dated) - Math.min(...dated)) / 864e5 + 1 < MIN_DAYS) return null;
  const valid = rows
    .map((r) => r.reason)
    .filter(
      (r): r is MissedReason =>
        (MISSED_REASONS as readonly string[]).includes(r ?? "") &&
        r !== "DECLINE_TO_SAY" &&
        r !== "OTHER",
    );
  if (valid.length < MIN_SAMPLE) return null;
  const counts = new Map<MissedReason, number>();
  for (const r of valid) counts.set(r, (counts.get(r) ?? 0) + 1);
  const [reason, count] = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || MISSED_REASONS.indexOf(a[0]) - MISSED_REASONS.indexOf(b[0]),
  )[0]!;
  if (count < 2) return null;
  return { reason, count, share: count / valid.length, sample: valid.length };
}

export const INTENTION_KINDS = ["intention", "obstacle", "cue"] as const;
export type IntentionKind = (typeof INTENTION_KINDS)[number];
export const INTENTION_COPY: Record<IntentionKind, { title: string; when: string; then: string }> =
  {
    intention: {
      title: "IF/WHEN → THEN plan",
      when: "When… (e.g. I get home from work)",
      then: "Then I will… (e.g. change and go for my walk)",
    },
    obstacle: {
      title: "Obstacle plan",
      when: "If this gets in the way… (e.g. work runs late)",
      then: "Then I will… (e.g. do the 15-minute version)",
    },
    cue: {
      title: "Preparation cue",
      when: "Before… (e.g. the night before)",
      then: "I will prepare… (e.g. pack my gym bag)",
    },
  };
