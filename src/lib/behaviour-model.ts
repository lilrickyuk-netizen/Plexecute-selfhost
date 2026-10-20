/**
 * Personal Behaviour Model (V3 §42). Pure, deterministic.
 * A generalised pattern is only shown with n >= 5 comparable occurrences in EACH compared group
 * and at least 14 calendar days of data; simple counts are always shown with their sample and window.
 * Comparisons are worded as associations, never causes. No sensitive attributes are used.
 */
import { localDayKey, zonedParts, diffDaysKey } from "./tz";

export const BEHAVIOUR_MODEL_VERSION = "behaviour_model_v1";
export const PATTERN_MIN_N = 5;
export const PATTERN_MIN_DAYS = 14;
/** Look-back window the server loads. Own choice: the spec sets minimums, not a maximum. */
export const MODEL_WINDOW_DAYS = 90;

const TERMINAL = new Set(["done", "partial", "skipped", "blocked", "expired"]);
const DOW = [
  "",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
  "Sundays",
];

export type ModelBlock = {
  id: string;
  domain: string;
  starts_at: string;
  duration_min: number;
  status: string;
};
export type ModelEvent = { block_id: string; to_status: string };
export type ModelInput = {
  tz: string;
  now: Date;
  blocks: ModelBlock[];
  events: ModelEvent[];
  checkins: { check_date: string; readiness: number }[];
  notifications: { created_at: string; read_at: string | null }[];
  calls: { created_at: string; outcome: string | null; status: string }[];
  foodDays: string[];
};

export type Observation = {
  key: string;
  title: string;
  kind: "count" | "pattern";
  text: string;
  sample: number;
  days: number;
  /** false when a pattern hasn't met the minimum evidence yet */
  enough: boolean;
};

type Group = { label: string; done: number; n: number };
const pct = (d: number, n: number) => Math.round((d / n) * 100);

function span(keys: string[]): number {
  if (!keys.length) return 0;
  const s = [...keys].sort();
  return diffDaysKey(s[s.length - 1]!, s[0]!) + 1;
}

/** Compare completion between groups; only states a pattern when every compared group meets the minimum. */
function compare(
  key: string,
  title: string,
  groups: Group[],
  days: number,
  unit: string,
): Observation {
  const valid = groups.filter((g) => g.n >= PATTERN_MIN_N);
  const sample = groups.reduce((a, g) => a + g.n, 0);
  const enough = valid.length >= 2 && days >= PATTERN_MIN_DAYS;
  if (!enough) {
    return {
      key,
      title,
      kind: "pattern",
      sample,
      days,
      enough: false,
      text: `Not enough evidence yet. A pattern needs at least ${PATTERN_MIN_N} ${unit} in each group to compare and ${PATTERN_MIN_DAYS} days of history.`,
    };
  }
  const ranked = [...valid].sort((a, b) => b.done / b.n - a.done / a.n);
  const hi = ranked[0]!,
    lo = ranked[ranked.length - 1]!;
  const text =
    hi.done / hi.n === lo.done / lo.n
      ? `No difference seen: ${valid.map((g) => `${g.label} ${pct(g.done, g.n)}% (${g.done} of ${g.n})`).join(", ")}.`
      : `${hi.label} were associated with higher completion (${pct(hi.done, hi.n)}%, ${hi.done} of ${hi.n}) than ${lo.label} (${pct(lo.done, lo.n)}%, ${lo.done} of ${lo.n}). This is an association, not proof of cause.`;
  return { key, title, kind: "pattern", sample, days, enough: true, text };
}

function groupBy(blocks: ModelBlock[], label: (b: ModelBlock) => string | null): Group[] {
  const m = new Map<string, Group>();
  for (const b of blocks) {
    const l = label(b);
    if (!l) continue;
    const g = m.get(l) ?? { label: l, done: 0, n: 0 };
    g.n++;
    if (b.status === "done") g.done++;
    m.set(l, g);
  }
  return [...m.values()];
}

/** Time-of-day bands. Own choice: the spec names "time" but no bands. */
export function band(iso: string, tz: string): string {
  const h = zonedParts(iso, tz).h;
  return h < 12 ? "Morning sessions" : h < 17 ? "Afternoon sessions" : "Evening sessions";
}

export function buildBehaviourModel(i: ModelInput): Observation[] {
  const nowKey = localDayKey(i.now, i.tz);
  const past = i.blocks.filter((b) => TERMINAL.has(b.status) && new Date(b.starts_at) < i.now);
  const days = span(past.map((b) => localDayKey(b.starts_at, i.tz)));
  const out: Observation[] = [];

  out.push(
    compare(
      "completion_time",
      "Completion by time of day",
      groupBy(past, (b) => band(b.starts_at, i.tz)),
      days,
      "sessions",
    ),
  );
  out.push(
    compare(
      "completion_day",
      "Completion by day of week",
      groupBy(past, (b) => DOW[zonedParts(b.starts_at, i.tz).isoDow] ?? null),
      days,
      "sessions",
    ),
  );
  out.push(
    compare(
      "completion_type",
      "Completion by type of task",
      groupBy(past, (b) =>
        `${b.domain.replace(/_/g, " ")} sessions`.replace(/^./, (c) => c.toUpperCase()),
      ),
      days,
      "sessions",
    ),
  );

  // Simple counts (always shown with sample and window).
  const ids = new Set(i.blocks.map((b) => b.id));
  const ev = i.events.filter((e) => ids.has(e.block_id));
  const snoozes = ev.filter((e) => e.to_status === "snoozed").length;
  const moves = ev.filter((e) => e.to_status === "rescheduled").length;
  const n = i.blocks.length;
  out.push({
    key: "snooze",
    title: "Snoozes",
    kind: "count",
    sample: n,
    days: MODEL_WINDOW_DAYS,
    enough: true,
    text: n
      ? `${snoozes} snooze${snoozes === 1 ? "" : "s"} across ${n} sessions (average ${(snoozes / n).toFixed(1)} per session).`
      : "No sessions yet.",
  });
  out.push({
    key: "moves",
    title: "Schedule moves",
    kind: "count",
    sample: n,
    days: MODEL_WINDOW_DAYS,
    enough: true,
    text: n
      ? `${moves} session${moves === 1 ? " was" : "s were"} moved to a new time out of ${n}.`
      : "No sessions yet.",
  });

  const study = past.filter((b) => b.domain === "learning");
  out.push(
    compare(
      "study_duration",
      "Study length and completion",
      groupBy(study, (b) =>
        b.duration_min <= 30 ? "Study sessions of 30 min or less" : "Study sessions over 30 min",
      ),
      span(study.map((b) => localDayKey(b.starts_at, i.tz))),
      "study sessions",
    ),
  );

  const training = past.filter((b) => b.domain === "training" || b.domain === "fitness");
  out.push(
    compare(
      "training_time",
      "Training time and adherence",
      groupBy(training, (b) => `Training: ${band(b.starts_at, i.tz).toLowerCase()}`),
      span(training.map((b) => localDayKey(b.starts_at, i.tz))),
      "training sessions",
    ),
  );

  // Recovery association: split each check-in day at the user's own median readiness.
  const ready = [...i.checkins].map((c) => c.readiness).sort((a, b) => a - b);
  const median = ready.length ? ready[Math.floor(ready.length / 2)]! : 0;
  const byDay = new Map(i.checkins.map((c) => [c.check_date, c.readiness]));
  const recBlocks = past.filter((b) => byDay.has(localDayKey(b.starts_at, i.tz)));
  out.push(
    compare(
      "recovery",
      "Recovery and getting things done",
      groupBy(recBlocks, (b) =>
        byDay.get(localDayKey(b.starts_at, i.tz))! >= median
          ? "Sessions on your better-recovery days"
          : "Sessions on your lower-recovery days",
      ),
      span(recBlocks.map((b) => localDayKey(b.starts_at, i.tz))),
      "sessions",
    ),
  );

  const read = i.notifications.filter((x) => x.read_at).length;
  out.push({
    key: "notifications",
    title: "Reminder response",
    kind: "count",
    sample: i.notifications.length,
    days: MODEL_WINDOW_DAYS,
    enough: true,
    text: i.notifications.length
      ? `You opened ${read} of ${i.notifications.length} reminders.`
      : "No reminders sent yet.",
  });
  const answered = i.calls.filter(
    (c) => c.outcome === "confirmed_done" || c.outcome === "not_yet",
  ).length;
  out.push({
    key: "calls",
    title: "Call response",
    kind: "count",
    sample: i.calls.length,
    days: MODEL_WINDOW_DAYS,
    enough: true,
    text: i.calls.length
      ? `You responded to ${answered} of ${i.calls.length} accountability calls.`
      : "No accountability calls yet.",
  });

  const firstKey = [...i.foodDays].sort()[0];
  const foodSpan = firstKey ? diffDaysKey(nowKey, firstKey) + 1 : 0;
  const logged = new Set(i.foodDays).size;
  out.push({
    key: "food",
    title: "Food logging",
    kind: "count",
    sample: logged,
    days: foodSpan,
    enough: true,
    text: logged
      ? `You logged food on ${logged} of the last ${foodSpan} days.`
      : "No food logged yet.",
  });
  return out;
}
