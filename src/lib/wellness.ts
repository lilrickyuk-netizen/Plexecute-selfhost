import { detectSignals } from "./safety";
// Deterministic Wellness/Meditation engine (V3 §19A, §50A). Non-clinical content only.
export const WELLNESS_RULE_VERSION = "wellness_adapt_v1";

export type SessionType =
  | "mindfulness"
  | "breath"
  | "body_scan"
  | "relaxation"
  | "focus"
  | "wind_down"
  | "gratitude"
  | "timer";
export type Experience = "beginner" | "some" | "experienced";

export const SESSION_TYPES: Record<SessionType, { label: string; blurb: string }> = {
  mindfulness: { label: "Mindfulness", blurb: "Rest attention on the present moment." },
  breath: { label: "Gentle breathing", blurb: "Slow, comfortable breathing. No breath holds." },
  body_scan: { label: "Body scan", blurb: "Move attention slowly through the body." },
  relaxation: { label: "Guided relaxation", blurb: "Release tension, muscle group by group." },
  focus: { label: "Focus / preparation", blurb: "Settle before work, study or a meeting." },
  wind_down: { label: "Evening wind-down", blurb: "Ease out of the day before sleep." },
  gratitude: { label: "Gratitude / reflection", blurb: "Notice what went well today." },
  timer: { label: "Unguided timer", blurb: "Just a timer with a soft start and end." },
};

// Each script step has a share of the total time (weights sum per script).
type Step = { text: string; weight: number };
const SCRIPTS: Record<SessionType, Step[]> = {
  mindfulness: [
    { text: "Sit comfortably. Let your eyes close or rest your gaze on the floor.", weight: 1 },
    { text: "Notice the sounds around you without naming or judging them.", weight: 2 },
    { text: "Bring attention to the feeling of breathing, wherever it is clearest.", weight: 3 },
    {
      text: "When your mind wanders, notice where it went, then gently come back. That noticing is the practice.",
      weight: 3,
    },
    {
      text: "Widen your attention to your whole body sitting here. Open your eyes when ready.",
      weight: 1,
    },
  ],
  breath: [
    {
      text: "Sit upright and relaxed. Breathe in and out through your nose if comfortable.",
      weight: 1,
    },
    {
      text: "Breathe in gently for a count of four, then out for a count of five or six. Never force or hold the breath.",
      weight: 4,
    },
    { text: "Let the count go and breathe naturally. Notice how it feels now.", weight: 2 },
    { text: "If you feel light-headed at any point, stop and breathe normally.", weight: 1 },
  ],
  body_scan: [
    { text: "Lie or sit comfortably. Take a few easy breaths.", weight: 1 },
    { text: "Bring attention to your feet and lower legs. Just notice what's there.", weight: 2 },
    { text: "Move up to your thighs, hips and lower back.", weight: 2 },
    { text: "Notice your belly, chest, shoulders and arms.", weight: 2 },
    {
      text: "Finish with your neck, jaw, face and the top of your head. Rest for a moment.",
      weight: 2,
    },
  ],
  relaxation: [
    { text: "Settle into a comfortable position.", weight: 1 },
    {
      text: "Gently tense your hands and forearms for a few seconds, then let go. Notice the difference.",
      weight: 2,
    },
    { text: "Do the same with your shoulders, then your face and jaw.", weight: 2 },
    { text: "Tense and release your legs and feet.", weight: 2 },
    { text: "Rest and let your whole body feel heavy and supported.", weight: 2 },
  ],
  focus: [
    { text: "Sit upright. Take three slow breaths.", weight: 1 },
    { text: "Name the one thing you're about to do and why it matters to you.", weight: 2 },
    { text: "Picture yourself starting it calmly. What is the very first step?", weight: 2 },
    { text: "Return to your breath for a few moments, then begin.", weight: 1 },
  ],
  wind_down: [
    { text: "Dim the lights and put your phone face down after this.", weight: 1 },
    {
      text: "Breathe slowly and let your out-breath be a little longer than your in-breath.",
      weight: 2,
    },
    {
      text: "Notice any thoughts about tomorrow. You can note them on paper and set them aside.",
      weight: 2,
    },
    { text: "Let your shoulders and jaw soften. Rest here.", weight: 3 },
  ],
  gratitude: [
    { text: "Sit quietly and take a few easy breaths.", weight: 1 },
    { text: "Bring to mind one thing that went well today, however small.", weight: 2 },
    { text: "Think of someone who helped you recently, and what they did.", weight: 2 },
    {
      text: "Notice one thing you did that you're glad about. Rest with that for a moment.",
      weight: 2,
    },
  ],
  timer: [{ text: "Unguided. Sit comfortably and practise in your own way.", weight: 1 }],
};

export function buildSession(type: SessionType, minutes: number) {
  const steps = SCRIPTS[type];
  const total = steps.reduce((s, x) => s + x.weight, 0);
  const secs = minutes * 60;
  return {
    type,
    minutes,
    scriptKey: `${type}_v1`,
    steps: steps.map((s) => ({
      text: s.text,
      seconds: Math.max(15, Math.round((s.weight / total) * secs)),
    })),
  };
}

export type WellnessPrefs = {
  session_types: string[];
  experience: Experience;
  min_minutes: number;
  max_minutes: number;
  preferred_time: string;
};
export type WellnessLog = {
  session_type: string;
  planned_minutes: number;
  actual_minutes: number;
  completion_state: string;
  useful: number | null;
  created_at: string;
};

const BASE_MIN: Record<Experience, number> = { beginner: 5, some: 10, experienced: 15 };

/** Recommends type + duration from preferences and adherence. Pure and deterministic. */
export function recommend(
  prefs: WellnessPrefs,
  history: WellnessLog[],
  hour: number,
  recovery?: string,
) {
  const allowed = (
    prefs.session_types.length ? prefs.session_types : ["mindfulness"]
  ) as SessionType[];
  const clamp = (m: number) => Math.min(prefs.max_minutes, Math.max(prefs.min_minutes, m));
  const reasons: string[] = [];

  // Duration: start from experience; +2 min after 3 consecutive completed sessions; −20% after 2 consecutive partial/stopped.
  let minutes = clamp(history[0]?.planned_minutes ?? BASE_MIN[prefs.experience]);
  const last3 = history.slice(0, 3),
    last2 = history.slice(0, 2);
  if (
    last3.length === 3 &&
    last3.every((h) => h.completion_state === "completed" && h.actual_minutes >= h.planned_minutes)
  ) {
    minutes = clamp(minutes + 2);
    reasons.push("You completed your last three sessions in full, so this one is a little longer.");
  } else if (last2.length === 2 && last2.every((h) => h.completion_state !== "completed")) {
    minutes = clamp(Math.round(minutes * 0.8));
    reasons.push("Your last two sessions ended early, so this one is shorter.");
  }

  // Type: context first (time of day), then adherence × usefulness score over the last 20.
  const score = (t: SessionType) => {
    const rows = history.slice(0, 20).filter((h) => h.session_type === t);
    if (!rows.length) return 0.5;
    const done = rows.filter((h) => h.completion_state === "completed").length / rows.length;
    const use = rows.filter((h) => h.useful != null);
    const u = use.length ? use.reduce((s, h) => s + (h.useful ?? 3), 0) / use.length / 5 : 0.6;
    return done * 0.6 + u * 0.4;
  };
  let type: SessionType;
  const calm = (["relaxation", "body_scan", "wind_down"] as SessionType[]).find((t) =>
    allowed.includes(t),
  );
  if ((recovery === "RED" || recovery === "AMBER") && calm) {
    type = calm;
    reasons.push(
      `Recovery is ${recovery.toLowerCase()} today, so a calmer session type is suggested.`,
    );
  } else if (hour >= 20 && allowed.includes("wind_down")) {
    type = "wind_down";
    reasons.push("It's evening, and you chose wind-down sessions.");
  } else if (hour >= 6 && hour < 10 && allowed.includes("focus")) {
    type = "focus";
    reasons.push("A short focus session suits the start of the day.");
  } else {
    type = [...allowed].sort(
      (a, b) => score(b) - score(a) || allowed.indexOf(a) - allowed.indexOf(b),
    )[0]!;
    reasons.push(
      history.length
        ? "Chosen from the session types you follow through on and rate as useful."
        : "A good place to start from the types you chose.",
    );
  }
  return { type, minutes, reasons, ruleVersion: WELLNESS_RULE_VERSION };
}

/** Crisis/distress language routes to the safety system instead of "meditate more". */
// Panic/flashback are wellness-specific distress words; crisis and red-flag detection is the central safety engine's.
const WELLNESS_DISTRESS = /\b(panic attack|flashback|hopeless)/i;
export const hasDistress = (s: string | null | undefined) =>
  !!s &&
  (detectSignals(s).some((x) => x !== "pain" && x !== "pregnancy_postpartum") ||
    WELLNESS_DISTRESS.test(s));
