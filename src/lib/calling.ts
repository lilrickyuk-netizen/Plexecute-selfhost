/**
 * Paid accountability calling policy (V3 §5.4, §63, §64, §65). Pure and deterministic.
 * Twilio owns transport; this module owns allowance, eligibility, retry, state mapping and scripts.
 */

export const PRO_ALLOWANCE = {
  maxAttempts: 2,
  retryAfterMin: 10,
} as const;
export const CALL_CONSENT_VERSION = "call_consent_v1";
export const DISCLOSURE_SCRIPT_VERSION = "gb_disclosure_v3_owner";
// The owner chose the opening wording; existing signed-off markets remain valid during rollout.
// Consent, hours and all other market gates are unchanged.
export const COMPATIBLE_DISCLOSURE_VERSIONS = [
  "gb_disclosure_v1",
  "gb_disclosure_v2_short",
  DISCLOSURE_SCRIPT_VERSION,
] as const;
/** V3 §64.3: opening line before any task detail (owner's wording). */
export const DISCLOSURE = "This is a call from Plexecute.";
export const CONFIRM_PROMPT = "Say hello to speak to Coach.";

export type CallState =
  | "CALL_ELIGIBLE"
  | "CALL_QUEUED"
  | "CALL_CREATED"
  | "RINGING"
  | "ANSWERED_PENDING_HUMAN"
  | "HUMAN_CONNECTED"
  | "MACHINE_DETECTED"
  | "NO_ANSWER"
  | "BUSY"
  | "FAILED"
  | "CANCELLED"
  | "ACKNOWLEDGED"
  | "RETRY_SCHEDULED"
  | "RETRY_POLICY_PAUSED"
  | "ALLOWANCE_EXHAUSTED";

export const STATE_LABEL: Record<CallState, string> = {
  CALL_ELIGIBLE: "Ready",
  CALL_QUEUED: "Waiting to call",
  CALL_CREATED: "Calling",
  RINGING: "Ringing",
  ANSWERED_PENDING_HUMAN: "Answered",
  HUMAN_CONNECTED: "Connected",
  MACHINE_DETECTED: "Voicemail, no message left",
  NO_ANSWER: "No answer",
  BUSY: "Line busy",
  FAILED: "Call failed",
  CANCELLED: "Cancelled",
  ACKNOWLEDGED: "You answered",
  RETRY_SCHEDULED: "Will try once more",
  RETRY_POLICY_PAUSED: "Paused",
  ALLOWANCE_EXHAUSTED: "Monthly allowance used",
};

export type Ack =
  | "START_NOW"
  | "SNOOZE"
  | "RESCHEDULE"
  | "SKIP_WITH_REASON"
  | "BLOCKED"
  | "STOP_CALLING_FOR_THIS_TASK"
  | "STOP_ALL_CALLS";
/** Keypad choices once the account holder is confirmed (V3 §64.9). */
export const ACK_DIGITS: Record<string, Ack> = {
  "1": "START_NOW",
  "2": "SNOOZE",
  "3": "RESCHEDULE",
  "4": "SKIP_WITH_REASON",
  "5": "BLOCKED",
  "8": "STOP_CALLING_FOR_THIS_TASK",
  "9": "STOP_ALL_CALLS",
};
export const ACK_LABEL: Record<Ack, string> = {
  START_NOW: "Starting now",
  SNOOZE: "Snoozed 10 minutes",
  RESCHEDULE: "Asked to move it",
  SKIP_WITH_REASON: "Skipped",
  BLOCKED: "Something got in the way",
  STOP_CALLING_FOR_THIS_TASK: "Stopped calls for this session",
  STOP_ALL_CALLS: "Stopped all calls",
};
export const ACK_MENU =
  "Press 1 to start now. 2 to snooze for 10 minutes. 3 to move it to another time. 4 to skip it. 5 if something is blocking you. 8 to stop calls for this session. 9 to stop all calls.";
/** Task detail is only spoken after confirmation and never left on voicemail (V3 §64.4). */
export function taskPrompt(title: string) {
  return `Thanks. Your scheduled session, ${title}, is due now. ${ACK_MENU}`;
}

/** Service month: monthly windows anchored to the subscription start/renewal (annual plans reset monthly too). */
export function serviceMonth(now: Date, anchor: Date): { start: Date; end: Date } {
  const addMonths = (d: Date, n: number) => {
    const y = d.getUTCFullYear(),
      m = d.getUTCMonth() + n,
      day = d.getUTCDate();
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(
      Date.UTC(y, m, Math.min(day, last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()),
    );
  };
  let k =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - anchor.getUTCMonth());
  let start = addMonths(anchor, k);
  if (start > now) {
    k--;
    start = addMonths(anchor, k);
  } else if (addMonths(anchor, k + 1) <= now) {
    k++;
    start = addMonths(anchor, k);
  }
  return { start, end: addMonths(anchor, k + 1) };
}

export type Usage = {
  campaignsUsed: number;
  connectedSeconds: number;
  includedAvailable?: boolean;
  topUpSeconds?: number;
  topUpUsedSeconds?: number;
};
export function proUsage(u: Usage) {
  const topUpSecondsLeft = Math.max(0, (u.topUpSeconds ?? 0) - (u.topUpUsedSeconds ?? 0));
  // Per-attempt bound only. The atomic spend reservation determines affordable
  // seconds before dialling; monthly call counts/minutes never deny Pro.
  const secondsLeft = u.includedAvailable ? 900 : topUpSecondsLeft;
  return { secondsLeft, topUpSecondsLeft };
}

export type EligibilityInput = {
  tier: "free" | "pro" | "execute";
  providerReady: boolean;
  marketApproved: boolean;
  phoneVerified: boolean;
  consented: boolean;
  callsStopped: boolean;
  inQuiet: boolean;
  safetyPause: boolean;
  usage: Usage;
};
export type Eligibility = { ok: true } | { ok: false; reason: string };
/** Decides whether a new Pro campaign may start. Order matters: the first failing rule is reported. */
export function proCampaignEligibility(i: EligibilityInput): Eligibility {
  if (i.tier === "free") return { ok: false, reason: "tier_free" };
  if (!i.providerReady) return { ok: false, reason: "not_configured" };
  if (!i.marketApproved) return { ok: false, reason: "market_not_cleared" };
  if (!i.phoneVerified) return { ok: false, reason: "phone_unverified" };
  if (!i.consented) return { ok: false, reason: "no_consent" };
  if (i.callsStopped) return { ok: false, reason: "calls_stopped" };
  if (i.safetyPause) return { ok: false, reason: "safety_pause" };
  if (i.inQuiet) return { ok: false, reason: "quiet_hours" };
  const u = proUsage(i.usage);
  if (u.secondsLeft <= 0) return { ok: false, reason: "allowance_exhausted" };
  return { ok: true };
}

export const REASON_COPY: Record<string, string> = {
  tier_free: "Calls are part of Pro and Execute.",
  not_configured:
    "Calls aren't switched on yet. They start working once the phone service keys are added.",
  market_not_cleared: "Calls aren't available in your country yet.",
  phone_unverified: "Verify your phone number first.",
  no_consent: "Read and agree to how calls work first.",
  calls_stopped: "You've stopped all calls. Turn them back on to get calls.",
  safety_pause: "Calls are paused while a safety note is active.",
  quiet_hours: "It's your quiet hours, so no calls.",
  allowance_exhausted: "You've used this month's Pro calls. In-app reminders carry on.",
  trial_ceiling:
    "You have reached the trial call limit. Calls return when your paid plan starts. In-app reminders carry on.",
  global_kill_switch: "Calls are switched off everywhere for now. In-app reminders carry on.",
  market_kill_switch: "Calls are switched off in your country for now. In-app reminders carry on.",
  consent_not_approved:
    "Calls in your country are waiting for the updated consent wording to be approved.",
  disclosure_not_approved:
    "Calls in your country are waiting for the call opening wording to be approved.",
  outside_permitted_hours: "It's outside the hours calls are allowed in your country.",
  task_type_not_allowed: "You turned off calls for this type of session.",
};

/** Provider statuses stay separate from Plexecute domain states (V3 §64.7). */
export function mapProviderStatus(status: string, answeredBy?: string | null): CallState {
  if (answeredBy && answeredBy.startsWith("machine")) return "MACHINE_DETECTED";
  switch (status) {
    case "queued":
    case "initiated":
      return "CALL_CREATED";
    case "ringing":
      return "RINGING";
    case "in-progress":
    case "answered":
      return "ANSWERED_PENDING_HUMAN";
    case "no-answer":
      return "NO_ANSWER";
    case "busy":
      return "BUSY";
    case "failed":
      return "FAILED";
    case "canceled":
      return "CANCELLED";
    default:
      return "CALL_CREATED";
  }
}

export const RETRYABLE: CallState[] = ["NO_ANSWER", "BUSY", "MACHINE_DETECTED"];
/**
 * After a final outcome. Pro: one courtesy retry 10 minutes after no-answer/busy/voicemail, then stop phone attempts.
 * Connected or acknowledged calls never retry.
 */
export function afterFinal(
  policy: "pro",
  attempts: number,
  final: CallState,
  now: Date,
): { state: CallState; retryAt: Date | null } {
  if (!RETRYABLE.includes(final)) return { state: final, retryAt: null };
  if (policy === "pro" && attempts < PRO_ALLOWANCE.maxAttempts)
    return {
      state: "RETRY_SCHEDULED",
      retryAt: new Date(now.getTime() + PRO_ALLOWANCE.retryAfterMin * 60000),
    };
  return { state: final, retryAt: null };
}

/** Which execution state an acknowledgement moves the session to (null = leave the session as it is). */
export const ACK_TO_STATUS: Record<Ack, string | null> = {
  START_NOW: "started",
  SNOOZE: "snoozed",
  RESCHEDULE: null,
  SKIP_WITH_REASON: "skipped",
  BLOCKED: "blocked",
  STOP_CALLING_FOR_THIS_TASK: null,
  STOP_ALL_CALLS: null,
};

const CA_AREA_CODES = new Set(
  "204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 387 403 416 418 428 431 437 438 450 460 468 474 506 514 519 548 579 581 584 587 600 604 613 622 639 647 672 683 705 709 742 753 778 780 782 807 819 825 867 873 879 902 905 942".split(
    " ",
  ),
);
/** E.164 check and country from the calling code (only the markets we can recognise). */
export function parseE164(raw: string): { e164: string; country: string } | null {
  const v = raw.replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(v)) return null;
  const cc: Array<[string, string]> = [
    ["+44", "GB"],
    ["+353", "IE"],
    ["+61", "AU"],
    ["+1", "US"],
  ];
  let country = cc.find(([p]) => v.startsWith(p))?.[1] ?? "OTHER";
  // +1 is shared by the US and Canada; Canadian area codes are listed so each matches its own market row.
  if (country === "US" && CA_AREA_CODES.has(v.slice(2, 5))) country = "CA";
  return { e164: v, country };
}

// ---------------- Execute persistent policy (V3 §5.5, §64.8, §65) ----------------
export const EXECUTE_ALLOWANCE = {
  connectedMinutes: 120,
  topUpMinutes: 60,
  topUpPricePence: 1499,
} as const;
/** Engineering ceilings (§64.8); a market row may set lower ones. */
export const EXECUTE_CEILINGS = { perOccurrence: 6, rolling24h: 12 } as const;
/** Minutes after the previous attempt: attempt 2 +5, 3 +10, 4 +20, 5+ every 30. */
export const EXECUTE_RETRY_GAPS = [5, 10, 20] as const;
export const EXECUTE_RETRY_EVERY = 30;

export function executeRetryGap(attemptsSoFar: number): number {
  return EXECUTE_RETRY_GAPS[attemptsSoFar - 1] ?? EXECUTE_RETRY_EVERY;
}

export type ExecuteTrigger = "due" | "missed" | "morning" | "evening" | "call_now";

export type ExecuteRetryInput = {
  attempts: number;
  /** user's own cap (1..6), never above the market/engineering ceiling */
  userMax: number;
  marketMax?: number | undefined;
  attemptsLast24h: number;
  /** the session is still open (not started, done, skipped, moved or stopped) */
  unresolved: boolean;
  /** the session's accountability window has not ended */
  inWindow: boolean;
  inQuiet: boolean;
  callsStopped: boolean;
  safetyPause: boolean;
  reputationHold: boolean;
};

/**
 * Execute retry: persistent while unresolved and lawful/reputation-safe.
 * Returns the reason to stop, or null when another attempt may be scheduled.
 */
export function executeRetryBlock(i: ExecuteRetryInput): string | null {
  const cap = Math.min(
    i.userMax,
    i.marketMax ?? EXECUTE_CEILINGS.perOccurrence,
    EXECUTE_CEILINGS.perOccurrence,
  );
  if (i.callsStopped) return "calls_stopped";
  if (i.safetyPause) return "safety_pause";
  if (!i.unresolved) return "resolved";
  if (i.attempts >= cap) return "occurrence_ceiling";
  if (i.attemptsLast24h >= EXECUTE_CEILINGS.rolling24h) return "rolling_ceiling";
  if (!i.inWindow) return "window_ended";
  if (i.inQuiet) return "quiet_hours";
  if (i.reputationHold) return "reputation_hold";
  return null;
}

export type ExecuteEligibilityInput = Omit<EligibilityInput, "usage" | "tier"> & {
  tier: "free" | "pro" | "execute";
  attemptsLast24h: number;
  connectedSecondsUsed: number;
  topUpSeconds: number;
  reputationHold: boolean;
};
/** A new Execute campaign. Phone time is checked against connected minutes, not campaigns (Execute has no campaign cap). */
export function executeCampaignEligibility(i: ExecuteEligibilityInput): Eligibility {
  if (i.tier !== "execute")
    return { ok: false, reason: i.tier === "free" ? "tier_free" : "not_execute" };
  if (!i.providerReady) return { ok: false, reason: "not_configured" };
  if (!i.marketApproved) return { ok: false, reason: "market_not_cleared" };
  if (!i.phoneVerified) return { ok: false, reason: "phone_unverified" };
  if (!i.consented) return { ok: false, reason: "no_consent" };
  if (i.callsStopped) return { ok: false, reason: "calls_stopped" };
  if (i.safetyPause) return { ok: false, reason: "safety_pause" };
  if (i.inQuiet) return { ok: false, reason: "quiet_hours" };
  if (i.reputationHold) return { ok: false, reason: "reputation_hold" };
  if (i.attemptsLast24h >= EXECUTE_CEILINGS.rolling24h)
    return { ok: false, reason: "rolling_ceiling" };
  if (i.connectedSecondsUsed >= EXECUTE_ALLOWANCE.connectedMinutes * 60 + i.topUpSeconds)
    return { ok: false, reason: "allowance_exhausted" };
  return { ok: true };
}

/**
 * Reputation guard (§64.6): if recent calls are mostly unanswered, pause automation and use
 * non-phone accountability. Own choice: ≥10 attempts in 7 days with under 20% answered.
 */
export const REPUTATION = { minAttempts: 10, minAnswerRate: 0.2, days: 7 } as const;
export function reputationHold(recent: { answered: boolean }[]): boolean {
  if (recent.length < REPUTATION.minAttempts) return false;
  return recent.filter((r) => r.answered).length / recent.length < REPUTATION.minAnswerRate;
}

/** Morning/evening policy: due within the 5-minute scheduler tick after the chosen local time. */
export function timedPolicyDue(localMinutes: number, targetHm: string, tickMin = 5): boolean {
  const [h, m] = targetHm.split(":").map(Number);
  const diff = (localMinutes - (h! * 60 + (m ?? 0)) + 1440) % 1440;
  return diff < tickMin;
}

export function callAnalytics(
  campaigns: {
    state: string;
    attempts: number;
    acknowledgement: string | null;
    connected_seconds: number;
  }[],
) {
  const n = campaigns.length;
  const answered = campaigns.filter(
    (c) => c.connected_seconds > 0 || ["HUMAN_CONNECTED", "ACKNOWLEDGED"].includes(c.state),
  ).length;
  const acked = campaigns.filter((c) => c.acknowledgement).length;
  const started = campaigns.filter((c) => c.acknowledgement === "START_NOW").length;
  const attempts = campaigns.reduce((s, c) => s + c.attempts, 0);
  return {
    campaigns: n,
    attempts,
    answerRate: n ? answered / n : null,
    ackRate: n ? acked / n : null,
    startRate: n ? started / n : null,
    avgAttempts: n ? attempts / n : null,
    connectedSeconds: campaigns.reduce((s, c) => s + c.connected_seconds, 0),
  };
}

export const EXECUTE_REASON_COPY: Record<string, string> = {
  not_execute: "Persistent calling is part of Execute.",
  reputation_hold:
    "Calls are paused for now because recent calls mostly went unanswered. Reminders in the app carry on.",
  rolling_ceiling:
    "Reached the limit of 12 calls in 24 hours. Calls resume later if the session is still open.",
  occurrence_ceiling: "Reached the most tries for this session.",
  window_ended: "The session's time has passed.",
  resolved: "You responded to the session.",
};

export const DAY_MENU = "Press 1 to confirm you've heard this. Press 9 to stop all calls.";
export function missedPrompt(title: string) {
  return `Thanks. Your session, ${title}, has passed without being started. Press 3 to pick a new time. 4 to skip it. 5 if something got in the way. 8 to stop calls for this session. 9 to stop all calls.`;
}
/** Morning: what's planned. Evening: what's done. Counts and titles only; no health details. */
export function dayPrompt(
  kind: "morning" | "evening",
  blocks: { title: string; status: string }[],
) {
  if (kind === "morning") {
    if (!blocks.length) return `Thanks. Nothing is planned for today. ${DAY_MENU}`;
    const first = blocks
      .slice(0, 3)
      .map((b) => b.title)
      .join(", ");
    return `Thanks. You have ${blocks.length} planned ${blocks.length === 1 ? "session" : "sessions"} today, starting with ${first}. ${DAY_MENU}`;
  }
  const done = blocks.filter((b) => b.status === "done").length;
  const open = blocks.filter((b) =>
    ["planned", "scheduled", "upcoming", "due", "snoozed", "acknowledged"].includes(b.status),
  );
  const rest = open.length
    ? ` Still open: ${open
        .slice(0, 3)
        .map((b) => b.title)
        .join(", ")}. You can still do them or move them in the app.`
    : "";
  return `Thanks. Today you completed ${done} of ${blocks.length} planned sessions.${rest} ${DAY_MENU}`;
}

// ---- V3 §24 / Step 47 per-user call settings ----
/** Generic voicemail: never contains task detail (§64.4). Only left when the user chose it. */
export const VOICEMAIL_GENERIC =
  "Hi, this is Plexecute, an automated AI coach, with the check-in you asked for. Open the Plexecute app to see what's next. Goodbye.";
export const VOICEMAIL_POLICIES = ["none", "generic"] as const;
export type VoicemailPolicy = (typeof VOICEMAIL_POLICIES)[number];
export const CALL_MINUTES = { min: 1, max: 10, default: 3 } as const;

/** null/empty list = every task type may call. */
export function kindAllowed(
  allowed: string[] | null | undefined,
  kind: string | null | undefined,
): boolean {
  if (!allowed || allowed.length === 0) return true;
  return !!kind && allowed.includes(kind);
}

/** Provider TimeLimit never exceeds the remaining reserved seconds. */
export function callTimeLimitSec(
  maxMinutes: number | null | undefined,
  secondsLeft: number,
): number {
  const m = Math.min(
    Math.max(maxMinutes ?? CALL_MINUTES.default, CALL_MINUTES.min),
    CALL_MINUTES.max,
  );
  return Math.max(0, Math.floor(Math.min(m * 60, secondsLeft, 900)));
}

/** Short tone line after account-holder confirmation. Tone only; no guilt, threats or pressure (§15). */
export const CALL_STYLE_LINE: Record<string, string> = {
  supportive: "Thanks for picking up.",
  direct: "Quick one.",
  disciplined: "This is the session you planned.",
  calm: "No rush. Here's the check-in.",
  competitive: "Here's your next one to complete.",
};
export function styleLine(style: string | null | undefined): string {
  return CALL_STYLE_LINE[style ?? ""] ?? CALL_STYLE_LINE["supportive"]!;
}

/** Answering machine handling. Returns the words to leave, or null to hang up silently. */
export function voicemailMessage(policy: string | null | undefined): string | null {
  return policy === "generic" ? VOICEMAIL_GENERIC : null;
}
