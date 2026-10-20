// V3 Auto-Adapt permissions (spec §37). Pure helpers shared by server and UI.
export const AUTO_ADAPT_PERMISSIONS = [
  "MOVE_NONPROTECTED_TASK_WITHIN_DAY",
  "MOVE_NONPROTECTED_TASK_WITHIN_24H",
  "ADJUST_WORKOUT_LOAD_WITHIN_ENGINE_RULE",
  "ADJUST_NUTRITION_TARGET_WITHIN_150_KCAL_WEEKLY",
  "CHANGE_REMINDER_TIMING",
] as const;
export type AutoAdaptPermission = (typeof AUTO_ADAPT_PERMISSIONS)[number];
export type AutoAdaptMap = Record<AutoAdaptPermission, boolean>;

/** Defaults keep the engine-rule behaviours that already existed; moving sessions and reminder timing start off. */
export const AUTO_ADAPT_DEFAULTS: AutoAdaptMap = {
  MOVE_NONPROTECTED_TASK_WITHIN_DAY: false,
  MOVE_NONPROTECTED_TASK_WITHIN_24H: false,
  ADJUST_WORKOUT_LOAD_WITHIN_ENGINE_RULE: true,
  ADJUST_NUTRITION_TARGET_WITHIN_150_KCAL_WEEKLY: true,
  CHANGE_REMINDER_TIMING: false,
};

export const AUTO_ADAPT_LABELS: Record<AutoAdaptPermission, { title: string; detail: string }> = {
  MOVE_NONPROTECTED_TASK_WITHIN_DAY: {
    title: "Move sessions within the same day",
    detail:
      "Catch-ups and moves that stay on the same day are applied without asking. Protected sessions never move.",
  },
  MOVE_NONPROTECTED_TASK_WITHIN_24H: {
    title: "Move sessions up to 24 hours",
    detail: "Catch-ups placed within 24 hours of the original time are applied without asking.",
  },
  ADJUST_WORKOUT_LOAD_WITHIN_ENGINE_RULE: {
    title: "Adjust workout weights by the training rules",
    detail:
      "Weight goes up or down only by the fixed progression rules. When off, changes are shown as suggestions.",
  },
  ADJUST_NUTRITION_TARGET_WITHIN_150_KCAL_WEEKLY: {
    title: "Adjust calories by up to 150 a week",
    detail: "Bigger changes always need your approval. When off, every change needs approval.",
  },
  CHANGE_REMINDER_TIMING: {
    title: "Change reminder timing",
    detail: "Sessions you often snooze get reminded up to 15 minutes earlier.",
  },
};

/** Things that always need explicit user action, whatever is switched on. */
export const NEVER_AUTOMATIC = [
  "Goals and deadlines",
  "Protected sessions and fixed commitments",
  "Accountability call consent",
  "Safety limits",
];

export function toMap(
  rows: { permission: string; enabled: boolean }[] | null | undefined,
): AutoAdaptMap {
  const m = { ...AUTO_ADAPT_DEFAULTS };
  for (const r of rows ?? [])
    if ((AUTO_ADAPT_PERMISSIONS as readonly string[]).includes(r.permission))
      m[r.permission as AutoAdaptPermission] = r.enabled;
  return m;
}

/** True when every move stays inside the granted bound. A move with no origin is never auto-applied. */
export function movesWithinBounds(
  moves: { from: string | null; to: string }[],
  perms: AutoAdaptMap,
): boolean {
  if (!moves.length) return false;
  return moves.every(({ from, to }) => {
    if (!from) return false;
    const a = new Date(from),
      b = new Date(to);
    if (perms.MOVE_NONPROTECTED_TASK_WITHIN_24H && Math.abs(b.getTime() - a.getTime()) <= 24 * 36e5)
      return true;
    return perms.MOVE_NONPROTECTED_TASK_WITHIN_DAY && a.toDateString() === b.toDateString();
  });
}

/** Extra reminder lead for frequently snoozed sessions, only when permitted. */
export function reminderLeadMin(
  baseLead: number,
  interruptions: number,
  perms: AutoAdaptMap,
): number {
  if (!perms.CHANGE_REMINDER_TIMING || interruptions <= 0) return baseLead;
  return Math.min(baseLead + Math.min(interruptions, 3) * 5, baseLead + 15);
}
