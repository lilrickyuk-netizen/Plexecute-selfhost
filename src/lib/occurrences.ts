import { addDaysKey, isoDowOfKey, weekKeyOf, zonedInstant } from "./tz";
// V3 canonical execution occurrence model: every domain's "thing to do at a time" is a plan_blocks row
// with an occurrence kind and a source. Pure helpers, shared by server and UI.
export const OCCURRENCE_KINDS = [
  "wake_for_work",
  "meeting_prep",
  "study",
  "workout",
  "cardio",
  "mobility",
  "meal_prep",
  "meditation",
  "appointment_prep",
  "personal_task",
  "recovery_action",
  "work_task",
  "learning",
  "other",
] as const;
export type OccurrenceKind = (typeof OCCURRENCE_KINDS)[number];
export type OccurrenceSource = "goal" | "commitment" | "routine" | "recovery" | "makeup" | "manual";

/** Proposal and approval must agree on which occurrences a bulk replan can replace. */
export function isReplanReplaceable(
  b: {
    status: string;
    source_type: string;
    is_protected: boolean;
    starts_at: string;
  },
  now: string,
): boolean {
  return (
    !b.is_protected &&
    b.starts_at >= now &&
    ["planned", "scheduled", "upcoming", "due", "contacting", "acknowledged", "snoozed"].includes(
      b.status,
    ) &&
    ["goal", "makeup", "recovery", "manual"].includes(b.source_type)
  );
}

export const KIND_LABELS: Record<OccurrenceKind, string> = {
  wake_for_work: "Wake for work",
  meeting_prep: "Meeting prep",
  study: "Study",
  workout: "Workout",
  cardio: "Cardio",
  mobility: "Mobility",
  meal_prep: "Meal prep",
  meditation: "Meditation",
  appointment_prep: "Appointment prep",
  personal_task: "Personal task",
  recovery_action: "Recovery action",
  work_task: "Work task",
  learning: "Learning",
  other: "Other",
};

export function kindForDomain(domain: string, title = ""): OccurrenceKind {
  if (/easy walk|gentle mobility|recovery/i.test(title)) return "recovery_action";
  switch (domain) {
    case "training":
      return "workout";
    case "cardio":
      return "cardio";
    case "mobility":
      return "mobility";
    case "wellness":
      return "meditation";
    case "learning":
      return "learning";
    case "career":
      return "work_task";
    case "work_prep":
      return "meeting_prep";
    case "meal_prep":
    case "nutrition":
      return "meal_prep";
    case "sleep":
      return "recovery_action";
    case "admin":
      return "personal_task";
    default:
      return "other";
  }
}

export function sourceForBlock(b: {
  goal_id?: string | null;
  note?: string | null | undefined;
  title?: string;
}): OccurrenceSource {
  if (b.note?.startsWith("makeup:")) return "makeup";
  if (/\(easier\)|easy walk|gentle mobility/i.test(b.title ?? "")) return "recovery";
  return b.goal_id ? "goal" : "manual";
}

type Commit = {
  id: string;
  title: string;
  kind: string;
  recurrence: string;
  days: number[];
  on_date: string | null;
  start_time: string;
  active: boolean;
};
type Profile = { wake_time: string; work_start: string | null; work_days: number[] };
export type RoutineOccurrence = {
  title: string;
  domain: string;
  occurrence_kind: OccurrenceKind;
  source_type: "commitment" | "routine";
  source_ref: string;
  commitment_id: string | null;
  starts_at: string;
  duration_min: number;
};

const PREP_MIN = 15;
function at(dayKey: string, hhmm: string, minus: number, tz?: string | null) {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedInstant(dayKey, (h ?? 0) * 60 + (m ?? 0) - minus, tz);
}

/** Deterministic routine and preparation occurrences for a week: wake-for-work on work days, prep before meetings and appointments. */
export function routineOccurrences(
  profile: Profile,
  commitments: Commit[],
  weekStart: Date,
  now: Date,
  tz?: string | null,
): RoutineOccurrence[] {
  const wk = weekKeyOf(weekStart, tz);
  const out: RoutineOccurrence[] = [];
  for (let i = 0; i < 7; i++) {
    const dk = addDaysKey(wk, i);
    const dow = isoDowOfKey(dk);
    if (profile.work_start && profile.work_days.includes(dow)) {
      out.push({
        title: "Wake for work",
        domain: "admin",
        occurrence_kind: "wake_for_work",
        source_type: "routine",
        source_ref: `wake:${dk}`,
        commitment_id: null,
        starts_at: at(dk, profile.wake_time, 0, tz).toISOString(),
        duration_min: 10,
      });
    }
    for (const c of commitments) {
      if (!c.active || !["meeting", "appointment"].includes(c.kind)) continue;
      if (c.recurrence === "weekly" ? !c.days.includes(dow) : c.on_date !== dk) continue;
      const meeting = c.kind === "meeting";
      out.push({
        title: `${meeting ? "Prepare for" : "Get ready for"} ${c.title}`,
        domain: meeting ? "work_prep" : "admin",
        occurrence_kind: meeting ? "meeting_prep" : "appointment_prep",
        source_type: "commitment",
        source_ref: `prep:${c.id}:${dk}`,
        commitment_id: c.id,
        starts_at: at(dk, c.start_time, PREP_MIN, tz).toISOString(),
        duration_min: 10,
      });
    }
  }
  return out.filter((o) => o.starts_at >= now.toISOString());
}
