// Deterministic conditioning programme (HIIT, circuit, aerobic base). No AI.
// Adapts the fixed structure to experience, equipment, limitations and schedule.
export type ConditioningExperience = "novice" | "intermediate";
export type ConditioningEquipment = "gym" | "home" | "bodyweight";
export type ConditioningLimitation = "knee_pain" | "back_pain" | "shoulder_pain" | "wrist_pain";

export type ConditioningInput = {
  experience?: ConditioningExperience;
  equipment?: ConditioningEquipment;
  limitations?: ConditioningLimitation[];
  daysPerWeek?: number;
};

export type ConditioningStep = { name: string; amount: string; note?: string };
export type ConditioningBlock = { heading: string; steps: ConditioningStep[] };
export type ConditioningDay = {
  key: "hiit" | "circuit" | "aerobic";
  title: string;
  duration: string;
  blocks: ConditioningBlock[];
};

export function buildConditioningProgramme(input: ConditioningInput): {
  days: ConditioningDay[];
  schedule: { day: string; session: string }[];
  progression: string[];
  notes: string[];
} {
  const experience = input.experience ?? "novice";
  const equipment = input.equipment ?? "bodyweight";
  const limits = new Set(input.limitations ?? []);
  const daysPerWeek = input.daysPerWeek ?? 3;
  const novice = experience === "novice";
  const notes: string[] = [];
  if (novice)
    notes.push("Set for a newer or returning member: fewer rounds and longer recoveries.");
  if (equipment === "bodyweight")
    notes.push("Bodyweight only: weighted moves are swapped for no-equipment versions.");
  if (limits.size)
    notes.push(
      "Adjusted around what hurts. It does not diagnose; see a professional for new or sharp pain.",
    );

  // ---- Day 1: HIIT ----
  const sprintOptions = limits.has("knee_pain")
    ? "Bike or rower, low impact."
    : equipment === "gym"
      ? "Bike, rower, running, assault bike, or an equivalent available option."
      : equipment === "home"
        ? "Running, a fast uphill walk, or step-ups."
        : "Fast running or high knees on the spot.";
  const hiit: ConditioningDay = {
    key: "hiit",
    title: "HIIT conditioning",
    duration: novice ? "20–25 minutes" : "20–30 minutes",
    blocks: [
      {
        heading: "Warm-up",
        steps: [{ name: "Brisk walking or light jogging", amount: "5 minutes" }],
      },
      {
        heading: `Main work — ${novice ? 3 : 5} rounds`,
        steps: [
          { name: "Sprint", amount: `${novice ? 20 : 30} seconds`, note: sprintOptions },
          { name: "Easy pace recovery", amount: `${novice ? 120 : 90} seconds` },
        ],
      },
      {
        heading: "Finisher — 3 rounds",
        steps: [
          {
            name: limits.has("knee_pain") ? "Step-back burpees (no jump)" : "Burpees",
            amount: "10 reps",
          },
          {
            name: limits.has("shoulder_pain") ? "Slow mountain climbers" : "Mountain climbers",
            amount: "20 reps",
          },
          { name: "Plank", amount: "30 seconds" },
        ],
      },
    ],
  };

  // ---- Day 2: Circuit ----
  const swings =
    limits.has("knee_pain") || limits.has("back_pain")
      ? { name: "Glute bridges", amount: "15 reps" }
      : equipment === "bodyweight"
        ? { name: "Squat jumps", amount: "15 reps" }
        : { name: "Kettlebell swings", amount: "15 reps" };
  const rows =
    equipment === "bodyweight"
      ? { name: "Towel rows or superman pulls", amount: "10 reps per side" }
      : { name: "Dumbbell rows", amount: "10 reps per arm" };
  const circuitCardio = limits.has("knee_pain")
    ? { name: "Brisk walk", amount: "1 minute" }
    : equipment === "gym"
      ? { name: "250m row or fast walk/jog", amount: "250m or 1 minute" }
      : { name: "Fast walk/jog", amount: "1 minute" };
  const circuit: ConditioningDay = {
    key: "circuit",
    title: "Circuit conditioning",
    duration: "30–40 minutes",
    blocks: [
      {
        heading: `Perform ${novice ? 4 : "4–5"} rounds with minimal rest`,
        steps: [
          swings,
          {
            name: limits.has("shoulder_pain") ? "Incline push-ups" : "Push-ups",
            amount: "10 reps",
          },
          {
            name:
              equipment === "bodyweight"
                ? limits.has("knee_pain")
                  ? "Sit-to-stands"
                  : "Air squats"
                : "Goblet squats",
            amount: "15 reps",
          },
          rows,
          circuitCardio,
        ],
      },
      {
        heading: "Rest",
        steps: [{ name: "Between rounds", amount: novice ? "2 minutes" : "1–2 minutes" }],
      },
    ],
  };

  // ---- Day 3: Aerobic base ----
  let aerobicOptions = ["jogging", "cycling", "rowing", "fast walking", "swimming"];
  if (limits.has("knee_pain")) aerobicOptions = aerobicOptions.filter((o) => o !== "jogging");
  if (equipment === "bodyweight") aerobicOptions = aerobicOptions.filter((o) => o !== "rowing");
  const aerobic: ConditioningDay = {
    key: "aerobic",
    title: "Aerobic base training",
    duration: novice ? "45 minutes" : "45–60 minutes",
    blocks: [
      {
        heading: "Steady pace — you can still hold a conversation",
        steps: [
          {
            name: "Suitable options",
            amount: aerobicOptions.join(", "),
            note: "Roughly 60–75% of maximum heart rate.",
          },
        ],
      },
    ],
  };

  // ---- Weekly schedule ----
  const schedule =
    daysPerWeek <= 2
      ? [
          { day: "Monday", session: "HIIT conditioning" },
          { day: "Thursday", session: "Circuit conditioning" },
          { day: "Weekend", session: "Aerobic base training when time allows" },
        ]
      : [
          { day: "Monday", session: "HIIT conditioning" },
          { day: "Wednesday", session: "Circuit conditioning" },
          { day: "Friday", session: "Aerobic base training" },
          { day: "Tuesday / Thursday / Saturday", session: "Strength training or mobility work" },
          { day: "Sunday", session: "Recovery" },
        ];

  const progression = [
    "Add 1 round to circuits.",
    "Increase work intervals by 5–10 seconds.",
    "Reduce rest periods slightly.",
    "Add 5–10 minutes to aerobic sessions.",
  ];

  return { days: [hiit, circuit, aerobic], schedule, progression, notes };
}
