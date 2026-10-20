// Plexecute Training Engine (V3 §16, §44). Deterministic, versioned, no AI.
// Exercise descriptions are original Plexecute content.

export const TRAINING_POLICY_VERSION = "training-policy-1.0.0";

export type Equipment = "gym" | "home" | "bodyweight";
export type ExerciseClass = "upper_compound" | "lower_compound" | "isolation";
export type Exercise = {
  key: string;
  name: string;
  aliases: string[];
  movement_pattern:
    | "squat"
    | "hinge"
    | "horizontal_push"
    | "vertical_push"
    | "horizontal_pull"
    | "vertical_pull"
    | "lunge"
    | "core"
    | "arms"
    | "calves"
    | "conditioning";
  primary_muscles: string[];
  secondary_muscles: string[];
  equipment: Equipment[]; // minimum profile that can perform it
  cls: ExerciseClass;
  loaded: boolean; // externally loaded (e1RM valid)
  increment_kg: number; // smallest practical increment
  difficulty: 1 | 2 | 3;
  setup_steps: string[];
  execution_cues: string[];
  common_errors: string[];
  regressions: string[];
  progressions: string[];
  contraindication_flags: string[]; // non-diagnostic
  source: string;
};

const SRC =
  "Plexecute original content; programming baseline WHO 2020 / NHS physical activity guidance";

export const EXERCISES: Exercise[] = [
  {
    key: "back_squat",
    name: "Barbell back squat",
    aliases: ["squat"],
    movement_pattern: "squat",
    primary_muscles: ["quadriceps", "glutes"],
    secondary_muscles: ["adductors", "core"],
    equipment: ["gym"],
    cls: "lower_compound",
    loaded: true,
    increment_kg: 2.5,
    difficulty: 3,
    setup_steps: [
      "Set the bar at upper-chest height",
      "Bar on upper back, hands just outside shoulders",
      "Step back two short steps, feet shoulder width",
    ],
    execution_cues: [
      "Brace before each rep",
      "Knees track over toes",
      "Stand up through the whole foot",
    ],
    common_errors: ["Heels lifting", "Chest collapsing forward", "Cutting depth as load rises"],
    regressions: ["goblet_squat"],
    progressions: [],
    contraindication_flags: ["knee_pain", "back_pain"],
    source: SRC,
  },
  {
    key: "goblet_squat",
    name: "Goblet squat",
    aliases: ["db squat"],
    movement_pattern: "squat",
    primary_muscles: ["quadriceps", "glutes"],
    secondary_muscles: ["core"],
    equipment: ["home", "gym"],
    cls: "lower_compound",
    loaded: true,
    increment_kg: 2,
    difficulty: 1,
    setup_steps: ["Hold one dumbbell vertically at the chest", "Feet slightly wider than hips"],
    execution_cues: ["Elbows inside knees at the bottom", "Stay tall"],
    common_errors: ["Weight drifting away from chest"],
    regressions: ["bodyweight_squat"],
    progressions: ["back_squat"],
    contraindication_flags: ["knee_pain"],
    source: SRC,
  },
  {
    key: "bodyweight_squat",
    name: "Bodyweight squat",
    aliases: ["air squat"],
    movement_pattern: "squat",
    primary_muscles: ["quadriceps", "glutes"],
    secondary_muscles: [],
    equipment: ["bodyweight", "home", "gym"],
    cls: "lower_compound",
    loaded: false,
    increment_kg: 0,
    difficulty: 1,
    setup_steps: ["Feet shoulder width, arms forward"],
    execution_cues: ["Sit between your heels", "Control the descent"],
    common_errors: ["Knees caving in"],
    regressions: ["box_squat"],
    progressions: ["goblet_squat"],
    contraindication_flags: ["knee_pain"],
    source: SRC,
  },
  {
    key: "box_squat",
    name: "Sit-to-stand",
    aliases: ["box squat"],
    movement_pattern: "squat",
    primary_muscles: ["quadriceps", "glutes"],
    secondary_muscles: [],
    equipment: ["bodyweight", "home", "gym"],
    cls: "lower_compound",
    loaded: false,
    increment_kg: 0,
    difficulty: 1,
    setup_steps: ["Stand in front of a sturdy chair"],
    execution_cues: ["Touch the seat lightly, stand without using hands"],
    common_errors: ["Dropping onto the seat"],
    regressions: [],
    progressions: ["bodyweight_squat"],
    contraindication_flags: [],
    source: SRC,
  },
  {
    key: "romanian_deadlift",
    name: "Romanian deadlift",
    aliases: ["rdl"],
    movement_pattern: "hinge",
    primary_muscles: ["hamstrings", "glutes"],
    secondary_muscles: ["spinal erectors"],
    equipment: ["gym"],
    cls: "lower_compound",
    loaded: true,
    increment_kg: 2.5,
    difficulty: 2,
    setup_steps: ["Hold the bar at hip height, soft knees"],
    execution_cues: [
      "Push hips back",
      "Bar stays close to legs",
      "Stop when hamstrings limit range",
    ],
    common_errors: ["Rounding the lower back", "Squatting the movement"],
    regressions: ["db_rdl"],
    progressions: [],
    contraindication_flags: ["back_pain"],
    source: SRC,
  },
  {
    key: "db_rdl",
    name: "Dumbbell Romanian deadlift",
    aliases: [],
    movement_pattern: "hinge",
    primary_muscles: ["hamstrings", "glutes"],
    secondary_muscles: [],
    equipment: ["home", "gym"],
    cls: "lower_compound",
    loaded: true,
    increment_kg: 2,
    difficulty: 1,
    setup_steps: ["Dumbbells in front of thighs"],
    execution_cues: ["Hips back, neutral spine"],
    common_errors: ["Reaching for the floor"],
    regressions: ["glute_bridge"],
    progressions: ["romanian_deadlift"],
    contraindication_flags: ["back_pain"],
    source: SRC,
  },
  {
    key: "glute_bridge",
    name: "Glute bridge",
    aliases: ["hip bridge"],
    movement_pattern: "hinge",
    primary_muscles: ["glutes"],
    secondary_muscles: ["hamstrings"],
    equipment: ["bodyweight", "home", "gym"],
    cls: "lower_compound",
    loaded: false,
    increment_kg: 0,
    difficulty: 1,
    setup_steps: ["Lie on your back, knees bent, feet flat"],
    execution_cues: ["Drive through heels", "Squeeze at the top for one second"],
    common_errors: ["Arching the lower back"],
    regressions: [],
    progressions: ["db_rdl"],
    contraindication_flags: [],
    source: SRC,
  },
  {
    key: "split_squat",
    name: "Split squat",
    aliases: ["lunge"],
    movement_pattern: "lunge",
    primary_muscles: ["quadriceps", "glutes"],
    secondary_muscles: [],
    equipment: ["bodyweight", "home", "gym"],
    cls: "lower_compound",
    loaded: true,
    increment_kg: 2,
    difficulty: 2,
    setup_steps: ["Long split stance"],
    execution_cues: ["Back knee travels to the floor", "Front foot flat"],
    common_errors: ["Short stance"],
    regressions: ["box_squat"],
    progressions: [],
    contraindication_flags: ["knee_pain"],
    source: SRC,
  },
  {
    key: "bench_press",
    name: "Barbell bench press",
    aliases: ["bench"],
    movement_pattern: "horizontal_push",
    primary_muscles: ["chest"],
    secondary_muscles: ["triceps", "front delts"],
    equipment: ["gym"],
    cls: "upper_compound",
    loaded: true,
    increment_kg: 2.5,
    difficulty: 2,
    setup_steps: ["Eyes under the bar, feet planted", "Shoulder blades pulled back"],
    execution_cues: ["Lower to the lower chest", "Press up and slightly back"],
    common_errors: ["Bouncing off the chest", "Flared elbows"],
    regressions: ["db_bench_press"],
    progressions: [],
    contraindication_flags: ["shoulder_pain"],
    source: SRC,
  },
  {
    key: "db_bench_press",
    name: "Dumbbell press",
    aliases: ["db bench"],
    movement_pattern: "horizontal_push",
    primary_muscles: ["chest"],
    secondary_muscles: ["triceps"],
    equipment: ["home", "gym"],
    cls: "upper_compound",
    loaded: true,
    increment_kg: 2,
    difficulty: 1,
    setup_steps: ["Lie on a bench or floor with a dumbbell in each hand"],
    execution_cues: ["Elbows about 45° from the body"],
    common_errors: ["Dumbbells drifting apart"],
    regressions: ["push_up"],
    progressions: ["bench_press"],
    contraindication_flags: ["shoulder_pain"],
    source: SRC,
  },
  {
    key: "push_up",
    name: "Push-up",
    aliases: ["press-up"],
    movement_pattern: "horizontal_push",
    primary_muscles: ["chest"],
    secondary_muscles: ["triceps", "core"],
    equipment: ["bodyweight", "home", "gym"],
    cls: "upper_compound",
    loaded: false,
    increment_kg: 0,
    difficulty: 1,
    setup_steps: ["Hands under shoulders, body in a straight line"],
    execution_cues: ["Chest to a fist's height from the floor"],
    common_errors: ["Hips sagging"],
    regressions: ["incline_push_up"],
    progressions: ["db_bench_press"],
    contraindication_flags: ["shoulder_pain", "wrist_pain"],
    source: SRC,
  },
  {
    key: "incline_push_up",
    name: "Incline push-up",
    aliases: [],
    movement_pattern: "horizontal_push",
    primary_muscles: ["chest"],
    secondary_muscles: ["triceps"],
    equipment: ["bodyweight", "home", "gym"],
    cls: "upper_compound",
    loaded: false,
    increment_kg: 0,
    difficulty: 1,
    setup_steps: ["Hands on a table or bench"],
    execution_cues: ["Straight body line"],
    common_errors: ["Head dropping"],
    regressions: [],
    progressions: ["push_up"],
    contraindication_flags: ["wrist_pain"],
    source: SRC,
  },
  {
    key: "overhead_press",
    name: "Overhead press",
    aliases: ["ohp"],
    movement_pattern: "vertical_push",
    primary_muscles: ["shoulders"],
    secondary_muscles: ["triceps"],
    equipment: ["gym"],
    cls: "upper_compound",
    loaded: true,
    increment_kg: 2.5,
    difficulty: 2,
    setup_steps: ["Bar on front shoulders, grip just outside shoulders"],
    execution_cues: ["Squeeze glutes", "Head through once bar passes"],
    common_errors: ["Leaning back"],
    regressions: ["db_shoulder_press"],
    progressions: [],
    contraindication_flags: ["shoulder_pain", "back_pain"],
    source: SRC,
  },
  {
    key: "db_shoulder_press",
    name: "Dumbbell shoulder press",
    aliases: [],
    movement_pattern: "vertical_push",
    primary_muscles: ["shoulders"],
    secondary_muscles: ["triceps"],
    equipment: ["home", "gym"],
    cls: "upper_compound",
    loaded: true,
    increment_kg: 2,
    difficulty: 1,
    setup_steps: ["Seated or standing, dumbbells at shoulder height"],
    execution_cues: ["Press up without arching"],
    common_errors: ["Partial reps"],
    regressions: ["pike_push_up"],
    progressions: ["overhead_press"],
    contraindication_flags: ["shoulder_pain"],
    source: SRC,
  },
  {
    key: "pike_push_up",
    name: "Pike push-up",
    aliases: [],
    movement_pattern: "vertical_push",
    primary_muscles: ["shoulders"],
    secondary_muscles: ["triceps"],
    equipment: ["bodyweight", "home", "gym"],
    cls: "upper_compound",
    loaded: false,
    increment_kg: 0,
    difficulty: 2,
    setup_steps: ["Hips high, hands and feet on the floor"],
    execution_cues: ["Head moves forward of hands"],
    common_errors: ["Bending the elbows outward"],
    regressions: ["incline_push_up"],
    progressions: ["db_shoulder_press"],
    contraindication_flags: ["shoulder_pain", "wrist_pain"],
    source: SRC,
  },
  {
    key: "barbell_row",
    name: "Barbell row",
    aliases: ["bent-over row"],
    movement_pattern: "horizontal_pull",
    primary_muscles: ["upper back", "lats"],
    secondary_muscles: ["biceps"],
    equipment: ["gym"],
    cls: "upper_compound",
    loaded: true,
    increment_kg: 2.5,
    difficulty: 2,
    setup_steps: ["Hinge to about 45°, bar below shoulders"],
    execution_cues: ["Pull to the lower ribs", "Keep torso still"],
    common_errors: ["Jerking with the hips"],
    regressions: ["db_row"],
    progressions: [],
    contraindication_flags: ["back_pain"],
    source: SRC,
  },
  {
    key: "db_row",
    name: "One-arm dumbbell row",
    aliases: ["db row"],
    movement_pattern: "horizontal_pull",
    primary_muscles: ["lats", "upper back"],
    secondary_muscles: ["biceps"],
    equipment: ["home", "gym"],
    cls: "upper_compound",
    loaded: true,
    increment_kg: 2,
    difficulty: 1,
    setup_steps: ["One hand and knee on a bench"],
    execution_cues: ["Pull elbow to hip"],
    common_errors: ["Twisting the torso"],
    regressions: ["towel_row"],
    progressions: ["barbell_row"],
    contraindication_flags: [],
    source: SRC,
  },
  {
    key: "towel_row",
    name: "Inverted table/towel row",
    aliases: [],
    movement_pattern: "horizontal_pull",
    primary_muscles: ["upper back"],
    secondary_muscles: ["biceps"],
    equipment: ["home", "gym"],
    cls: "upper_compound",
    loaded: false,
    increment_kg: 0,
    difficulty: 1,
    setup_steps: ["Lie under a sturdy table or loop a towel around a closed door handle"],
    execution_cues: ["Squeeze shoulder blades together"],
    common_errors: ["Shrugging"],
    regressions: [],
    progressions: ["db_row"],
    contraindication_flags: [],
    source: SRC,
  },
  {
    key: "prone_w_raise",
    name: "Prone W raise",
    aliases: [],
    movement_pattern: "horizontal_pull",
    primary_muscles: ["upper back"],
    secondary_muscles: ["rear shoulders"],
    equipment: ["bodyweight", "home", "gym"],
    cls: "isolation",
    loaded: false,
    increment_kg: 0,
    difficulty: 1,
    setup_steps: [
      "Lie face down on the floor with elbows bent into a W, forehead resting comfortably",
    ],
    execution_cues: [
      "Gently lift hands and elbows, drawing shoulder blades together",
      "Keep the neck relaxed and lower slowly without arching the back",
    ],
    common_errors: ["Shrugging shoulders", "Forcing the lower back into an arch"],
    regressions: [],
    progressions: [],
    contraindication_flags: [],
    source: SRC,
  },
  {
    key: "lat_pulldown",
    name: "Lat pulldown",
    aliases: ["pulldown"],
    movement_pattern: "vertical_pull",
    primary_muscles: ["lats"],
    secondary_muscles: ["biceps"],
    equipment: ["gym"],
    cls: "isolation",
    loaded: true,
    increment_kg: 2.5,
    difficulty: 1,
    setup_steps: ["Thighs locked under the pad, wide grip"],
    execution_cues: ["Pull bar to upper chest", "Control the return"],
    common_errors: ["Leaning far back"],
    regressions: [],
    progressions: ["pull_up"],
    contraindication_flags: ["shoulder_pain"],
    source: SRC,
  },
  {
    key: "pull_up",
    name: "Pull-up",
    aliases: ["chin-up"],
    movement_pattern: "vertical_pull",
    primary_muscles: ["lats"],
    secondary_muscles: ["biceps"],
    equipment: ["home", "gym"],
    cls: "upper_compound",
    loaded: false,
    increment_kg: 0,
    difficulty: 3,
    setup_steps: ["Hang from a bar, hands shoulder width"],
    execution_cues: ["Chest to the bar", "Full hang between reps"],
    common_errors: ["Kipping"],
    regressions: ["towel_row"],
    progressions: [],
    contraindication_flags: ["shoulder_pain"],
    source: SRC,
  },
  {
    key: "db_curl",
    name: "Dumbbell curl",
    aliases: ["bicep curl"],
    movement_pattern: "arms",
    primary_muscles: ["biceps"],
    secondary_muscles: [],
    equipment: ["home", "gym"],
    cls: "isolation",
    loaded: true,
    increment_kg: 1,
    difficulty: 1,
    setup_steps: ["Stand tall, palms forward"],
    execution_cues: ["Elbows stay by the sides"],
    common_errors: ["Swinging"],
    regressions: [],
    progressions: [],
    contraindication_flags: [],
    source: SRC,
  },
  {
    key: "plank",
    name: "Plank",
    aliases: [],
    movement_pattern: "core",
    primary_muscles: ["core"],
    secondary_muscles: [],
    equipment: ["bodyweight", "home", "gym"],
    cls: "isolation",
    loaded: false,
    increment_kg: 0,
    difficulty: 1,
    setup_steps: ["Forearms under shoulders"],
    execution_cues: ["Straight line head to heels", "Reps = seconds held"],
    common_errors: ["Hips high or sagging"],
    regressions: [],
    progressions: [],
    contraindication_flags: ["back_pain"],
    source: SRC,
  },
  {
    key: "calf_raise",
    name: "Calf raise",
    aliases: [],
    movement_pattern: "calves",
    primary_muscles: ["calves"],
    secondary_muscles: [],
    equipment: ["bodyweight", "home", "gym"],
    cls: "isolation",
    loaded: true,
    increment_kg: 2,
    difficulty: 1,
    setup_steps: ["Balls of feet on a step"],
    execution_cues: ["Full stretch, pause at the top"],
    common_errors: ["Bouncing"],
    regressions: [],
    progressions: [],
    contraindication_flags: [],
    source: SRC,
  },
  {
    key: "dip",
    name: "Parallel bar dip",
    aliases: ["dips", "dip", "tricep dip", "bar dip"],
    movement_pattern: "vertical_push",
    primary_muscles: ["chest", "triceps"],
    secondary_muscles: ["front delts"],
    equipment: ["bodyweight", "home", "gym"],
    cls: "upper_compound",
    loaded: false,
    increment_kg: 0,
    difficulty: 3,
    setup_steps: ["Support yourself on parallel bars (or two sturdy chairs), arms locked"],
    execution_cues: [
      "Lean slightly forward",
      "Lower until shoulders are just below elbows",
      "Press back to straight arms",
    ],
    common_errors: ["Shrugging shoulders to the ears", "Dropping too deep with shoulder pain"],
    regressions: ["bench_dip"],
    progressions: [],
    contraindication_flags: ["shoulder_pain", "wrist_pain"],
    source: SRC,
  },
  {
    key: "bench_dip",
    name: "Bench dip",
    aliases: ["chair dip", "bench dips"],
    movement_pattern: "vertical_push",
    primary_muscles: ["triceps"],
    secondary_muscles: ["chest"],
    equipment: ["bodyweight", "home", "gym"],
    cls: "isolation",
    loaded: false,
    increment_kg: 0,
    difficulty: 1,
    setup_steps: ["Hands on the edge of a bench or chair behind you, legs out in front"],
    execution_cues: ["Elbows point back", "Lower to about 90 degrees at the elbow"],
    common_errors: ["Elbows flaring out", "Going too deep"],
    regressions: [],
    progressions: ["dip"],
    contraindication_flags: ["shoulder_pain", "wrist_pain"],
    source: SRC,
  },
  {
    key: "burpee",
    name: "Burpee",
    aliases: ["burpees"],
    movement_pattern: "conditioning",
    primary_muscles: ["full body"],
    secondary_muscles: ["heart and lungs"],
    equipment: ["bodyweight", "home", "gym"],
    cls: "isolation",
    loaded: false,
    increment_kg: 0,
    difficulty: 2,
    setup_steps: ["Stand with feet hip width"],
    execution_cues: [
      "Squat, hands down, jump feet back",
      "Chest to floor or plank",
      "Jump feet in and jump up",
    ],
    common_errors: ["Sagging hips in the plank", "Landing stiff-legged"],
    regressions: ["mountain_climber"],
    progressions: [],
    contraindication_flags: ["knee_pain", "back_pain", "wrist_pain"],
    source: SRC,
  },
  {
    key: "mountain_climber",
    name: "Mountain climber",
    aliases: ["mountain climbers"],
    movement_pattern: "conditioning",
    primary_muscles: ["core"],
    secondary_muscles: ["hip flexors", "shoulders"],
    equipment: ["bodyweight", "home", "gym"],
    cls: "isolation",
    loaded: false,
    increment_kg: 0,
    difficulty: 1,
    setup_steps: ["High plank, hands under shoulders"],
    execution_cues: ["Drive one knee to the chest, then switch", "Hips stay level"],
    common_errors: ["Hips piking up"],
    regressions: [],
    progressions: ["burpee"],
    contraindication_flags: ["wrist_pain"],
    source: SRC,
  },
  {
    key: "lying_leg_raise",
    name: "Lying leg raise",
    aliases: ["leg raise", "leg raises"],
    movement_pattern: "core",
    primary_muscles: ["lower abs"],
    secondary_muscles: ["hip flexors"],
    equipment: ["bodyweight", "home", "gym"],
    cls: "isolation",
    loaded: false,
    increment_kg: 0,
    difficulty: 1,
    setup_steps: ["Lie on your back, hands under your hips"],
    execution_cues: ["Lower back pressed down", "Raise straight legs to vertical, lower slowly"],
    common_errors: ["Lower back arching off the floor"],
    regressions: [],
    progressions: [],
    contraindication_flags: ["back_pain"],
    source: SRC,
  },
  {
    key: "bicycle_crunch",
    name: "Bicycle crunch",
    aliases: ["bicycle crunches", "crunch", "crunches", "sit up", "sit ups"],
    movement_pattern: "core",
    primary_muscles: ["abs", "obliques"],
    secondary_muscles: [],
    equipment: ["bodyweight", "home", "gym"],
    cls: "isolation",
    loaded: false,
    increment_kg: 0,
    difficulty: 1,
    setup_steps: ["Lie on your back, hands lightly by your ears"],
    execution_cues: [
      "Elbow towards the opposite knee",
      "Slow and controlled; each side is one rep",
    ],
    common_errors: ["Pulling on the neck"],
    regressions: [],
    progressions: [],
    contraindication_flags: ["back_pain"],
    source: SRC,
  },
];

export const EX = Object.fromEntries(EXERCISES.map((e) => [e.key, e])) as Record<string, Exercise>;

export type ProgrammeGoal = "strength" | "hypertrophy" | "general" | "conditioning" | "mixed";
export type Experience = "novice" | "intermediate";
export type ProgrammeInput = {
  goal: ProgrammeGoal;
  experience: Experience;
  equipment: Equipment;
  days: number;
  sessionMinutes: number;
  limitations: string[];
  /** Exact exercises the member asked for (engine keys, from resolveExercises); every session is built from these. */
  exercises?: string[] | undefined;
};
export type PrescriptionDraft = {
  day_index: number;
  order_index: number;
  exercise_key: string;
  sets: number;
  rep_min: number;
  rep_max: number;
  rir_target: number;
  rest_sec: number;
  load_kg: number | null;
};

const SLOT_BY_EQUIP: Record<Equipment, Record<string, string>> = {
  gym: {
    squat: "back_squat",
    hinge: "romanian_deadlift",
    hpush: "bench_press",
    vpush: "overhead_press",
    hpull: "barbell_row",
    vpull: "lat_pulldown",
    lunge: "split_squat",
    acc: "db_curl",
    core: "plank",
  },
  home: {
    squat: "goblet_squat",
    hinge: "db_rdl",
    hpush: "db_bench_press",
    vpush: "db_shoulder_press",
    hpull: "db_row",
    vpull: "db_row",
    lunge: "split_squat",
    acc: "db_curl",
    core: "plank",
  },
  bodyweight: {
    squat: "bodyweight_squat",
    hinge: "glute_bridge",
    hpush: "push_up",
    vpush: "pike_push_up",
    // Floor-only scapular work; not equivalent to a loaded row or pull-up.
    hpull: "prone_w_raise",
    vpull: "prone_w_raise",
    lunge: "split_squat",
    acc: "calf_raise",
    core: "plank",
  },
};

const DAY_TEMPLATES: Record<string, string[][]> = {
  full_body: [
    ["squat", "hpush", "hpull", "hinge", "core"],
    ["hinge", "vpush", "vpull", "lunge", "core"],
    ["squat", "hpush", "hpull", "acc", "core"],
  ],
  upper_lower: [
    ["hpush", "hpull", "vpush", "vpull", "acc"],
    ["squat", "hinge", "lunge", "core"],
  ],
};

const REPS: Record<
  ProgrammeGoal,
  { compound: [number, number]; iso: [number, number]; rest: number }
> = {
  strength: { compound: [4, 6], iso: [8, 12], rest: 180 },
  hypertrophy: { compound: [8, 12], iso: [10, 15], rest: 120 },
  general: { compound: [8, 12], iso: [10, 15], rest: 90 },
  conditioning: { compound: [12, 15], iso: [15, 20], rest: 45 }, // circuit-style, short rest
  mixed: { compound: [4, 6], iso: [10, 15], rest: 150 }, // overridden per day below
};
/** Mixed goals alternate heavy strength days and moderate muscle days. */
function repsForDay(goal: ProgrammeGoal, d: number) {
  return goal === "mixed" ? (d % 2 === 0 ? REPS.strength : REPS.hypertrophy) : REPS[goal];
}

/** Avoid exercises flagged by the user's reported limitations by stepping down to the safest regression. */
function safeExercise(key: string, limitations: string[]): string {
  let k = key;
  for (let i = 0; i < 4; i++) {
    const e = EX[k]!;
    if (!e.contraindication_flags.some((f) => limitations.includes(f))) return k;
    const next = e.regressions[0];
    if (!next) return k;
    k = next;
  }
  return k;
}

export function buildProgramme(i: ProgrammeInput): {
  template_key: string;
  prescriptions: PrescriptionDraft[];
} {
  const days = Math.min(6, Math.max(2, Math.round(i.days)));
  const own = (i.exercises ?? []).filter((k) => EX[k]);
  if (own.length)
    return { template_key: "member_circuit", prescriptions: memberCircuit(i, days, own) };
  const template_key = days >= 4 ? "upper_lower" : "full_body";
  const template = DAY_TEMPLATES[template_key]!;
  // Time budget: ~ (sets × (work 45s + rest)) + 8 min warm-up.
  const out: PrescriptionDraft[] = [];
  for (let d = 0; d < days; d++) {
    const reps = repsForDay(i.goal, d);
    const slots = template[d % template.length]!;
    let budget = (i.sessionMinutes - 8) * 60;
    slots.forEach((slot, idx) => {
      const key = safeExercise(SLOT_BY_EQUIP[i.equipment][slot]!, i.limitations);
      const ex = EX[key]!;
      const iso = ex.cls === "isolation";
      const sets = iso ? 2 : i.experience === "novice" ? 3 : 4;
      const rest = iso ? 75 : reps.rest;
      const cost = sets * (45 + rest);
      if (budget - cost < 0 && idx >= 2) return; // keep at least two exercises
      budget -= cost;
      const [lo, hi] = key === "plank" ? [20, 45] : iso ? reps.iso : reps.compound;
      out.push({
        day_index: d,
        order_index: idx,
        exercise_key: key,
        sets,
        rep_min: lo,
        rep_max: hi,
        rir_target: 2,
        rest_sec: rest,
        load_kg: ex.loaded ? null : null,
      });
    });
  }
  return { template_key, prescriptions: out };
}

export function substitutes(key: string, equipment: Equipment): Exercise[] {
  const e = EX[key];
  if (!e) return [];
  return EXERCISES.filter(
    (x) =>
      x.key !== key && x.movement_pattern === e.movement_pattern && x.equipment.includes(equipment),
  );
}

/** Epley estimate; only for externally loaded sets of 1–10 reps (V3 §44.5). */
export function estimate1RM(load: number, reps: number, loaded: boolean): number | null {
  if (!loaded || load <= 0 || reps < 1 || reps > 10) return null;
  return Math.round(load * (1 + reps / 30) * 10) / 10;
}

export type ExposureSet = { weight_kg: number; reps: number; rir: number | null };
export type Exposure = { session_id: string; sets: ExposureSet[] };
export type Prescription = {
  id: string;
  exercise_key: string;
  sets: number;
  rep_min: number;
  rep_max: number;
  rir_target: number;
  load_kg: number | null;
};
export type ProgressionDecision = {
  rule: "double_progression_load" | "double_progression_reps" | "regression_load" | "hold";
  next: { load_kg: number | null; rep_min: number; rep_max: number };
  why: string;
};

const CEILING: Record<ExerciseClass, number> = {
  upper_compound: 0.025,
  lower_compound: 0.05,
  isolation: 0.05,
};

function hitTop(p: Prescription, e: Exposure) {
  const work = e.sets.slice(0, p.sets);
  return (
    work.length >= p.sets &&
    work.every(
      (s) =>
        s.reps >= p.rep_max &&
        (s.rir == null || s.rir <= p.rir_target + 1) &&
        (s.rir == null || s.rir >= Math.max(0, p.rir_target - 1)),
    )
  );
}
function missedBottom(p: Prescription, e: Exposure) {
  return e.sets.slice(0, p.sets).some((s) => s.reps < p.rep_min);
}

/** V3 §44.4 / §44.6. `exposures` newest first. */
export function decideProgression(
  p: Prescription,
  exposures: Exposure[],
  recovery: string,
): ProgressionDecision {
  const ex = EX[p.exercise_key];
  const hold = (why: string): ProgressionDecision => ({
    rule: "hold",
    next: { load_kg: p.load_kg, rep_min: p.rep_min, rep_max: p.rep_max },
    why,
  });
  if (!ex || exposures.length < 2) return hold("Needs two comparable sessions before changing.");
  const [a, b] = exposures as [Exposure, Exposure];
  if (missedBottom(p, a) && missedBottom(p, b)) {
    if (!ex.loaded || !p.load_kg)
      return hold(
        "Missed the lower rep target twice. Consider the regression: " +
          (EX[ex.regressions[0] ?? ""]?.name ?? "reduce range"),
      );
    const cut = Math.max(
      ex.increment_kg,
      Math.round((p.load_kg * 0.075) / ex.increment_kg) * ex.increment_kg,
    );
    return {
      rule: "regression_load",
      next: { load_kg: Math.max(0, p.load_kg - cut), rep_min: p.rep_min, rep_max: p.rep_max },
      why: `Missed ${p.rep_min} reps on two consecutive sessions, so load is reduced by about 7.5%.`,
    };
  }
  if (!(hitTop(p, a) && hitTop(p, b)))
    return hold(
      `Reach ${p.rep_max} reps on all ${p.sets} sets at ${p.rir_target} reps in reserve on two sessions in a row to progress.`,
    );
  if (recovery === "AMBER" || recovery === "RED")
    return hold(`Ready to progress, but recovery is ${recovery}, so the load is held.`);
  if (!ex.loaded || !p.load_kg)
    return {
      rule: "double_progression_reps",
      next: { load_kg: p.load_kg, rep_min: p.rep_min + 2, rep_max: p.rep_max + 2 },
      why: "Top of the range twice. The rep target rises by 2.",
    };
  const ceiling = p.load_kg * CEILING[ex.cls];
  if (ex.increment_kg > ceiling)
    return {
      rule: "double_progression_reps",
      next: { load_kg: p.load_kg, rep_min: p.rep_min + 1, rep_max: p.rep_max + 1 },
      why: `The smallest jump (${ex.increment_kg} kg) is above the ${CEILING[ex.cls] * 100}% limit, so you add reps instead.`,
    };
  const steps = Math.max(1, Math.floor(ceiling / ex.increment_kg));
  const inc = Math.min(steps, 1) * ex.increment_kg;
  return {
    rule: "double_progression_load",
    next: {
      load_kg: Math.round((p.load_kg + inc) * 100) / 100,
      rep_min: p.rep_min,
      rep_max: p.rep_max,
    },
    why: `Hit ${p.rep_max} reps on every set twice in a row. Load rises by ${inc} kg.`,
  };
}

/** V3 §44.6: deload consideration needs a combination of signals, never one. */
export function deloadSignal(declines: number, recentRecovery: string[], soreHigh: boolean) {
  const poor = recentRecovery.filter((s) => s === "AMBER" || s === "RED").length;
  const signals = [declines >= 2, poor >= 3, soreHigh].filter(Boolean).length;
  return signals >= 2
    ? {
        deload: true,
        why: "Performance has dropped and recovery has been poor. Take a lighter week: same exercises, half the sets, loads down about 10%.",
      }
    : { deload: false, why: "" };
}

/** Missed-session recovery: resume the programme where you left off (never skip ahead) and ease loads back in after a break. */
export function nextTrainingDay(
  history: { day_index: number | null; status: string; started_at: string }[],
  days: number,
  now: Date = new Date(),
) {
  const done = history
    .filter((h) => h.status === "completed")
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  const last = done[0];
  const dayIndex = last ? ((last.day_index ?? 0) + 1) % Math.max(1, days) : 0;
  const gapDays = last ? Math.floor((now.getTime() - Date.parse(last.started_at)) / 864e5) : null;
  const returnFactor =
    gapDays == null ? 1 : gapDays >= 56 ? 0.7 : gapDays >= 28 ? 0.8 : gapDays >= 14 ? 0.9 : 1;
  const why =
    gapDays == null
      ? "Start with Day 1."
      : returnFactor < 1
        ? `${gapDays} days since your last workout. Picking up at Day ${dayIndex + 1} with loads about ${Math.round((1 - returnFactor) * 100)}% lighter to ease back in.`
        : `Next in sequence after your last workout: Day ${dayIndex + 1}. Missed days don't skip you ahead.`;
  return { dayIndex, gapDays, returnFactor, why };
}
export function returningLoad(load: number | null, factor: number, increment = 2.5): number | null {
  if (load == null || factor >= 1) return load;
  return Math.max(0, Math.round((load * factor) / increment) * increment);
}

/** One standalone session from the same engine (used when a member asks for "a 30-minute upper-body workout"). */
export function buildSession(
  i: Omit<ProgrammeInput, "days">,
  focus: "upper" | "lower" | "full",
): PrescriptionDraft[] {
  const days = focus === "full" ? 3 : 4;
  const day = focus === "lower" ? 1 : 0;
  return buildProgramme({ ...i, days }).prescriptions.filter((p) => p.day_index === day);
}

/** Sessions built from the member's own exercise list, in their order (circuit style), fitted to the session length. */
function memberCircuit(i: ProgrammeInput, days: number, keys: string[]): PrescriptionDraft[] {
  const safe = [...new Set(keys.map((k) => safeExercise(k, i.limitations)))].slice(0, 10);
  const out: PrescriptionDraft[] = [];
  for (let d = 0; d < days; d++) {
    const reps = repsForDay(i.goal, d);
    const rest = Math.min(reps.rest, i.goal === "conditioning" ? 45 : 90);
    const budget = (i.sessionMinutes - 8) * 60;
    const perSet = (k: string) => (EX[k]!.movement_pattern === "conditioning" ? 40 : 45) + rest;
    let sets = i.experience === "novice" ? 3 : 4;
    while (sets > 2 && safe.reduce((t, k) => t + sets * perSet(k), 0) > budget) sets--;
    safe.forEach((key, idx) => {
      const ex = EX[key]!;
      const timed = key === "plank";
      const [lo, hi] = timed
        ? [20, 45]
        : ex.movement_pattern === "conditioning"
          ? [8, 12]
          : ex.cls === "isolation"
            ? reps.iso
            : reps.compound;
      out.push({
        day_index: d,
        order_index: idx,
        exercise_key: key,
        sets,
        rep_min: lo,
        rep_max: hi,
        rir_target: 2,
        rest_sec: rest,
        load_kg: null,
      });
    });
  }
  return out;
}

const AREA_WORDS: Record<string, string[]> = {
  abs: ["lying_leg_raise", "bicycle_crunch", "plank"],
  core: ["lying_leg_raise", "bicycle_crunch", "plank"],
};
/** Maps the member's own words ("pull ups, dips, push ups, squats, burpees and ab exercises") to engine exercises. */
export function resolveExercises(
  names: string[],
  equipment: Equipment,
): { keys: string[]; unknown: string[] } {
  const norm = (x: string) =>
    x
      .toLowerCase()
      .replace(/[-_]/g, " ")
      .replace(/\b(exercises?|work|moves?)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const sing = (x: string) => x.replace(/(ies)$/, "y").replace(/(es|s)$/, "");
  const keys: string[] = [];
  const unknown: string[] = [];
  for (const raw of names.slice(0, 12)) {
    const n = norm(String(raw));
    if (!n) continue;
    const area =
      AREA_WORDS[n] ??
      AREA_WORDS[sing(n)] ??
      (/\b(ab|abs|abdominal)\b/.test(n) ? AREA_WORDS["abs"] : null);
    if (area) {
      keys.push(...area);
      continue;
    }
    const hits = EXERCISES.filter((e) => {
      const forms = [
        e.key.replace(/_/g, " "),
        e.name.toLowerCase(),
        ...e.aliases.map((a) => a.toLowerCase()),
      ];
      return forms.some(
        (f) =>
          f === n || sing(f) === sing(n) || sing(f.replace(/ /g, "")) === sing(n.replace(/ /g, "")),
      );
    });
    let fit = hits.find((e) => e.equipment.includes(equipment)) ?? hits[0];
    // A generic word ("squats") that matched a loaded gym lift becomes that movement for the member's equipment.
    if (fit && fit.loaded && !fit.equipment.includes(equipment)) {
      const alt =
        EX[
          Object.values(SLOT_BY_EQUIP[equipment]).find(
            (k) => EX[k]?.movement_pattern === fit!.movement_pattern,
          ) ?? ""
        ];
      if (alt) fit = alt;
    }
    if (fit) keys.push(fit.key);
    else unknown.push(String(raw));
  }
  return { keys: [...new Set(keys)], unknown };
}

/** Member effort feedback after a session ("too easy", "too hard"). Pure; null when none was given. */
export type Effort = "too_easy" | "too_hard";
export function effortFeedback(text: string | null | undefined): Effort | null {
  const t = String(text ?? "").toLowerCase();
  if (
    /\b(too|way too|far too|really|very|pretty|quite)\s+(easy|light)\b|\b(easy|piece of cake|barely broke a sweat|not hard enough|could have done more|need(ed)? (it )?harder)\b/.test(
      t,
    ) &&
    !/\bnot (too|that|very) easy\b/.test(t)
  )
    return "too_easy";
  if (
    /\b(too|way too|far too)\s+(hard|heavy|much|difficult)\b|\b(couldn'?t finish|could not finish|struggled|wiped out|destroyed me)\b/.test(
      t,
    )
  )
    return "too_hard";
  return null;
}

/** One-step change to a prescription from effort feedback. Loaded lifts move by the exercise's smallest increment;
 *  bodyweight work moves reps by 2 (and adds a set once reps pass 20), so the next session is genuinely harder or easier. */
export function adaptForEffort(
  p: {
    exercise_key: string;
    sets: number;
    rep_min: number;
    rep_max: number;
    load_kg: number | null;
  },
  effort: Effort,
): { sets: number; rep_min: number; rep_max: number; load_kg: number | null; why: string } {
  const ex = EX[p.exercise_key];
  const up = effort === "too_easy";
  if (ex?.loaded && p.load_kg) {
    const load = Math.max(0, Math.round((p.load_kg + (up ? 1 : -1) * ex.increment_kg) * 100) / 100);
    return {
      sets: p.sets,
      rep_min: p.rep_min,
      rep_max: p.rep_max,
      load_kg: load,
      why: `${up ? "Too easy" : "Too hard"}: load ${up ? "+" : "-"}${ex.increment_kg} kg.`,
    };
  }
  if (up) {
    if (p.rep_max + 2 > 20)
      return {
        sets: Math.min(p.sets + 1, 6),
        rep_min: p.rep_min,
        rep_max: p.rep_max,
        load_kg: p.load_kg,
        why: "Too easy: one extra set.",
      };
    return {
      sets: p.sets,
      rep_min: p.rep_min + 2,
      rep_max: p.rep_max + 2,
      load_kg: p.load_kg,
      why: "Too easy: +2 reps per set.",
    };
  }
  if (p.rep_min - 2 < 3)
    return {
      sets: Math.max(p.sets - 1, 1),
      rep_min: p.rep_min,
      rep_max: p.rep_max,
      load_kg: p.load_kg,
      why: "Too hard: one set fewer.",
    };
  return {
    sets: p.sets,
    rep_min: p.rep_min - 2,
    rep_max: p.rep_max - 2,
    load_kg: p.load_kg,
    why: "Too hard: -2 reps per set.",
  };
}
