// Exercise demonstration matching (pure). Videos are optional support for the workout the
// Plexecute training engine prescribed; they never change what the member does.
import type { VideoCandidate } from "./guided-video";

export type DemoSpec = {
  /** Search phrase for this exact variation. */
  query: string;
  /** Every pattern must appear in the video title (exact variation). */
  require: RegExp[];
  /** Any match means a different variation or unrelated content. */
  reject: RegExp;
  equipment: string;
};

const COMMON_REJECT =
  "workout|routine|challenge|follow along|minute|min\\b|reaction|prank|vs\\b|versus|tier list|transformation|asmr|meme|fail|compilation|day \\d|full body|mistakes everyone|shorts? challenge";
const R = (extra: string) => new RegExp(`\\b(${extra ? `${extra}|` : ""}${COMMON_REJECT})`, "i");

export const DEMO_SPECS: Record<string, DemoSpec> = {
  back_squat: {
    query: "how to barbell back squat proper form",
    require: [/squat/i, /barbell|back squat/i],
    reject: R(
      "goblet|front squat|split|bulgarian|smith|bodyweight|air squat|pistol|jump|box squat|zercher|hack",
    ),
    equipment: "barbell",
  },
  goblet_squat: {
    query: "how to goblet squat proper form",
    require: [/goblet/i, /squat/i],
    reject: R("barbell|back squat|front squat|split|bulgarian|jump"),
    equipment: "dumbbell",
  },
  bodyweight_squat: {
    query: "how to do a bodyweight squat proper form",
    require: [/squat/i, /bodyweight|air squat|body weight/i],
    reject: R("barbell|goblet|dumbbell|kettlebell|jump|pistol|split|bulgarian"),
    equipment: "bodyweight",
  },
  box_squat: {
    query: "sit to stand exercise how to proper form",
    require: [/sit[- ]to[- ]stand|chair (stand|squat)|box squat/i],
    reject: R("barbell|dumbbell|kettlebell|jump"),
    equipment: "bodyweight",
  },
  romanian_deadlift: {
    query: "how to barbell romanian deadlift proper form",
    require: [/romanian|\brdl\b/i],
    reject: R(
      "dumbbell|\bdb\b|kettlebell|single[- ]leg|one[- ]leg|b[- ]stance|conventional|sumo|trap bar",
    ),
    equipment: "barbell",
  },
  db_rdl: {
    query: "how to dumbbell romanian deadlift proper form",
    require: [/romanian|\brdl\b/i, /dumbbell|\bdb\b/i],
    reject: R("barbell|kettlebell|single[- ]leg|one[- ]leg|b[- ]stance|conventional|sumo|trap bar"),
    equipment: "dumbbell",
  },
  glute_bridge: {
    query: "how to do a glute bridge proper form",
    require: [/glute bridge|hip bridge/i],
    reject: R("hip thrust|barbell|single[- ]leg|banded|marching"),
    equipment: "bodyweight",
  },
  split_squat: {
    query: "how to do a split squat proper form",
    require: [/split squat/i],
    reject: R("bulgarian|rear[- ]foot|elevated|jump|barbell|smith"),
    equipment: "bodyweight",
  },
  bench_press: {
    query: "how to barbell bench press proper form",
    require: [/bench press/i],
    reject: R("dumbbell|\bdb\b|incline|decline|close[- ]grip|smith|floor press|machine"),
    equipment: "barbell",
  },
  db_bench_press: {
    query: "how to dumbbell bench press proper form",
    require: [/press/i, /dumbbell|\bdb\b/i],
    reject: R("barbell|incline|decline|shoulder|overhead|floor press|squeeze|arnold"),
    equipment: "dumbbell",
  },
  push_up: {
    query: "how to do a push up proper form",
    require: [/push[- ]?ups?|press[- ]?ups?/i],
    reject: R("incline|decline|pike|diamond|clap|one[- ]arm|archer|handstand|knee"),
    equipment: "bodyweight",
  },
  incline_push_up: {
    query: "how to do an incline push up proper form",
    require: [/incline/i, /push[- ]?ups?|press[- ]?ups?/i],
    reject: R("decline|pike|diamond|clap|dumbbell|bench press"),
    equipment: "bodyweight",
  },
  overhead_press: {
    query: "how to barbell overhead press proper form",
    require: [/overhead press|military press|shoulder press|\bohp\b/i],
    reject: R("dumbbell|\bdb\b|seated|machine|arnold|landmine|push press|kettlebell|smith"),
    equipment: "barbell",
  },
  db_shoulder_press: {
    query: "how to dumbbell shoulder press proper form",
    require: [/press/i, /dumbbell|\bdb\b/i, /shoulder|overhead/i],
    reject: R("barbell|machine|arnold|bench press|landmine|kettlebell"),
    equipment: "dumbbell",
  },
  pike_push_up: {
    query: "how to do a pike push up proper form",
    require: [/pike/i, /push[- ]?ups?|press[- ]?ups?/i],
    reject: R("handstand|elevated|deficit|wall walk"),
    equipment: "bodyweight",
  },
  barbell_row: {
    query: "how to barbell row proper form",
    require: [/row/i, /barbell|bent[- ]over/i],
    reject: R(
      "dumbbell|\bdb\b|one[- ]arm|single[- ]arm|seated|cable|t[- ]bar|pendlay|upright|machine|inverted",
    ),
    equipment: "barbell",
  },
  db_row: {
    query: "how to one arm dumbbell row proper form",
    require: [/row/i, /dumbbell|\bdb\b/i],
    reject: R(
      "barbell|cable|seated|t[- ]bar|upright|renegade|chest[- ]supported|incline|kroc|machine",
    ),
    equipment: "dumbbell",
  },
  towel_row: {
    query: "how to do an inverted row at home table row proper form",
    require: [/row/i, /inverted|table|towel|bodyweight|australian/i],
    reject: R("barbell|dumbbell|cable|seated|t[- ]bar|machine"),
    equipment: "bodyweight",
  },
  prone_w_raise: {
    query: "how to prone W raise floor shoulder blade exercise",
    require: [/prone|floor/i, /\bw\b/i, /raise|lift|scapular/i],
    reject: R("dumbbell|barbell|band|bench|standing|incline"),
    equipment: "bodyweight",
  },
  lat_pulldown: {
    query: "how to lat pulldown proper form",
    require: [/pull[- ]?down/i],
    reject: R(
      "straight[- ]arm|single[- ]arm|one[- ]arm|kneeling|band|behind the neck|close[- ]grip|reverse grip",
    ),
    equipment: "machine",
  },
  pull_up: {
    query: "how to do a pull up proper form",
    require: [/pull[- ]?ups?/i],
    reject: R(
      "chin[- ]?ups?|muscle[- ]?up|kipping|assisted|negative|band|weighted|pulldown|archer|typewriter",
    ),
    equipment: "pull-up bar",
  },
  db_curl: {
    query: "how to dumbbell bicep curl proper form",
    require: [/curl/i, /dumbbell|\bdb\b|bicep/i],
    reject: R(
      "barbell|ez[- ]bar|cable|hammer|preacher|concentration|incline|spider|leg curl|hamstring|wrist|reverse|zottman|machine",
    ),
    equipment: "dumbbell",
  },
  dip: {
    query: "how to do parallel bar dips proper form",
    require: [/dips?\b/i],
    reject: R("bench dip|chair dip|ring dip|weighted|machine|assisted"),
    equipment: "parallel bars",
  },
  bench_dip: {
    query: "how to do bench dips proper form",
    require: [/(bench|chair) dips?/i],
    reject: R("parallel|ring|weighted|machine"),
    equipment: "bench or chair",
  },
  burpee: {
    query: "how to do a burpee proper form",
    require: [/burpees?/i],
    reject: R("challenge|\\d+ ?(day|days|minute|min)|workout"),
    equipment: "bodyweight",
  },
  mountain_climber: {
    query: "how to do mountain climbers proper form",
    require: [/mountain climbers?/i],
    reject: R("challenge|cross[- ]body|\\d+ ?(day|days|minute|min)|workout"),
    equipment: "bodyweight",
  },
  lying_leg_raise: {
    query: "how to do lying leg raises proper form",
    require: [/leg raises?/i],
    reject: R("hanging|captain|weighted|side"),
    equipment: "bodyweight",
  },
  bicycle_crunch: {
    query: "how to do bicycle crunches proper form",
    require: [/bicycle crunch(es)?/i],
    reject: R("challenge|weighted|\\d+ ?(day|days|minute|min)|workout"),
    equipment: "bodyweight",
  },
  plank: {
    query: "how to do a plank proper form",
    require: [/plank/i],
    reject: R(
      "side plank|plank jacks?|up[- ]down|shoulder taps?|plank to|reverse plank|walk|copenhagen|\\d+ ?(day|days)",
    ),
    equipment: "bodyweight",
  },
  calf_raise: {
    query: "how to do calf raises proper form",
    require: [/calf raises?|calf raise/i],
    reject: R("seated|machine|leg press|donkey|smith|barbell|single[- ]leg"),
    equipment: "bodyweight",
  },
};

const LIGHT_REJECT =
  /\b(challenge|reaction|prank|tier list|transformation|asmr|meme|fail|compilation|vs\b|versus)/i;
const M = (
  query: string,
  require: RegExp[],
  equipment = "bodyweight",
  reject: RegExp = LIGHT_REJECT,
): DemoSpec => ({ query, require, reject, equipment });
/** Mobility/recovery poses (Wellness & Movement) and cardio technique (Training) share the same catalogue. */
Object.assign(DEMO_SPECS, {
  "pose:cat_cow": M("cat cow stretch exercise", [/cat[- ]?(and[- ])?cow|cat[- ]camel/i]),
  "pose:arm_circles": M("how to do arm circles shoulder warm up", [/arm circles?/i]),
  "pose:ankle_rocks": M("kneeling ankle mobility knee to wall", [
    /ankle/i,
    /mobility|rock|dorsiflexion|knee to wall/i,
  ]),
  "pose:hip_circles": M("standing hip circles mobility", [/hip circles?/i]),
  "pose:low_lunge": M("how to low lunge hip flexor stretch", [
    /low lunge|kneeling hip flexor|half kneeling hip flexor/i,
  ]),
  "pose:pigeon": M("how to do pigeon pose stretch", [/pigeon/i]),
  "pose:hamstring_strap": M("lying hamstring stretch with strap", [
    /hamstring/i,
    /strap|lying|supine|band|towel/i,
  ]),
  "pose:forward_fold": M(
    "how to do standing forward fold",
    [/forward fold|forward bend/i],
    "bodyweight",
    /\b(seated|challenge|reaction|prank|compilation)/i,
  ),
  "pose:thread_needle": M("how to do thread the needle stretch", [/thread the needle/i]),
  "pose:open_book": M("side lying open book stretch", [/open book/i]),
  "pose:wall_slide": M("how to do wall slides shoulder mobility", [/wall (slides?|angels?)/i]),
  "pose:cossack": M("how to do cossack squat mobility", [/cossack/i]),
  "pose:jefferson": M(
    "segmental roll down spine mobility",
    [/roll[- ]?down|jefferson curl/i],
    "bodyweight",
    /\b(seated|pilates|ab |challenge|reaction|compilation)/i,
  ),
  "pose:downdog": M("how to do downward dog properly", [/downward[- ]?(facing )?dog|down dog/i]),
  "pose:childs_pose": M("how to do child's pose", [/child'?s pose/i]),
  "pose:supine_twist": M("supine spinal twist stretch", [
    /twist/i,
    /supine|lying|reclined|spinal/i,
  ]),
  "pose:doorway_pec": M("doorway chest stretch", [/(doorway|door)/i, /chest|pec/i]),
  "pose:calf_wall": M("wall calf stretch how to", [/calf stretch/i, /wall|standing/i]),
  "cardio:walking": M(
    "brisk walking technique posture",
    [/walk/i, /technique|form|posture|how to/i],
    "none",
  ),
  "cardio:running": M(
    "running warm up routine before a run",
    [/run/i, /warm[- ]?up|form|technique/i],
    "none",
  ),
  "cardio:cycling": M(
    "how to set up an exercise bike seat height",
    [/bike|cycl/i, /set ?up|seat height|fit|position|how to/i],
    "bike",
  ),
  "cardio:rowing": M(
    "rowing machine technique for beginners",
    [/row/i, /technique|form|how to|stroke/i],
    "rowing machine",
  ),
  "cardio:swimming": M(
    "freestyle swimming technique for beginners",
    [/freestyle|front crawl|swim/i, /technique|how to|beginner/i],
    "pool",
  ),
  "cardio:conditioning": M(
    "how to do mountain climbers proper form",
    [/mountain climbers?/i],
    "none",
  ),
});

export const REPUTABLE_TRAINERS =
  /jeff nippard|renaissance periodization|squat university|alan thrall|athlean|jeremy ethier|scott ?herman|buff dudes|barbell medicine|starting strength|mark rippetoe|nasm|ace fitness|american council on exercise|men'?s health|women'?s health|precision nutrition|nuffield health|puregym|the gym group|bupa|nhs|mayo clinic|cleveland clinic|hybrid calisthenics|calisthenicmovement|fitnessfaqs|muscle ?& ?strength|muscleandstrength|bodybuilding\.com|garage strength|stronger by science|e3 rehab|bob & brad|bob and brad|physiotutors|\[p\]rehab|the prehab guys|mind pump|tom merrick|bodyfit by amy|heather robertson|caroline girvan|madfit|livestrong|well\+good|self|popsugar fitness|howcast|healthline|verywell|kinetic|nerd fitness|omar isuf|megsquats|stephanie buttermore|natacha oc[eé]ane|mike israetel|dr\.? mike|brian alsruhe|juggernaut|eric bugg|meg squats|bret contreras|dr\.? john rusin|john rusin|cory gregory|ben carpenter|leanbeefpatty|sydney cummings|growingannanas|fit ?father|garage gym reviews|rogue fitness|bells of steel|onnit|yoga with adriene|yoga with kassandra|yoga with bird|mady morrison|tom merrick|kinstretch|bupa|physio|chiropract|the run experience|runner'?s world|global cycling network|gcn|concept2|dark horse rowing|effortless swimming|swim england|speedo|global triathlon network|gtn|mayo clinic|hss|sydney cummings|team body project|howcast/i;

/** Titles that are teaching technique, not just showing a workout. */
const INSTRUCTIONAL =
  /how to|form|technique|tutorial|guide|properly|correctly|explained|demo|demonstration|cues|step[- ]by[- ]step|beginners?|perfect/i;
const CLICKBAIT =
  /you'?re doing .* wrong|stop doing|never do|destroy|worst|insane|shocking|secret|hack|💀|😱|!!!|gone wrong|banned|dangerous/i;

export type DemoCandidate = VideoCandidate & { score: number };

/** Exact-variation, reputable, instructional, sensible length. Returns null when it must not be shown. */
export function scoreDemo(key: string, c: VideoCandidate): number | null {
  const s = DEMO_SPECS[key];
  if (!s) return null;
  const t = c.title;
  if (!s.require.every((r) => r.test(t)) || s.reject.test(t) || CLICKBAIT.test(t)) return null;
  if (c.seconds && (c.seconds < 15 || c.seconds > 15 * 60)) return null;
  const reputable = REPUTABLE_TRAINERS.test(c.creator);
  const instructional = INSTRUCTIONAL.test(t);
  // Mobility poses and cardio technique are short single-movement clips whose exact-name title is
  // itself the match; strength lifts additionally need an instructional or reputable signal.
  const simpleMovement = key.startsWith("pose:") || key.startsWith("cardio:");
  if (!reputable && !instructional && !simpleMovement) return null;
  let score = 0;
  if (reputable) score += 3;
  if (instructional) score += 2;
  if (/form|technique|how to/i.test(t)) score += 1;
  if (c.seconds && c.seconds <= 6 * 60) score += 1; // short, focused demonstrations suit mid-workout viewing
  if (c.embeddable) score += 0.5;
  return score;
}

export function pickDemos(key: string, cands: VideoCandidate[]): DemoCandidate[] {
  const out: DemoCandidate[] = [];
  for (const c of cands) {
    const score = scoreDemo(key, c);
    if (score != null) out.push({ ...c, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

export const DEMO_SAFETY =
  "Demonstrations are general technique guidance from independent creators, not medical or physiotherapy advice. Stop if you feel sharp pain, dizziness or chest pain.";

/** Finds which exercise a member means: "exercise 3", a key, a name or an alias. */
export function resolveExerciseRef(
  text: string,
  workout: { exercise_key: string; name: string }[],
  catalogue: { key: string; name: string; aliases: string[] }[],
): string | null {
  const t = text.toLowerCase().trim();
  const n = t.match(
    /(?:exercise|number|no\.?|#)\s*(\d+)|^(\d+)$|\b(first|second|third|fourth|fifth|sixth|last)\b/,
  );
  if (n) {
    const words = ["first", "second", "third", "fourth", "fifth", "sixth"];
    const i =
      (n[1] ?? n[2])
        ? Number(n[1] ?? n[2]) - 1
        : n[3] === "last"
          ? workout.length - 1
          : words.indexOf(n[3]!);
    if (workout[i]) return workout[i]!.exercise_key;
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const tn = norm(t);
  // Prefer the longest (most specific) name so "dumbbell romanian deadlift" beats "romanian deadlift".
  const all = [...catalogue].sort((a, b) => b.name.length - a.name.length);
  for (const e of all)
    if (tn === e.key.replace(/_/g, "") || tn.includes(norm(e.name))) return e.key;
  const wk = workout.find((w) => tn.includes(norm(w.name)));
  if (wk) return wk.exercise_key;
  for (const e of all) if (e.aliases.some((a) => tn.includes(norm(a)))) return e.key;
  if (/\brdl\b|romanian/.test(t)) return /dumbbell|\bdb\b/.test(t) ? "db_rdl" : "romanian_deadlift";
  return null;
}
