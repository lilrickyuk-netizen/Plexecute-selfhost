// Conversational onboarding: the AI only structures what the member said into this draft.
// Everything here is deterministic: which follow-up questions are genuinely needed, defaults
// the member explicitly accepts, and the mapping into the planner's own inputs.
import type { ScheduleCommitment, ScheduleGoal } from "./scheduler";

export const COMMIT_KINDS = [
  "shift",
  "meeting",
  "appointment",
  "family",
  "study",
  "travel",
  "other",
] as const;
export const GOAL_DOMAINS = [
  "training",
  "cardio",
  "mobility",
  "nutrition",
  "sleep",
  "learning",
  "career",
  "wellness",
  "work_prep",
  "meal_prep",
  "admin",
  "other",
] as const;
export const FITNESS = new Set(["training", "cardio", "mobility"]);
const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type IntakeCommitment = {
  title: string;
  kind: (typeof COMMIT_KINDS)[number];
  days: number[]; // ISO 1..7 for weekly; empty when on_date is set
  on_date: string | null;
  start_time: string | null;
  end_time: string | null;
  protected: boolean; // family / personal time the member wants kept free
};
export type IntakeGoal = {
  title: string;
  domain: (typeof GOAL_DOMAINS)[number];
  sessions_per_week: number | null;
  session_minutes: number | null;
  preferred_time: "morning" | "midday" | "evening" | "any";
  deadline: string | null;
  why: string | null;
};
export const VISION_AREAS = [
  "career",
  "business",
  "money",
  "home",
  "family",
  "relationships",
  "health",
  "fitness",
  "education",
  "lifestyle",
  "travel",
  "location",
  "personal_growth",
  "hobbies",
  "contribution",
  "retirement",
  "other",
] as const;
export type VisionObjective = { area: (typeof VISION_AREAS)[number]; text: string };
export const VISION_QUESTION = "Where would you like your life to be in 5 years?";
export const VISION_HELP =
  "Tell Plexecute anything that matters to you, such as your career, money, family, health, where you live, what you want to achieve, or the kind of person you want to become.";
/** Ask the 5-year question only when the member hasn't already described (or declined) it. */
export const needsVisionQuestion = (d: IntakeDraft) => !d.vision.answered;

export type IntakeDraft = {
  wake_time: string | null;
  sleep_time: string | null;
  work: { days: number[]; start: string | null; end: string | null } | null;
  commitments: IntakeCommitment[];
  goals: IntakeGoal[];
  health_notes: string | null; // "none" when the member said there is nothing to account for
  nutrition_goal: "lose" | "maintain" | "gain" | null;
  priorities: string | null;
  energy: string | null;
  blocker: string | null;
  learning_goal: string | null;
  professional_goal: string | null;
  other_notes: string | null;
  /** 5-year life direction: long-term objectives, never active goals. answered=true also covers "I don't know". */
  vision: {
    answered: boolean;
    summary: string | null;
    objectives: VisionObjective[];
    _confirmed?: boolean;
  };
  assumed: string[]; // defaults the member accepted instead of answering
};

export const EMPTY_DRAFT: IntakeDraft = {
  wake_time: null,
  sleep_time: null,
  work: null,
  commitments: [],
  goals: [],
  health_notes: null,
  nutrition_goal: null,
  priorities: null,
  energy: null,
  blocker: null,
  learning_goal: null,
  professional_goal: null,
  other_notes: null,
  vision: { answered: false, summary: null, objectives: [] },
  assumed: [],
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const t = (v: unknown) => (typeof v === "string" && HHMM.test(v) ? v : null);
const s = (v: unknown, n = 300) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;
const days = (v: unknown) =>
  [...new Set((Array.isArray(v) ? v : []).map(Number).filter((d) => d >= 1 && d <= 7))].sort();
const int = (v: unknown, lo: number, hi: number) => {
  const n = Math.round(Number(v));
  return v == null || !Number.isFinite(n) ? null : Math.min(hi, Math.max(lo, n));
};
const pick = <T extends string>(v: unknown, opts: readonly T[], d: T) =>
  opts.includes(v as T) ? (v as T) : d;

/** Clamp whatever the model returned into a valid draft; invalid values become "unknown", never guesses. */
export function normaliseDraft(raw: unknown): IntakeDraft {
  const r = (raw ?? {}) as Record<string, unknown>;
  const w = r["work"] as Record<string, unknown> | null | undefined;
  const wd = w ? days(w["days"]) : [];
  return {
    wake_time: t(r["wake_time"]),
    sleep_time: t(r["sleep_time"]),
    work: w && wd.length ? { days: wd, start: t(w["start"]), end: t(w["end"]) } : null,
    commitments: (Array.isArray(r["commitments"]) ? r["commitments"] : [])
      .map((c: Record<string, unknown>) => ({
        title: s(c["title"], 120) ?? "",
        kind: pick(c["kind"], COMMIT_KINDS, "other"),
        days: days(c["days"]),
        on_date:
          typeof c["on_date"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c["on_date"])
            ? c["on_date"]
            : null,
        start_time: t(c["start_time"]),
        end_time: t(c["end_time"]),
        protected: c["protected"] === true,
      }))
      .filter((c) => c.title && (c.days.length || c.on_date))
      .slice(0, 20),
    goals: (Array.isArray(r["goals"]) ? r["goals"] : [])
      .map((g: Record<string, unknown>) => ({
        title: s(g["title"], 120) ?? "",
        domain: pick(g["domain"], GOAL_DOMAINS, "other"),
        sessions_per_week: int(g["sessions_per_week"], 1, 14),
        session_minutes: int(g["session_minutes"], 10, 240),
        preferred_time: pick(
          g["preferred_time"],
          ["morning", "midday", "evening", "any"] as const,
          "any",
        ),
        deadline:
          typeof g["deadline"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(g["deadline"])
            ? g["deadline"]
            : null,
        why: s(g["why"]),
      }))
      .filter((g) => g.title)
      .slice(0, 10),
    health_notes: s(r["health_notes"]),
    nutrition_goal:
      (["lose", "maintain", "gain"] as const).find((x) => x === r["nutrition_goal"]) ?? null,
    priorities: s(r["priorities"]),
    energy: s(r["energy"]),
    blocker: s(r["blocker"]),
    learning_goal: s(r["learning_goal"]),
    professional_goal: s(r["professional_goal"]),
    other_notes: s(r["other_notes"], 1000),
    vision: normaliseVision(r["vision"]),
    assumed: Array.isArray(r["assumed"])
      ? (r["assumed"] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 20)
      : [],
  };
}

export const dayList = (d: number[]) =>
  d.length === 5 && d.join() === "1,2,3,4,5"
    ? "Monday to Friday"
    : d.map((x) => DAY[x - 1]).join(", ");
const when = (c: IntakeCommitment) => (c.on_date ? c.on_date : dayList(c.days));

/** Protected family/personal time stated as a whole day ("Saturday with my kids") needs no clock times. */
export const allDay = (c: IntakeCommitment) => c.protected && !c.start_time && !c.end_time;

export type Question = { key: string; text: string };

/** Only what the planner genuinely needs and cannot infer. Never asks about anything already stated. */
export function missingQuestions(d: IntakeDraft): Question[] {
  const q: Question[] = [];
  if (!d.goals.length)
    q.push({
      key: "goals",
      text: "What's the first thing you'd like Plexecute to help you work towards?",
    });
  if (!d.wake_time || !d.sleep_time)
    q.push({ key: "sleep", text: "Roughly what time do you usually get up and go to bed?" });
  if (d.work && (!d.work.start || !d.work.end))
    q.push({
      key: "work",
      text: `What time do you start and finish work on ${dayList(d.work.days)}?`,
    });
  for (const c of d.commitments) {
    if (allDay(c)) continue;
    if (!c.start_time)
      q.push({
        key: `c:${c.title}`,
        text: `What time is ${c.title} on ${when(c)}, and when does it finish?`,
      });
    else if (!c.end_time)
      q.push({ key: `c:${c.title}`, text: `What time does ${c.title} finish?` });
  }
  for (const g of d.goals.filter((g) => FITNESS.has(g.domain))) {
    if (!g.sessions_per_week)
      q.push({
        key: `g:${g.title}`,
        text: `How many times a week do you want to do "${g.title}"?`,
      });
    else if (!g.session_minutes)
      q.push({ key: `g:${g.title}`, text: `How long is each "${g.title}" session usually?` });
  }
  const physical =
    d.goals.some((g) => FITNESS.has(g.domain) || g.domain === "nutrition") ||
    d.nutrition_goal === "lose" ||
    d.nutrition_goal === "gain";
  if (physical && !d.health_notes)
    q.push({
      key: "health",
      text: 'Is there any injury, medical condition or dietary restriction Plexecute needs to account for? ("None" is fine.)',
    });
  return q.slice(0, 4);
}

/** Member chose "use sensible defaults" for the remaining questions: fill them and record each assumption. */
export function applyDefaults(d: IntakeDraft): IntakeDraft {
  const out: IntakeDraft = structuredClone(d);
  const a = new Set(out.assumed);
  if (!out.wake_time) {
    out.wake_time = "07:00";
    a.add("Wake time 07:00");
  }
  if (!out.sleep_time) {
    out.sleep_time = "23:00";
    a.add("Bedtime 23:00");
  }
  if (out.work && !out.work.start) {
    out.work.start = "09:00";
    a.add("Work starts 09:00");
  }
  if (out.work && !out.work.end) {
    out.work.end = "17:30";
    a.add("Work ends 17:30");
  }
  out.commitments = out.commitments.filter((c) => {
    if (allDay(c)) return true;
    if (!c.start_time) {
      a.add(`${c.title} left out (no time given)`);
      return false;
    }
    if (!c.end_time) {
      const [h, m] = c.start_time.split(":").map(Number) as [number, number];
      c.end_time = `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      a.add(`${c.title} lasts 1 hour`);
    }
    return true;
  });
  for (const g of out.goals) {
    if (!g.sessions_per_week) {
      g.sessions_per_week = 3;
      a.add(`${g.title}: 3 times a week`);
    }
    if (!g.session_minutes) {
      g.session_minutes = FITNESS.has(g.domain) ? 45 : 30;
      a.add(`${g.title}: ${g.session_minutes} min sessions`);
    }
  }
  if (!out.health_notes && missingQuestions(d).some((x) => x.key === "health")) {
    out.health_notes = "None stated";
    a.add("No injuries or restrictions stated");
  }
  if (!out.goals.length) a.add("No goal yet");
  out.assumed = [...a];
  return out;
}

/** Non-fitness goals without a stated rhythm get a light, visible, editable suggestion. */
export function goalsForPlan(d: IntakeDraft): (ScheduleGoal & { why: string })[] {
  return d.goals.slice(0, 3).map((g, i) => {
    const sessions = g.sessions_per_week ?? 3;
    const mins = g.session_minutes ?? (FITNESS.has(g.domain) ? 45 : 30);
    return {
      id: String(i),
      title: g.title,
      domain: g.domain,
      weekly_minutes: sessions * mins,
      session_minutes: mins,
      preferred_time: g.preferred_time,
      deadline: g.deadline,
      why: g.why ?? "",
    };
  });
}

export function commitmentsForPlan(
  d: IntakeDraft,
): (ScheduleCommitment & { title: string; kind: string })[] {
  return d.commitments
    .map((c) =>
      allDay(c)
        ? { ...c, start_time: d.wake_time ?? "07:00", end_time: d.sleep_time ?? "23:00" }
        : c,
    )
    .filter((c) => c.start_time && c.end_time && c.end_time > c.start_time)
    .map((c) => ({
      title: c.title,
      kind: c.protected && c.kind === "other" ? "family" : c.kind,
      recurrence: c.on_date ? "once" : "weekly",
      days: c.on_date ? [] : c.days,
      on_date: c.on_date,
      start_time: c.start_time!,
      end_time: c.end_time!,
    }));
}

/** "Here's what I understood" lines, in plain language. */
export function summaryLines(d: IntakeDraft): { label: string; value: string }[] {
  const L: { label: string; value: string }[] = [];
  if (d.work)
    L.push({
      label: "Work",
      value: `${dayList(d.work.days)}, ${d.work.start ?? "?"}–${d.work.end ?? "?"}`,
    });
  for (const c of d.commitments)
    L.push({
      label: c.protected ? "Protected time" : c.kind === "study" ? "Study" : "Commitment",
      value: `${c.title}: ${when(c)}${c.start_time ? `, ${c.start_time}${c.end_time ? `–${c.end_time}` : ""}` : ""}`,
    });
  for (const g of d.goals)
    L.push({
      label: "Goal",
      value: `${g.title}${g.sessions_per_week ? ` · ${g.sessions_per_week}×/week` : ""}${g.session_minutes ? ` · ${g.session_minutes} min` : ""}${g.deadline ? ` · by ${g.deadline}` : ""}`,
    });
  if (d.wake_time || d.sleep_time)
    L.push({ label: "Sleep", value: `about ${d.sleep_time ?? "?"}–${d.wake_time ?? "?"}` });
  if (d.health_notes) L.push({ label: "Health", value: d.health_notes });
  if (d.nutrition_goal)
    L.push({
      label: "Body goal",
      value: { lose: "Lose fat", maintain: "Maintain", gain: "Gain muscle" }[d.nutrition_goal],
    });
  if (d.priorities) L.push({ label: "Matters most", value: d.priorities });
  return L;
}

export function normaliseVision(v: unknown): IntakeDraft["vision"] {
  const o = (v ?? {}) as Record<string, unknown>;
  const objectives = (Array.isArray(o["objectives"]) ? o["objectives"] : [])
    .map((x: Record<string, unknown>) => ({
      area: pick(x?.["area"], VISION_AREAS, "other"),
      text: s(x?.["text"], 200) ?? "",
    }))
    .filter((x) => x.text)
    .slice(0, 12);
  const summary = s(o["summary"], 600);
  // Only a real description (or the member's own reply to the question, set by the screen) counts as answered.
  // Answered only when real objectives exist, or the screen recorded the member's reply/skip (_confirmed).
  return {
    answered: objectives.length > 0 || o["_confirmed"] === true,
    summary: objectives.length || o["_confirmed"] ? summary : null,
    objectives,
  };
}
