// Journey Planning — pure logic shared by server and UI. Google Maps Platform is the only
// route provider in this version; the JourneyProvider type leaves room for future providers
// (rail/flight) without rewriting the system.

export const JOURNEY_MODES = ["drive", "transit", "walk"] as const;
export type JourneyMode = (typeof JOURNEY_MODES)[number];

export const MODE_LABELS: Record<JourneyMode, string> = {
  drive: "Car",
  transit: "Public transport",
  walk: "Walking",
};

export const JOURNEY_STATUSES = [
  "planned",
  "monitoring",
  "leave_soon",
  "in_progress",
  "completed",
  "cancelled",
  "needs_attention",
] as const;
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number];

export const STATUS_LABELS: Record<JourneyStatus, string> = {
  planned: "Planned",
  monitoring: "Monitoring",
  leave_soon: "Leave soon",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  needs_attention: "Needs attention",
};

export const DEFAULT_BUFFER_MIN = 10;
export const BUFFER_CHOICES = [0, 5, 10, 15, 20, 30] as const;

export function clampBuffer(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : DEFAULT_BUFFER_MIN;
  return Math.min(120, Math.max(0, v));
}

export function normMode(m: unknown): JourneyMode {
  return m === "transit" || m === "walk" ? m : "drive";
}

/** When to leave to arrive by `arriveBy`, given travel time and the member's buffer. */
export function leaveTime(arriveBy: Date, durationMin: number, bufferMin: number): Date {
  return new Date(arriveBy.getTime() - (durationMin + bufferMin) * 60000);
}

export function journeyTitle(
  destLabel: string | null,
  destAddress: string,
  mode: JourneyMode,
): string {
  const where = destLabel || shortPlace(destAddress);
  return `Travel to ${where} (${MODE_LABELS[mode].toLowerCase()})`;
}

/** First part of an address — enough for display without exposing a full saved address. */
export function shortPlace(address: string): string {
  const first = address.split(",")[0]?.trim();
  return first && first.length <= 40 ? first : address.slice(0, 40);
}

/** Recheck cadence: only journeys with an upcoming departure, and not too often (cost control). */
export function dueForRecheck(
  j: { leave_at: string; status: string; last_checked_at: string | null },
  now: Date,
): boolean {
  if (j.status !== "planned" && j.status !== "monitoring" && j.status !== "leave_soon")
    return false;
  const leave = new Date(j.leave_at).getTime();
  if (leave < now.getTime() - 30 * 60000 || leave > now.getTime() + 24 * 3600000) return false;
  if (!j.last_checked_at) return true;
  const sinceMin = (now.getTime() - new Date(j.last_checked_at).getTime()) / 60000;
  const hoursOut = (leave - now.getTime()) / 3600000;
  // Close to departure: check every 15 min; further out: hourly at most.
  return hoursOut <= 2 ? sinceMin >= 15 : sinceMin >= 60;
}

/** Honest copy when Google cannot provide reliable data — never invent a travel time. */
export const ROUTE_FAILURE_MESSAGE =
  "I couldn't get a reliable travel time from Google Maps just now, so I haven't guessed one. Try again in a moment, or check the address.";
