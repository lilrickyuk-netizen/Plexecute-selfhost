// One training owner: when an active Training Programme exists, the member's fitness goal and the programme's
// planner goal are the same goal. The goal says WHY, the programme says WHAT, the schedule says WHEN.
export type GoalLite = {
  id: string;
  title: string;
  domain: string;
  status: string;
  created_at?: string | null;
};

const FIT_WORDS =
  /\b(fit|fitter|fitness|strength|stronger|stamina|endurance|push[- ]?ups?|pull[- ]?ups?|muscle|workouts?|training|train|gym|bodyweight|circuits?|conditioning|calisthenics|hypertrophy)\b/i;
export const PROGRAMME_GOAL_TITLE = "Training programme";

/** Goals whose sessions would be workouts (so a programme already fulfils them). */
export function isTrainingGoal(g: GoalLite): boolean {
  if (g.domain === "training") return true;
  if (g.domain === "fitness") return true;
  // A generic goal only counts when its wording is clearly about training (not weight, diet or cardio-only domains).
  return ["other", "health"].includes(g.domain) && FIT_WORDS.test(g.title);
}

/** Which goal keeps ownership and which duplicates fold into it. Null when nothing needs changing. */
export function planTrainingGoalMerge(
  goals: GoalLite[],
  hasProgramme: boolean,
): { keeperId: string; mergeIds: string[] } | null {
  if (!hasProgramme) return null;
  const live = goals.filter(
    (g) => ["active", "proposed", "paused"].includes(g.status) && isTrainingGoal(g),
  );
  if (!live.length) return null;
  const rank = (g: GoalLite) =>
    (g.title === PROGRAMME_GOAL_TITLE ? 10 : 0) + (g.status === "active" ? 0 : 5);
  const keeper = [...live].sort(
    (a, b) =>
      rank(a) - rank(b) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  )[0]!;
  const mergeIds = live.filter((g) => g.id !== keeper.id).map((g) => g.id);
  // Always returned while a programme exists: the keeper's frequency is re-synced to the programme every time.
  return { keeperId: keeper.id, mergeIds };
}
