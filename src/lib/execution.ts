// V3 §38 execution state machine. Single source of legal transitions; the database trigger mirrors it.
// Stored values are lower-case; V3_NAME gives the authoritative V3 state name.
export const EXECUTION_STATES = [
  "planned",
  "scheduled",
  "upcoming",
  "due",
  "contacting",
  "acknowledged",
  "started",
  "in_progress",
  "done",
  "partial",
  "snoozed",
  "rescheduled",
  "skipped",
  "blocked",
  "expired",
  "cancelled",
  "safety_stopped",
] as const;
export type ExecState = (typeof EXECUTION_STATES)[number];

export const V3_NAME: Record<ExecState, string> = {
  planned: "PLANNED",
  scheduled: "SCHEDULED",
  upcoming: "UPCOMING",
  due: "DUE",
  contacting: "CONTACTING",
  acknowledged: "ACKNOWLEDGED",
  started: "STARTED",
  in_progress: "IN_PROGRESS",
  done: "COMPLETED",
  partial: "PARTIAL",
  snoozed: "SNOOZED",
  rescheduled: "RESCHEDULED",
  skipped: "SKIPPED",
  blocked: "BLOCKED",
  expired: "EXPIRED",
  cancelled: "CANCELLED",
  safety_stopped: "SAFETY_STOPPED",
};

export const STATE_LABEL: Record<ExecState, string> = {
  planned: "planned",
  scheduled: "scheduled",
  upcoming: "coming up",
  due: "due now",
  contacting: "calling you",
  acknowledged: "acknowledged",
  started: "started",
  in_progress: "in progress",
  done: "done",
  partial: "partly done",
  snoozed: "snoozed",
  rescheduled: "moved",
  skipped: "skipped",
  blocked: "blocked",
  expired: "missed",
  cancelled: "cancelled",
  safety_stopped: "stopped for safety",
};

/** Not yet acted on: can still be started, done, snoozed or moved. */
export const OPEN_STATES: ExecState[] = [
  "planned",
  "scheduled",
  "upcoming",
  "due",
  "contacting",
  "acknowledged",
  "snoozed",
];
/** Outcome recorded by the user or evidence. */
export const OUTCOME_STATES: ExecState[] = [
  "done",
  "partial",
  "skipped",
  "blocked",
  "safety_stopped",
];
export const TERMINAL_STATES: ExecState[] = ["rescheduled", "expired", "cancelled"];

const PRE: ExecState[] = [
  "planned",
  "scheduled",
  "upcoming",
  "due",
  "contacting",
  "acknowledged",
  "snoozed",
];
const outcomes = (...extra: ExecState[]): ExecState[] => [
  "done",
  "partial",
  "blocked",
  "skipped",
  "safety_stopped",
  ...extra,
];

/** Legal next states for each state. */
export const TRANSITIONS: Record<ExecState, ExecState[]> = {
  planned: [
    "scheduled",
    "upcoming",
    "due",
    "contacting",
    "acknowledged",
    "started",
    "in_progress",
    "snoozed",
    "rescheduled",
    "expired",
    "cancelled",
    ...outcomes(),
  ],
  scheduled: [
    "upcoming",
    "due",
    "contacting",
    "acknowledged",
    "started",
    "in_progress",
    "snoozed",
    "rescheduled",
    "expired",
    "cancelled",
    ...outcomes(),
  ],
  upcoming: [
    "due",
    "contacting",
    "acknowledged",
    "started",
    "in_progress",
    "snoozed",
    "rescheduled",
    "expired",
    "cancelled",
    ...outcomes(),
  ],
  due: [
    "contacting",
    "acknowledged",
    "started",
    "in_progress",
    "snoozed",
    "rescheduled",
    "expired",
    "cancelled",
    ...outcomes(),
  ],
  contacting: [
    "due",
    "acknowledged",
    "started",
    "in_progress",
    "snoozed",
    "expired",
    ...outcomes(),
  ],
  acknowledged: [
    "due",
    "contacting",
    "started",
    "in_progress",
    "snoozed",
    "rescheduled",
    "expired",
    "cancelled",
    ...outcomes(),
  ],
  snoozed: [
    "upcoming",
    "due",
    "contacting",
    "acknowledged",
    "started",
    "in_progress",
    "snoozed",
    "rescheduled",
    "expired",
    "cancelled",
    ...outcomes(),
  ],
  started: ["in_progress", ...outcomes()],
  in_progress: outcomes(),
  // Outcomes can be undone by the user (restore to planned) or corrected to another outcome.
  done: ["planned", "partial"],
  partial: ["planned", "done"],
  blocked: ["planned"],
  skipped: ["planned"],
  safety_stopped: ["planned"],
  expired: ["planned", "done", "partial", "skipped"], // late self-report of a missed session
  rescheduled: [],
  cancelled: [],
};
void PRE;

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from as ExecState] ?? []).includes(to as ExecState);
}

export type ExecAction =
  | "acknowledge"
  | "start"
  | "complete"
  | "partial"
  | "blocked"
  | "skip"
  | "safety_stop"
  | "snooze"
  | "restore"
  | "cancel";
export const ACTION_TARGET: Record<ExecAction, ExecState> = {
  acknowledge: "acknowledged",
  start: "in_progress",
  complete: "done",
  partial: "partial",
  blocked: "blocked",
  skip: "skipped",
  safety_stop: "safety_stopped",
  snooze: "snoozed",
  restore: "planned",
  cancel: "cancelled",
};

export class TransitionError extends Error {
  code = "EXECUTION_TRANSITION_INVALID" as const;
  status = 409 as const;
  constructor(from: string, to: string) {
    super(
      `EXECUTION_TRANSITION_INVALID: a ${STATE_LABEL[from as ExecState] ?? from} session cannot become ${STATE_LABEL[to as ExecState] ?? to}.`,
    );
  }
}

export function assertTransition(from: string, to: string) {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}

const UPCOMING_MS = 2 * 36e5,
  EXPIRE_GRACE_MS = 2 * 36e5;
/** Time-driven lifecycle step for an open occurrence (run by the scheduler job). Returns null when nothing changes. */
export function timeStep(
  b: { status: string; starts_at: string; duration_min: number },
  now: Date,
): ExecState | null {
  if (!OPEN_STATES.includes(b.status as ExecState)) return null;
  const start = new Date(b.starts_at).getTime(),
    end = start + b.duration_min * 60000,
    t = now.getTime();
  if (t > end + EXPIRE_GRACE_MS) return "expired";
  if (t >= start && !["due", "contacting", "acknowledged"].includes(b.status)) return "due";
  if (t < start && t >= start - UPCOMING_MS && ["planned", "scheduled"].includes(b.status))
    return "upcoming";
  return null;
}
