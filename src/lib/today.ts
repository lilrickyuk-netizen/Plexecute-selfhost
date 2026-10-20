// Today summary (V3 §12): pure, deterministic answers to the four Today questions.
import { OPEN_STATES } from "./execution";

export type TodayBlock = {
  id: string;
  title: string;
  domain: string;
  status: string;
  starts_at: string;
  duration_min: number;
  is_protected: boolean;
  occurrence_kind?: string | null;
  source_type?: string | null;
};
export type DayStatus = "empty" | "on_track" | "behind" | "complete";

const OPEN = new Set<string>(OPEN_STATES as readonly string[]);
const DONE = new Set(["done", "partial"]);
const CLOSED_NOT_COUNTED = new Set(["rescheduled", "cancelled"]);

export function summariseToday(blocks: TodayBlock[], now = Date.now()) {
  const counted = blocks.filter((b) => !CLOSED_NOT_COUNTED.has(b.status));
  const end = (b: TodayBlock) => new Date(b.starts_at).getTime() + b.duration_min * 60000;
  const completed = counted.filter((b) => DONE.has(b.status));
  const open = counted.filter(
    (b) => OPEN.has(b.status) || b.status === "started" || b.status === "in_progress",
  );
  const overdue = open.filter((b) => end(b) < now || b.status === "expired");
  const missed = counted.filter((b) => b.status === "expired" || b.status === "skipped");
  const next =
    open.filter((b) => end(b) >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ??
    null;
  const minutesPlanned = counted.reduce((s, b) => s + b.duration_min, 0);
  const minutesDone = completed.reduce((s, b) => s + b.duration_min, 0);
  const needsChange = overdue.length + missed.length;
  let status: DayStatus = "on_track";
  if (!counted.length) status = "empty";
  else if (!open.length) status = "complete";
  else if (needsChange > 0) status = "behind";
  const matters = counted.filter((b) => b.is_protected && !DONE.has(b.status));
  return {
    status,
    next,
    completed,
    open,
    overdue,
    missed,
    needsChange,
    matters,
    total: counted.length,
    minutesPlanned,
    minutesDone,
    pct: minutesPlanned ? Math.round((minutesDone / minutesPlanned) * 100) : 0,
  };
}

export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  empty: "Nothing planned",
  on_track: "On track",
  behind: "Needs a change",
  complete: "Day executed",
};

export function blocksFor(blocks: TodayBlock[], domains: string[]) {
  return blocks.filter((b) => domains.includes(b.domain) && !CLOSED_NOT_COUNTED.has(b.status));
}
