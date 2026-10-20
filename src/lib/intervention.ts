/**
 * JIT Adaptive Intervention Engine (V3 §39) + Interruption Budget (V3 §40). Pure and deterministic.
 * The engine alone decides whether, when, how and through which permitted channel to intervene.
 * Wording is fixed text; AI never decides whether an intervention is allowed.
 */
export const INTERVENTION_POLICY_VERSION = "intervention_v1";
export const MIN_SPACING_MIN = 30;
export const ADAPTIVE_DEFAULT = 6;
export const ADAPTIVE_HARD_CAP = 12;
/** Own choice: the spec asks for a learned minimum effective intervention but gives no threshold; we reuse V3 §42's n >= 5. */
export const LEARN_MIN_N = 5;

export type Tier = "free" | "pro" | "execute";
export type AccountabilityLevel = "off" | "reminders_only" | "adaptive";
export type InterventionKind = "reminder" | "adaptive";
export type Channel = "in_app" | "email";

export const LEVEL_LABEL: Record<AccountabilityLevel, { title: string; detail: string }> = {
  off: { title: "Off", detail: "No reminders or nudges from Plexecute." },
  reminders_only: {
    title: "Only my reminders",
    detail: "Just the reminder you set before each session.",
  },
  adaptive: {
    title: "Adaptive nudges",
    detail:
      "Your reminders, plus a check-in when a session is due and not started, within your daily limit.",
  },
};

/** Tier budget for adaptive interventions per local day. Free: user-created reminders only. */
export function adaptiveBudget(tier: Tier, chosen: number): number {
  if (tier === "free") return 0;
  return Math.max(0, Math.min(ADAPTIVE_HARD_CAP, Math.round(chosen)));
}

const PRE_START = new Set(["planned", "scheduled", "upcoming", "snoozed"]);
const OPEN_AT_START = new Set(["due", "upcoming", "scheduled", "planned"]);

export type InterventionInput = {
  now: Date;
  kind: InterventionKind;
  tier: Tier;
  level: AccountabilityLevel;
  remindersEnabled: boolean;
  chosenBudget: number;
  block: { status: string; starts_at: string; duration_min: number };
  /** minutes before start the user asked to be reminded (already adjusted by permitted timing changes) */
  leadMin: number;
  inQuiet: boolean;
  /** overlapping hard commitment or another session already in progress */
  conflict: boolean;
  safety: { pauseAccountability: boolean; stopOrdinaryCoaching: boolean };
  /** recovery today is RED */
  recoveryRed: boolean;
  /** prior interventions for this block of this kind */
  alreadySentForBlock: boolean;
  adaptiveSentToday: number;
  lastAdaptiveAt: string | null;
  /** past occurrences that had only the user's reminder: how many were acknowledged/started without a nudge */
  reminderOnly: { n: number; actedOn: number };
  emailAllowed: boolean;
};

export type InterventionDecision = { allowed: boolean; reason: string; channels: Channel[] };

const no = (reason: string): InterventionDecision => ({ allowed: false, reason, channels: [] });

export function decideIntervention(i: InterventionInput): InterventionDecision {
  const start = new Date(i.block.starts_at).getTime();
  const now = i.now.getTime();
  if (i.level === "off" || !i.remindersEnabled) return no("user_turned_off");
  if (i.safety.stopOrdinaryCoaching || i.safety.pauseAccountability) return no("safety_pause");
  if (i.alreadySentForBlock) return no("already_sent");

  if (i.kind === "reminder") {
    // User-configured countdown reminder: exempt from spacing and adaptive budget (§40).
    if (!PRE_START.has(i.block.status)) return no("not_pending");
    if (now < start - i.leadMin * 60000) return no("not_yet");
    if (now >= start) return no("start_passed");
    return {
      allowed: true,
      reason: "user_reminder",
      channels: i.inQuiet || !i.emailAllowed ? ["in_app"] : ["in_app", "email"],
    };
  }

  // Adaptive check-in at start when the session is open and not acknowledged/started.
  if (i.level !== "adaptive") return no("level_reminders_only");
  const budget = adaptiveBudget(i.tier, i.chosenBudget);
  if (budget === 0) return no(i.tier === "free" ? "tier_reminders_only" : "budget_zero");
  if (!OPEN_AT_START.has(i.block.status)) return no("not_open");
  if (now < start) return no("not_yet");
  if (now > start + Math.min(i.block.duration_min, 60) * 60000) return no("window_passed");
  if (i.inQuiet) return no("quiet_hours");
  if (i.conflict) return no("calendar_conflict");
  if (i.recoveryRed) return no("recovery_red");
  if (i.adaptiveSentToday >= budget) return no("daily_budget_reached");
  if (i.lastAdaptiveAt && now - new Date(i.lastAdaptiveAt).getTime() < MIN_SPACING_MIN * 60000)
    return no("min_spacing");
  // Minimum effective intervention: if the reminder alone usually works, don't add a nudge.
  if (i.reminderOnly.n >= LEARN_MIN_N && i.reminderOnly.actedOn * 2 > i.reminderOnly.n)
    return no("reminder_alone_effective");
  return { allowed: true, reason: "due_not_started", channels: ["in_app"] };
}

export const REASON_COPY: Record<string, string> = {
  user_reminder: "Your reminder before the session",
  due_not_started: "Session due and not started",
  user_turned_off: "You've turned reminders off",
  safety_pause: "Paused while a safety note is active",
  already_sent: "Already sent for this session",
  level_reminders_only: "You chose only your own reminders",
  tier_reminders_only: "Free plan: your own reminders only",
  budget_zero: "Your daily nudge limit is 0",
  quiet_hours: "Quiet hours",
  calendar_conflict: "Clashes with a commitment or another session",
  recovery_red: "Red recovery day",
  daily_budget_reached: "Daily nudge limit reached",
  min_spacing: "Less than 30 minutes since the last nudge",
  reminder_alone_effective: "Your reminder usually works on its own",
};

/** Member-facing wording for each decision reason (shown in Settings → Notifications). */
export const DECISION_LABEL: Record<string, string> = {
  user_turned_off: "Reminders are switched off",
  safety_pause: "Paused for your safety",
  already_sent: "Already reminded",
  not_pending: "Session already under way or finished",
  not_yet: "Too early",
  start_passed: "Start time had passed",
  level_reminders_only: "You chose reminders only",
  tier_reminders_only: "Your plan includes reminders only",
  budget_zero: "Daily check-ins set to none",
  not_open: "Session already handled",
  window_passed: "Too late to help",
  quiet_hours: "Quiet hours",
  calendar_conflict: "You had a calendar event",
  recovery_red: "Low recovery day",
  daily_budget_reached: "Daily check-in limit reached",
  min_spacing: "Too soon after the last check-in",
  reminder_alone_effective: "The reminder alone usually works for you",
  user_reminder: "Your reminder",
  due_not_started: "Check-in at start time",
};
