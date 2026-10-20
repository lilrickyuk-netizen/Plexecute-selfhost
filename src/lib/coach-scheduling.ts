// Deterministic resolution of what the Coach extracted from a request ("tomorrow", "Friday", "14:00",
// "30 minutes before") into local dates, times and stable dedupe keys. No AI decides times.
import { addDaysKey, isoDowOfKey } from "./tz";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** Local day key for an expression relative to todayKey. Weekdays mean the next one after today. */
export function resolveDay(expr: string, todayKey: string): string | null {
  const e = expr.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^\d{4}-\d{2}-\d{2}$/.test(e)) return e;
  if (e === "today" || e === "tonight") return todayKey;
  if (e === "tomorrow") return addDaysKey(todayKey, 1);
  if (e === "day after tomorrow" || e === "the day after tomorrow") return addDaysKey(todayKey, 2);
  const m = /^(?:(next|this|on|coming|this coming) )?([a-z]+)$/.exec(e);
  if (!m) return null;
  const idx = DAYS.findIndex((d) => d === m[2] || d.slice(0, 3) === m[2]);
  if (idx < 0) return null;
  const target = idx + 1;
  const dow = isoDowOfKey(todayKey);
  let diff = (target - dow + 7) % 7;
  if (diff === 0) diff = 7;
  return addDaysKey(todayKey, diff);
}

/** Minutes after local midnight from "14:00", "2pm", "2:30 pm", "12", "noon". */
export function parseTime(t: string): number | null {
  const s = t.trim().toLowerCase();
  if (s === "noon" || s === "midday") return 720;
  if (s === "midnight") return 0;
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (mi > 59 || h > 23) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3] === "pm" && h !== 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
  }
  return h * 60 + mi;
}

export const hm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Call minute relative to the appointment day (may be negative = previous day). */
export function callMinute(
  startMin: number,
  call: { lead_minutes?: number | null; call_time?: string | null },
): number | null {
  if (call.call_time) return parseTime(call.call_time);
  if (call.lead_minutes != null && Number.isFinite(call.lead_minutes)) {
    const lead = Math.round(call.lead_minutes);
    if (lead < 0 || lead > 24 * 60) return null;
    return startMin - lead;
  }
  return null;
}

export function normTitle(t: string) {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
export const commitmentKey = (title: string, day: string, startMin: number) =>
  `coach:${day}:${hm(startMin)}:${normTitle(title)}`;
export const callKey = (commitKey: string, callAtIso: string) => `${commitKey}:call:${callAtIso}`;

/** "Call me in 2 minutes", "ring me at 9:30 before my appointment": a call/reminder, not a plan rebuild. */
export function isCallOrReminderOnly(text: string | null | undefined) {
  const t = String(text ?? "").toLowerCase();
  if (!/\b(call|ring|phone|remind)\s+me\b/.test(t)) return false;
  return !/\b(plan|rebuild|replan|re-?plan|reschedul\w*|week|sessions?|goals?|programme|program|routine|clear)\b/.test(
    t,
  );
}

/**
 * The same one-off request repeated within a short time ("I asked you to call me in 2 minutes")
 * must reuse the commitment already saved, not ring the member a second time.
 */
export function isRepeatOfRecentRequest(
  existing: { title: string; start_time: string; created_at: string },
  title: string,
  startMin: number,
  nowMs: number,
  memberText?: string | null,
) {
  if (/\b(again|another|second|one more)\b/i.test(memberText ?? "")) return false;
  if (normTitle(existing.title) !== normTitle(title)) return false;
  const ex = parseTime(existing.start_time.slice(0, 5));
  if (ex == null || Math.abs(ex - startMin) > 30) return false;
  return nowMs - new Date(existing.created_at).getTime() <= 3 * 3600 * 1000;
}

export const COMMITMENT_KINDS = [
  "meeting",
  "appointment",
  "shift",
  "family",
  "study",
  "travel",
  "other",
] as const;
export function kindFor(k: string): (typeof COMMITMENT_KINDS)[number] {
  const v = k.toLowerCase();
  if ((COMMITMENT_KINDS as readonly string[]).includes(v)) return v as never;
  if (/exam|test|class|lecture/.test(v)) return "study";
  if (/doctor|dentist|gp|hospital|clinic|appoint/.test(v)) return "appointment";
  if (/deadline|reminder/.test(v)) return "other";
  return "other";
}

/** Deterministic day rebuild: keep sessions that fit, else move each to the earliest free 15-minute slot
 *  between from and until that clears busy ranges and already placed sessions; null when nothing fits. */
export function rebuildDaySlots(
  sessions: { id: string; start: number; duration: number }[],
  busy: [number, number][],
  from: number,
  until: number,
): { id: string; start: number | null; moved: boolean }[] {
  const taken: [number, number][] = [...busy];
  const free = (s: number, d: number) =>
    s >= from && s + d <= until && !taken.some(([a, b]) => s < b && s + d > a);
  const out: { id: string; start: number | null; moved: boolean }[] = [];
  for (const x of [...sessions].sort((p, q) => p.start - q.start)) {
    let start: number | null = free(x.start, x.duration) ? x.start : null;
    if (start == null)
      for (let s = Math.ceil(from / 15) * 15; s + x.duration <= until; s += 15)
        if (free(s, x.duration)) {
          start = s;
          break;
        }
    if (start != null) taken.push([start, start + x.duration]);
    out.push({ id: x.id, start, moved: start != null && start !== x.start });
  }
  return out;
}
