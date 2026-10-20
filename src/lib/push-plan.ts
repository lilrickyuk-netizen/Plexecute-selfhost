/**
 * Proactive Coach prompts for real plan items (pure). One planned occurrence → one coordinated
 * schedule of stages, worded for that exact item, opening the exact screen. Timing is decided
 * by the cron from saved plan state every tick, so moved, deleted or finished items never get
 * stale prompts.
 */
export const PUSH_KINDS = [
  "wake",
  "bedtime",
  "meal",
  "workout",
  "learning",
  "task",
  "appointment",
  "journey",
  "call",
  "family",
  "routine",
  "deadline",
  "prep",
] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
export type PushStage = "prepare" | "start";

export const PUSH_KIND_LABEL: Record<PushKind, string> = {
  wake: "Wake time",
  bedtime: "Bedtime",
  meal: "Meals",
  workout: "Workouts",
  learning: "Learning and study",
  task: "Goal and business tasks",
  appointment: "Appointments and meetings",
  journey: "Journeys",
  call: "Scheduled calls",
  family: "Family commitments",
  routine: "Routines",
  deadline: "Deadlines",
  prep: "Preparation tasks",
};

/** commitments.note written by Coach meal scheduling (coach-tools.server.ts MEAL_NOTE). */
export const MEAL_NOTE_MARK = "Meal from nutrition plan";

/** Which kind of prompt a saved plan entry needs. */
export function pushKindForBlock(b: {
  occurrence_kind?: string | null;
  source_type?: string | null;
  title?: string | null;
}): PushKind {
  const t = String(b.title ?? "");
  switch (b.occurrence_kind) {
    case "wake_for_work":
      return "wake";
    case "workout":
    case "cardio":
    case "mobility":
    case "recovery_action":
      return "workout";
    case "study":
    case "learning":
      return "learning";
    case "meal_prep":
      return /\b(breakfast|lunch|dinner|snack|meal)\b/i.test(t) && !/\bprep\b/i.test(t)
        ? "meal"
        : "prep";
    case "meeting_prep":
    case "appointment_prep":
      return "prep";
    case "meditation":
      return "routine";
    case "work_task":
    case "personal_task":
      return /\bdeadline|due\b/i.test(t) ? "deadline" : "task";
  }
  if (/\bbed ?time|wind down|go to bed\b/i.test(t)) return "bedtime";
  return "task";
}

export function pushKindForCommitment(c: {
  kind?: string | null;
  note?: string | null;
  title?: string | null;
}): PushKind {
  if (c.note && String(c.note).includes(MEAL_NOTE_MARK)) return "meal";
  switch (c.kind) {
    case "appointment":
    case "shift":
      return "appointment";
    case "travel":
      return "journey";
    case "family":
      return "family";
    case "study":
      return "learning";
  }
  if (/\bmeeting|interview|appointment|dentist|doctor\b/i.test(String(c.title ?? "")))
    return "appointment";
  return "routine";
}

/** Smart defaults: which stages each kind gets (prepare = lead-time warning, start = at the time). */
export const STAGES: Record<PushKind, { prepare: boolean; start: boolean }> = {
  wake: { prepare: false, start: true },
  bedtime: { prepare: false, start: true },
  meal: { prepare: false, start: true },
  workout: { prepare: true, start: true },
  learning: { prepare: true, start: true },
  task: { prepare: false, start: true },
  appointment: { prepare: true, start: false },
  journey: { prepare: true, start: false },
  call: { prepare: true, start: false },
  family: { prepare: true, start: false },
  routine: { prepare: false, start: true },
  deadline: { prepare: true, start: false },
  prep: { prepare: false, start: true },
};
/** Appointments and journeys warn earlier than sessions unless the member chose a longer lead. */
export function prepareLeadMin(kind: PushKind, memberLead: number): number {
  const lead = Math.min(Math.max(Math.round(memberLead || 10), 5), 120);
  return kind === "appointment" || kind === "family" || kind === "deadline"
    ? Math.max(lead, 30)
    : lead;
}
/** A start prompt is only useful shortly after the start; later it's stale. */
export const START_WINDOW_MIN = 10;

export function mealLabel(time: string): string {
  const h = Number(time.slice(0, 2));
  if (h < 11) return "Breakfast";
  if (h < 15) return "Lunch";
  if (h < 17) return "Snack";
  return "Dinner";
}

/** Short, specific, item-aware copy. tone "motivating" adds a nudge line; "calm" keeps it plain. */
export function pushCopy(
  kind: PushKind,
  stage: PushStage,
  item: { title: string; time: string; minutes: number },
  tone: "calm" | "motivating" = "calm",
): { title: string; body: string } {
  const name = item.title.replace(/\s+/g, " ").trim().slice(0, 80);
  const m = item.minutes;
  const push = tone === "motivating";
  if (stage === "prepare") {
    switch (kind) {
      case "workout":
        return {
          title: `Training starts in ${m} minutes`,
          body: `${name} at ${item.time}. Your workout is ready.`,
        };
      case "learning":
        return {
          title: `${name} starts at ${item.time}`,
          body: "Your session and resources are ready.",
        };
      case "appointment":
        return { title: `${name} at ${item.time}`, body: `In ${m} minutes. Time to get ready.` };
      case "journey":
        return { title: `Leave in ${m} minutes`, body: `${name} at ${item.time}.` };
      case "call":
        return { title: `Coach call at ${item.time}`, body: `${name}. Keep your phone close.` };
      case "family":
        return { title: `${name} at ${item.time}`, body: `In ${m} minutes.` };
      case "deadline":
        return { title: `Deadline at ${item.time}`, body: `${name}. ${m} minutes left.` };
      default:
        return { title: `${name} at ${item.time}`, body: `Starts in ${m} minutes.` };
    }
  }
  switch (kind) {
    case "wake":
      return {
        title: "Morning. Time to get up.",
        body: push ? "Your day is ready. Let's make it count." : "Your day is ready.",
      };
    case "bedtime":
      return { title: "Time to wind down", body: "Bedtime is now. Tomorrow's plan is set." };
    case "meal": {
      const label = mealLabel(item.time);
      return { title: `${label} time`, body: `${name}. Ready to view or log.` };
    }
    case "workout":
      return {
        title: "Time to train",
        body: push ? `${name} starts now. You've got this.` : `${name} starts now.`,
      };
    case "learning":
      return { title: `${name} starts now`, body: "Your resources are ready." };
    case "task":
      return {
        title: `Next up: ${name}`,
        body: push ? "Your first step is ready. Start now." : "Your first step is ready.",
      };
    case "routine":
      return { title: name, body: "It's time." };
    case "prep":
      return { title: `Time for ${name}`, body: "Everything you need is in the session." };
    default:
      return { title: name, body: `Now, ${item.time}.` };
  }
}

/** The exact screen for the item, never just the home page. */
export function pushLink(
  kind: PushKind,
  ref: { blockId?: string | null; commitmentId?: string | null },
): string {
  if (ref.blockId) return `/app/session/${ref.blockId}`;
  if (ref.commitmentId) return `/app/commitments?item=${encodeURIComponent(ref.commitmentId)}`;
  switch (kind) {
    case "meal":
      return "/app/nutrition";
    case "learning":
      return "/app/learning";
    case "appointment":
    case "family":
    case "journey":
      return "/app/calendar";
    case "call":
      return "/app/settings#calls";
    default:
      return "/app/today";
  }
}

/** Whether a member-muted kind or switch stops this prompt. */
export function kindAllowed(kind: PushKind, muted: readonly string[] | null | undefined): boolean {
  return !(muted ?? []).includes(kind);
}

/** Dispatch-time freshness: a queued prompt goes only if its item is still exactly as planned. */
export function stillValid(
  ref: { at: string },
  current: { starts_at: string; status?: string | null; active?: boolean | null } | null,
  now: Date,
): boolean {
  if (!current) return false;
  if (current.active === false) return false;
  if (
    current.status &&
    !["planned", "scheduled", "upcoming", "due", "snoozed"].includes(current.status)
  )
    return false;
  if (new Date(current.starts_at).getTime() !== new Date(ref.at).getTime()) return false;
  return now.getTime() <= new Date(ref.at).getTime() + 30 * 60000;
}

/** Coach-driven change to the same prompt settings the Settings page edits. */
export function applyPromptChange(
  cur: { push_muted_kinds?: string[] | null; [k: string]: unknown },
  a: Record<string, unknown>,
): { patch: Record<string, unknown>; summary: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};
  const hm = (v: unknown) =>
    typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;
  if (typeof a["enabled"] === "boolean") patch["reminders_enabled"] = a["enabled"];
  if (a["lead_minutes"] != null) {
    const n = Math.round(Number(a["lead_minutes"]));
    if (!(n >= 5 && n <= 120)) return { error: "lead_minutes_must_be_5_to_120" };
    patch["reminder_lead_min"] = n;
  }
  if (typeof a["motivating"] === "boolean") patch["push_motivating"] = a["motivating"];
  if (a["quiet_start"] != null || a["quiet_end"] != null) {
    const s = hm(a["quiet_start"]),
      e = hm(a["quiet_end"]);
    if (a["quiet_start"] != null && !s) return { error: "quiet_start_must_be_HH:MM" };
    if (a["quiet_end"] != null && !e) return { error: "quiet_end_must_be_HH:MM" };
    if (s) patch["quiet_start"] = s;
    if (e) patch["quiet_end"] = e;
  }
  const valid = (x: unknown) =>
    (Array.isArray(x) ? x : [])
      .map(String)
      .filter((k) => (PUSH_KINDS as readonly string[]).includes(k));
  const mute = valid(a["mute"]),
    unmute = valid(a["unmute"]);
  if (mute.length || unmute.length) {
    const set = new Set(cur.push_muted_kinds ?? []);
    for (const k of mute) set.add(k);
    for (const k of unmute) set.delete(k);
    patch["push_muted_kinds"] = [...set];
  }
  if (!Object.keys(patch).length) return { error: "nothing_to_change" };
  return { patch, summary: patch };
}
