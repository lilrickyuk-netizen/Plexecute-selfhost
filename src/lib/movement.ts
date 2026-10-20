import { detectSignals } from "./safety";
// Deterministic cardio (V3 §45) and yoga/mobility (V3 §46) engines. No AI.
export const CARDIO_POLICY_VERSION = "cardio_progression_v1";
export const MOBILITY_POLICY_VERSION = "mobility_progression_v1";

export type CardioModality =
  "walking" | "running" | "cycling" | "rowing" | "swimming" | "conditioning";
export const CARDIO_MODALITIES: { key: CardioModality; label: string; logOnly?: boolean }[] = [
  { key: "walking", label: "Walking" },
  { key: "running", label: "Running" },
  { key: "cycling", label: "Cycling" },
  { key: "rowing", label: "Rowing" },
  { key: "swimming", label: "Swimming", logOnly: true },
  { key: "conditioning", label: "General conditioning" },
];

// RPE / talk-test descriptors, not age-predicted heart-rate zones (V3 §45).
export const INTENSITY = {
  easy: { label: "Easy", rpe: [3, 4] as const, talk: "You can hold a full conversation." },
  moderate: { label: "Moderate", rpe: [5, 6] as const, talk: "You can talk in short sentences." },
  vigorous: { label: "Vigorous", rpe: [7, 8] as const, talk: "Only a few words at a time." },
} as const;
export type Intensity = keyof typeof INTENSITY;

export type CardioLog = {
  duration_min: number;
  rpe: number | null;
  completed: boolean;
  pain_flag: boolean;
  prescribed: { minutes?: number; intensity?: Intensity };
};

/** Duration progression: +10% (min +2, cap 60→90 min) only after 2 consecutive completed
 *  sessions at or below the target RPE ceiling. Two too-hard or incomplete sessions step back 10%. */
export function prescribeCardio(intensity: Intensity, history: CardioLog[], baseMinutes = 20) {
  const relevant = history.filter((h) => h.prescribed.intensity === intensity);
  const last = relevant[0]?.prescribed.minutes ?? baseMinutes;
  const ceiling = INTENSITY[intensity].rpe[1];
  const two = relevant.slice(0, 2);
  const cap = intensity === "vigorous" ? 45 : 90;
  let minutes = last;
  let reason = relevant.length ? "Holding at your current duration." : "Starting duration.";
  if (two.length === 2 && two.some((h) => h.pain_flag)) {
    reason = "Pain reported recently, so duration is held. Seek advice if it continues.";
  } else if (
    two.length === 2 &&
    two.every(
      (h) =>
        h.completed &&
        h.duration_min >= (h.prescribed.minutes ?? 0) &&
        h.rpe != null &&
        h.rpe <= ceiling,
    )
  ) {
    minutes = Math.min(cap, Math.max(last + 2, Math.round(last * 1.1)));
    reason =
      minutes > last
        ? "Two sessions done at the target effort, so duration goes up about 10%."
        : "At the maximum duration for this intensity.";
  } else if (
    two.length === 2 &&
    two.every((h) => !h.completed || (h.rpe != null && h.rpe > ceiling))
  ) {
    minutes = Math.max(10, Math.round(last * 0.9));
    reason = "The last two sessions felt too hard or were cut short, so duration steps back 10%.";
  }
  return {
    minutes,
    intensity,
    rpe: INTENSITY[intensity].rpe,
    talk: INTENSITY[intensity].talk,
    reason,
    policy: CARDIO_POLICY_VERSION,
  };
}

// ---------- Yoga / mobility ----------
export type Region = "hips" | "hamstrings" | "spine" | "shoulders" | "ankles" | "full_body";
export const REGIONS: { key: Region; label: string }[] = [
  { key: "full_body", label: "Full body" },
  { key: "hips", label: "Hips" },
  { key: "hamstrings", label: "Hamstrings" },
  { key: "spine", label: "Spine" },
  { key: "shoulders", label: "Shoulders" },
  { key: "ankles", label: "Ankles" },
];
export type Restriction = "knee" | "back" | "shoulder" | "wrist";

export type Pose = {
  key: string;
  name: string;
  regions: Region[];
  intent: "mobility" | "flexibility" | "control";
  level: 1 | 2 | 3;
  mode: "hold" | "reps";
  base: number;
  phase: 1 | 2 | 3; // 1 warm-up, 2 main, 3 cool-down
  avoid: Restriction[];
  cue: string;
  regression: string;
  progression: string;
};

// Original Plexecute library (V3 §46 fields: region, intent, level, duration, sequence phase, contraindication, regression, progression).
export const POSES: Pose[] = [
  {
    key: "cat_cow",
    name: "Cat–cow",
    regions: ["spine", "full_body"],
    intent: "mobility",
    level: 1,
    mode: "reps",
    base: 8,
    phase: 1,
    avoid: ["wrist"],
    cue: "Move slowly with your breath, one vertebra at a time.",
    regression: "Do it seated with hands on knees.",
    progression: "Add a 3-second pause at each end.",
  },
  {
    key: "arm_circles",
    name: "Arm circles",
    regions: ["shoulders", "full_body"],
    intent: "mobility",
    level: 1,
    mode: "reps",
    base: 10,
    phase: 1,
    avoid: [],
    cue: "Small circles growing larger, ribs down.",
    regression: "Keep circles small.",
    progression: "Hold a light band between hands.",
  },
  {
    key: "ankle_rocks",
    name: "Kneeling ankle rocks",
    regions: ["ankles"],
    intent: "mobility",
    level: 1,
    mode: "reps",
    base: 10,
    phase: 1,
    avoid: ["knee"],
    cue: "Knee travels over the toes, heel stays down.",
    regression: "Do it standing against a wall.",
    progression: "Hold the end position for 3 seconds.",
  },
  {
    key: "hip_circles",
    name: "Standing hip circles",
    regions: ["hips", "full_body"],
    intent: "mobility",
    level: 1,
    mode: "reps",
    base: 8,
    phase: 1,
    avoid: [],
    cue: "Hold a wall and draw big slow circles with the knee.",
    regression: "Smaller circles.",
    progression: "No hand support.",
  },
  {
    key: "low_lunge",
    name: "Low lunge",
    regions: ["hips"],
    intent: "flexibility",
    level: 1,
    mode: "hold",
    base: 30,
    phase: 2,
    avoid: ["knee"],
    cue: "Tuck the pelvis slightly; feel the front of the back hip.",
    regression: "Pad the back knee or stay higher.",
    progression: "Reach the arm on the back-leg side overhead.",
  },
  {
    key: "pigeon",
    name: "Supported pigeon",
    regions: ["hips"],
    intent: "flexibility",
    level: 2,
    mode: "hold",
    base: 40,
    phase: 2,
    avoid: ["knee"],
    cue: "Keep the front foot flexed; prop the hip on a cushion.",
    regression: "Figure-four stretch lying on your back.",
    progression: "Fold forward over the front leg.",
  },
  {
    key: "hamstring_strap",
    name: "Lying hamstring stretch",
    regions: ["hamstrings"],
    intent: "flexibility",
    level: 1,
    mode: "hold",
    base: 30,
    phase: 2,
    avoid: [],
    cue: "Use a strap or towel; keep the knee soft.",
    regression: "Bend the knee more.",
    progression: "Straighten the knee and flex the foot.",
  },
  {
    key: "forward_fold",
    name: "Standing forward fold",
    regions: ["hamstrings", "spine"],
    intent: "flexibility",
    level: 2,
    mode: "hold",
    base: 30,
    phase: 2,
    avoid: ["back"],
    cue: "Bend the knees as much as needed; let the head hang.",
    regression: "Hands on a chair seat.",
    progression: "Hold the opposite elbows.",
  },
  {
    key: "thread_needle",
    name: "Thread the needle",
    regions: ["spine", "shoulders"],
    intent: "mobility",
    level: 1,
    mode: "hold",
    base: 25,
    phase: 2,
    avoid: ["shoulder"],
    cue: "Slide one arm under, rest the shoulder and ear down.",
    regression: "Rotate without threading the arm through.",
    progression: "Reach the top arm overhead.",
  },
  {
    key: "open_book",
    name: "Side-lying open book",
    regions: ["spine", "shoulders"],
    intent: "mobility",
    level: 1,
    mode: "reps",
    base: 8,
    phase: 2,
    avoid: [],
    cue: "Knees stacked; follow your hand with your eyes.",
    regression: "Smaller range.",
    progression: "Pause 3 seconds at the open position.",
  },
  {
    key: "wall_slide",
    name: "Wall slides",
    regions: ["shoulders"],
    intent: "control",
    level: 2,
    mode: "reps",
    base: 10,
    phase: 2,
    avoid: ["shoulder"],
    cue: "Back flat on the wall, forearms slide up without arching.",
    regression: "Step feet further from the wall.",
    progression: "Lift the forearms off the wall at the top.",
  },
  {
    key: "cossack",
    name: "Cossack shift",
    regions: ["hips", "ankles"],
    intent: "control",
    level: 3,
    mode: "reps",
    base: 6,
    phase: 2,
    avoid: ["knee"],
    cue: "Shift side to side, heel down, chest tall.",
    regression: "Hold a support and stay higher.",
    progression: "Hold a light weight at the chest.",
  },
  {
    key: "jefferson",
    name: "Segmental roll-down",
    regions: ["spine", "hamstrings"],
    intent: "control",
    level: 3,
    mode: "reps",
    base: 5,
    phase: 2,
    avoid: ["back"],
    cue: "Roll down one segment at a time, then stack back up.",
    regression: "Roll down only to the knees.",
    progression: "Stand on a low step.",
  },
  {
    key: "downdog",
    name: "Downward dog",
    regions: ["hamstrings", "shoulders", "full_body"],
    intent: "flexibility",
    level: 2,
    mode: "hold",
    base: 30,
    phase: 2,
    avoid: ["wrist", "shoulder"],
    cue: "Knees bent first, lengthen the spine, then press heels down.",
    regression: "Hands on a chair or wall.",
    progression: "Pedal the feet slowly.",
  },
  {
    key: "childs_pose",
    name: "Child's pose",
    regions: ["spine", "hips", "full_body"],
    intent: "flexibility",
    level: 1,
    mode: "hold",
    base: 45,
    phase: 3,
    avoid: ["knee"],
    cue: "Knees wide, breathe into the back of the ribs.",
    regression: "Cushion between hips and heels.",
    progression: "Walk the hands to each side.",
  },
  {
    key: "supine_twist",
    name: "Lying twist",
    regions: ["spine", "hips", "full_body"],
    intent: "flexibility",
    level: 1,
    mode: "hold",
    base: 40,
    phase: 3,
    avoid: [],
    cue: "Both shoulders stay heavy on the floor.",
    regression: "Pillow under the knees.",
    progression: "Straighten the top leg.",
  },
  {
    key: "doorway_pec",
    name: "Doorway chest stretch",
    regions: ["shoulders"],
    intent: "flexibility",
    level: 1,
    mode: "hold",
    base: 30,
    phase: 3,
    avoid: ["shoulder"],
    cue: "Elbow at shoulder height; step through gently.",
    regression: "Lower the elbow.",
    progression: "Raise the elbow slightly.",
  },
  {
    key: "calf_wall",
    name: "Wall calf stretch",
    regions: ["ankles"],
    intent: "flexibility",
    level: 1,
    mode: "hold",
    base: 30,
    phase: 3,
    avoid: [],
    cue: "Back heel down, back knee straight then bent.",
    regression: "Shorter stance.",
    progression: "Toes on a small book.",
  },
];

export type MobilityLog = {
  completed: boolean;
  tolerance: "easy" | "right" | "hard" | null;
  pain_flag: boolean;
  level: number;
  prescribed: { region?: Region };
};

/** Level rises only after 2 consecutive completed sessions felt "easy" or "right" without pain (V3 §46).
 *  Pain or 2 "hard" sessions step the level down. */
export function mobilityLevel(region: Region, history: MobilityLog[]) {
  const rel = history.filter((h) => h.prescribed.region === region);
  const current = rel[0]?.level ?? 1;
  const two = rel.slice(0, 2);
  if (rel[0]?.pain_flag)
    return {
      level: Math.max(1, current - 1),
      reason:
        "Pain was reported last time, so the session is easier. Never push range through pain.",
    };
  if (two.length === 2 && two.every((h) => h.tolerance === "hard" || !h.completed))
    return {
      level: Math.max(1, current - 1),
      reason: "The last two sessions felt too hard, so the level steps down.",
    };
  if (
    two.length === 2 &&
    two.every(
      (h) =>
        h.completed && h.level === current && (h.tolerance === "easy" || h.tolerance === "right"),
    )
  ) {
    return current < 3
      ? { level: current + 1, reason: "Two sessions completed comfortably, so the level goes up." }
      : { level: 3, reason: "You're at the top level; holds keep lengthening slowly." };
  }
  return {
    level: current,
    reason: rel.length
      ? "Holding at your current level until two comfortable sessions in a row."
      : "Starting level.",
  };
}

export type MobExperience = "new" | "some" | "experienced";
export type MobIntent = "mobility" | "flexibility" | "control";
export type MobPace = "gentle" | "steady";
export type MobEquipment = "strap" | "blocks" | "wall";
const NEEDS: Record<string, MobEquipment> = {
  hamstring_strap: "strap",
  wall_slide: "wall",
  calf_wall: "wall",
  doorway_pec: "wall",
};
const EXPERIENCE_CAP: Record<MobExperience, number> = { new: 1, some: 2, experienced: 3 };

export type MobilityInput = {
  region: Region;
  minutes: number;
  level: number;
  restrictions: Restriction[];
  experience?: MobExperience;
  intent?: MobIntent;
  pace?: MobPace;
  equipment?: MobEquipment[];
  recovery?: "GREEN" | "AMBER" | "RED" | "UNKNOWN";
  trainedToday?: boolean;
};

/** V3 §17/§46: experience caps level; recovery (AMBER -1, RED level 1 gentle) and same-day training soften it;
 *  intent orders the main block; pace sets hold length; missing equipment swaps in the regression. */
export function buildMobilitySession(input: MobilityInput) {
  const notes: string[] = [];
  let level = Math.min(input.level, EXPERIENCE_CAP[input.experience ?? "experienced"]);
  if (level < input.level) notes.push("Level capped to match your experience.");
  let pace: MobPace = input.pace ?? "steady";
  if (input.recovery === "RED") {
    level = 1;
    pace = "gentle";
    notes.push("Recovery is red: gentle level 1 only.");
  } else if (input.recovery === "AMBER" && level > 1) {
    level -= 1;
    notes.push("Recovery is amber: one level easier today.");
  }
  if (input.trainedToday && level > 1 && input.recovery !== "RED")
    notes.push("You trained today, so holds stay calm and controlled.");
  const minutes = input.minutes;
  const equip = new Set(input.equipment ?? ["wall"]);
  const ok = (p: Pose) =>
    p.level <= level &&
    !p.avoid.some((a) => input.restrictions.includes(a)) &&
    (input.region === "full_body" ||
      p.regions.includes(input.region) ||
      p.regions.includes("full_body"));
  const scale = 1 + (level - 1) * 0.25;
  if (pace === "gentle") notes.push("Gentle pace: move slowly and stay well short of any pain.");
  const steps: {
    key: string;
    name: string;
    amount: string;
    cue: string;
    regression: string;
    progression: string;
    seconds: number;
    phase: 1 | 2 | 3;
    modified?: string | undefined;
  }[] = [];
  const budget = minutes * 60;
  let used = 0;
  for (const phase of [1, 2, 3] as const) {
    const pool = POSES.filter((p) => p.phase === phase && ok(p)).sort(
      (a, b) =>
        Number(b.intent === input.intent) - Number(a.intent === input.intent) ||
        b.level - a.level ||
        a.key.localeCompare(b.key),
    );
    const take = phase === 2 ? pool : pool.slice(0, 2);
    for (const p of take) {
      const amt = Math.round(p.base * scale);
      const sides = p.mode === "hold" ? 2 : 1;
      const seconds = p.mode === "hold" ? amt * sides + 15 : amt * 5 + 15;
      if (used + seconds > budget && phase === 2 && steps.length > 2) continue;
      const need = NEEDS[p.key];
      const modified = need && !equip.has(need) ? `No ${need}: ${p.regression}` : undefined;
      steps.push({
        key: p.key,
        name: p.name,
        amount: p.mode === "hold" ? `${amt}s each side` : `${amt} reps`,
        cue: modified ?? p.cue,
        regression: p.regression,
        progression: p.progression,
        seconds,
        phase,
        modified,
      });
      used += seconds;
    }
  }
  return {
    steps,
    level,
    notes,
    estimatedMinutes: Math.max(1, Math.round(used / 60)),
    policy: MOBILITY_POLICY_VERSION,
  };
}

/** Delegates to the central safety engine (§62.2): red flags and new/sharp pain both stop the movement. */
export function hasRedFlag(text: string | null | undefined) {
  return detectSignals(text).some((s) => s === "exercise_red_flag" || s === "pain");
}

// ---------- Cardio goal, recovery and weekly adaptation (V3 §45) ----------
export type CardioGoal = "health" | "endurance" | "fat_loss";
export const CARDIO_GOALS: Record<CardioGoal, { label: string; weeklyMin: number; mix: string }> = {
  health: {
    label: "General health",
    weeklyMin: 150,
    mix: "Mostly moderate, with any vigorous minutes counting double.",
  },
  endurance: {
    label: "Build endurance",
    weeklyMin: 150,
    mix: "Mostly easy. Aim for 150 to 300 moderate minutes a week.",
  },
  fat_loss: {
    label: "Support fat loss",
    weeklyMin: 150,
    mix: "Mostly easy to moderate. Aim for 150 to 300 moderate minutes a week.",
  },
};
/** Moderate-equivalent minutes: vigorous counts double, easy counts half (UK CMO guidance style). */
export function moderateEquivalent(minutes: number, intensity: Intensity | undefined) {
  return intensity === "vigorous" ? minutes * 2 : intensity === "easy" ? minutes * 0.5 : minutes;
}
/** Recovery gate: AMBER caps intensity at moderate; RED allows easy effort only. Spec gives no time cuts. */
export function recoveryGate(intensity: Intensity, minutes: number, state: string) {
  if (state === "RED")
    return {
      intensity: "easy" as Intensity,
      minutes,
      note: "Recovery is RED: easy effort only today.",
    };
  if (state === "AMBER")
    return {
      intensity: (intensity === "vigorous" ? "moderate" : intensity) as Intensity,
      minutes,
      note: "Recovery is AMBER: effort capped at moderate today.",
    };
  return {
    intensity,
    minutes,
    note: state === "UNKNOWN" ? "No check-in today, so the plan isn't adjusted for recovery." : "",
  };
}
/** Weekly picture from logged sessions plus wearable steps (each 1,000 brisk steps above 5,000 a day ≈ 10 moderate minutes). */
export function weeklyCardio(
  goal: CardioGoal,
  sessions: { duration_min: number; prescribed: { intensity?: Intensity }; completed: boolean }[],
  dailySteps: number[],
) {
  const logged = sessions.reduce(
    (t, s) => t + moderateEquivalent(s.duration_min, s.prescribed.intensity),
    0,
  );
  const fromSteps =
    dailySteps.reduce((t, n) => t + Math.max(0, Math.floor((n - 5000) / 1000)) * 10, 0) * 0.5; // counted at half weight: unverified intensity
  const done = Math.round(logged + fromSteps);
  const target = CARDIO_GOALS[goal].weeklyMin;
  return {
    target,
    done,
    fromSteps: Math.round(fromSteps),
    remaining: Math.max(0, target - done),
    pct: Math.min(100, Math.round((done / target) * 100)),
  };
}
