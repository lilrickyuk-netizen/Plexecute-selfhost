// Guided Yoga and Meditation video choices (pure, deterministic). Discovery and caching live in
// guided-video.server.ts; this file decides what "matches" means so screens, Coach and tests agree.
export const GUIDED_RULE_VERSION = "guided_video_v1";
export type Activity = "yoga" | "meditation";

type Focus = { key: string; label: string; group: string; terms: RegExp; query: string };
const f = (key: string, label: string, group: string, terms: string, query?: string): Focus => ({
  key,
  label,
  group,
  terms: new RegExp(`\\b(${terms})`, "i"),
  query: query ?? label.toLowerCase(),
});

export const YOGA_FOCUS: Focus[] = [
  f(
    "full_body",
    "Full body",
    "Body",
    "full[ -]?body|total body|whole body|all levels|everyday|daily|yoga for (beginners|everyone)",
    "full body",
  ),
  f(
    "upper_body",
    "Upper body",
    "Body",
    "upper body|shoulders?|arms?|chest|spine|upper back",
    "upper body",
  ),
  f(
    "lower_body",
    "Lower body",
    "Body",
    "lower body|legs?|hips?|hamstrings?|glutes?|knees?",
    "lower body",
  ),
  f("back", "Back", "Body", "back|spine|sciatica", "back"),
  f("neck_shoulders", "Neck and shoulders", "Body", "neck|shoulders?", "neck and shoulders"),
  f("hips", "Hips", "Body", "hips?|hip openers?|hip flexors?", "hips"),
  f("legs", "Legs", "Body", "legs?|hamstrings?|calves|quads?", "legs"),
  f("core", "Core", "Body", "core|abs|abdominal", "core"),
  f("mobility", "Mobility", "Body", "mobility|joints?|range of motion|stiff", "mobility"),
  f("flexibility", "Flexibility", "Body", "flexib|stretch|splits", "flexibility"),
  f("stretching", "Stretching", "Body", "stretch", "full body stretch"),
  f(
    "recovery",
    "Recovery",
    "Purpose",
    "recover|restorative|gentle|relax|yin|sore|rest day",
    "recovery",
  ),
  f("morning", "Morning yoga", "Purpose", "morning|wake|start (your|the) day|sunrise", "morning"),
  f(
    "evening",
    "Evening yoga",
    "Purpose",
    "evening|bedtime|night|before bed|sleep|wind down",
    "evening bedtime",
  ),
  f(
    "relaxation",
    "Relaxation",
    "Purpose",
    "relax|calm|stress|restorative|gentle|yin|unwind",
    "relaxing",
  ),
  f(
    "post_workout",
    "Post-workout",
    "Purpose",
    "post[- ]?(workout|run)|after (a )?(workout|run|exercise|training)|athletes?|runners?|cool ?down|recovery",
    "post workout",
  ),
  f(
    "desk",
    "Desk / workday",
    "Purpose",
    "desk|office|work(day)?|chair|sitting|computer|tech neck",
    "desk office workers",
  ),
  f(
    "beginner",
    "Beginner yoga",
    "Purpose",
    "beginners?|basics|first|easy|gentle|new to yoga",
    "beginners",
  ),
  f(
    "wellbeing",
    "General wellbeing",
    "Purpose",
    "yoga|flow|practice|everyday|daily|self[- ]care|feel good",
    "everyday",
  ),
];

export const MEDITATION_PURPOSES: Focus[] = [
  f("relaxation", "Relaxation", "Purpose", "relax|calm|peace|unwind|rest", "relaxation"),
  f(
    "stress",
    "Stress reduction",
    "Purpose",
    "stress|anxi|calm|overwhelm|tension|let(ting)? go",
    "stress relief",
  ),
  f(
    "mindfulness",
    "Mindfulness",
    "Purpose",
    "mindful|present|awareness|breath|body scan",
    "mindfulness",
  ),
  f(
    "focus",
    "Focus",
    "Purpose",
    "focus|concentrat|clarity|productiv|study|work",
    "focus and concentration",
  ),
  f("sleep", "Sleep", "Purpose", "sleep|bed ?time|night|insomnia|drift", "sleep"),
  f(
    "confidence",
    "Confidence",
    "Purpose",
    "confiden|self[- ]?(esteem|worth|belief|love)|empower",
    "confidence",
  ),
  f(
    "motivation",
    "Motivation",
    "Purpose",
    "motivat|energ|inspir|drive|positive|uplift|goals?",
    "motivation",
  ),
  f("gratitude", "Gratitude", "Purpose", "gratitude|grateful|thankful|appreciat", "gratitude"),
  f("breathing", "Breathing", "Purpose", "breath", "breathing"),
  f("morning", "Morning meditation", "Time", "morning|wake|start (your|the) day", "morning"),
  f(
    "evening",
    "Evening meditation",
    "Time",
    "evening|night|end of (the|your) day|bed ?time|wind down",
    "evening",
  ),
  f(
    "recovery",
    "Recovery",
    "Purpose",
    "recover|restor|heal|rest|body scan|relax",
    "recovery and rest",
  ),
  f(
    "before_event",
    "Calm before an event",
    "Purpose",
    "before (a|an|your)|nerves|nervous|exam|interview|presentation|perform|calm",
    "calm nerves before an important event",
  ),
  f(
    "reset",
    "Reset in a stressful day",
    "Purpose",
    "reset|break|quick|stress|pause|midday|overwhelm|calm",
    "quick reset stressful day",
  ),
];

export const YOGA_MINUTES = [5, 10, 15, 20, 30, 45, 60];
export const MEDITATION_MINUTES = [3, 5, 10, 15, 20, 30, 45, 60];
export const minutesFor = (a: Activity) => (a === "yoga" ? YOGA_MINUTES : MEDITATION_MINUTES);
export const focusList = (a: Activity) => (a === "yoga" ? YOGA_FOCUS : MEDITATION_PURPOSES);
export const focusOf = (a: Activity, key: string) => focusList(a).find((x) => x.key === key);

/** Snap any requested length to the nearest offered option. */
export function snapMinutes(a: Activity, m: number) {
  return minutesFor(a).reduce((best, x) => (Math.abs(x - m) < Math.abs(best - m) ? x : best));
}

export type VideoCandidate = {
  videoId: string;
  url: string;
  title: string;
  creator: string;
  platform: "YouTube";
  seconds: number;
  embeddable: boolean;
  verifiedAt: string;
};
export type VideoChoice = VideoCandidate & {
  activity: Activity;
  focus: string;
  minutes: number;
  why: string;
  difficulty: string | null;
};

/** Length window: never much longer than the time the member has. */
export function fitsDuration(seconds: number, minutes: number) {
  const m = seconds / 60;
  return m >= Math.max(1.5, minutes * 0.65) && m <= minutes * 1.2 + 1;
}

// Well-known, established creators get a small preference; never a requirement.
const REPUTABLE =
  /yoga with adriene|yoga with kassandra|yoga with bird|yoga with tim|mady morrison|boho beautiful|sarahbethyoga|yogauonline|breathe and flow|travis eliot|jessica richburg|yoga with uliana|kino yoga|headspace|calm|the honest guys|jason stephenson|great meditation|goodful|tara brach|ucla|mindful|insight timer|michael sealey|lavendaire|declutter the mind|nhs|psychology/i;

const YOGA_REJECT =
  /\b(hiit|cardio|power yoga|advanced|fat burn|weight loss|challenge|inversion|handstand|asmr|music only|no talking)/i;
const MED_REJECT =
  /\b(hypnosis|binaural|subliminal|manifest|lucid|astral|asmr|hours?\b|10 hours|8 hours|music only|no talking|frequency|hz\b|chakra|third eye|law of attraction|yoga)/i;

export function difficultyOf(title: string): string | null {
  if (/beginner|gentle|easy|basic/i.test(title)) return "Beginner";
  if (/intermediate/i.test(title)) return "Intermediate";
  if (/advanced/i.test(title)) return "Advanced";
  return null;
}

/** Score a validated candidate; null means it does not match the selection. */
export function scoreCandidate(
  c: VideoCandidate,
  sel: { activity: Activity; focus: string; minutes: number },
  pref: { avoidCreators: string[]; likedCreators: string[]; avoidVideos: string[] },
) {
  const fo = focusOf(sel.activity, sel.focus);
  if (!fo || !c.seconds || !fitsDuration(c.seconds, sel.minutes)) return null;
  if (pref.avoidVideos.includes(c.videoId)) return null;
  const t = c.title;
  if (sel.activity === "yoga") {
    if (!/yoga|stretch|mobility|flow/i.test(t) || YOGA_REJECT.test(t)) return null;
    if (sel.focus === "beginner" && /intermediate/i.test(t)) return null;
  } else {
    if (
      !/meditat|mindful|breath|body scan|relax|calm|visuali|sleep|guided/i.test(t) ||
      MED_REJECT.test(t)
    )
      return null;
  }
  if (!fo.terms.test(t) && !(fo.key === "wellbeing")) return null;
  let s = 3;
  s += 2 * (1 - Math.min(1, Math.abs(c.seconds / 60 - sel.minutes) / sel.minutes));
  if (REPUTABLE.test(c.creator)) s += 1.5;
  if (/guided/i.test(t) && sel.activity === "meditation") s += 0.5;
  if (pref.likedCreators.includes(c.creator)) s += 1;
  if (pref.avoidCreators.includes(c.creator)) s -= 3;
  return s;
}

export function whyMatches(
  c: VideoCandidate,
  sel: { activity: Activity; focus: string; minutes: number },
) {
  const fo = focusOf(sel.activity, sel.focus)!;
  const mins = Math.round(c.seconds / 60);
  const parts = [
    `${mins} min, fits your ${sel.minutes} minutes`,
    `${fo.label.toLowerCase()} focus`,
  ];
  const d = difficultyOf(c.title);
  if (d) parts.push(`${d.toLowerCase()} level`);
  if (REPUTABLE.test(c.creator)) parts.push("established creator");
  return parts.join(" · ");
}

/** Pick up to n matching choices, preferring different creators. */
export function rankChoices(
  cands: VideoCandidate[],
  sel: { activity: Activity; focus: string; minutes: number },
  pref: { avoidCreators: string[]; likedCreators: string[]; avoidVideos: string[] },
  n = 3,
): VideoChoice[] {
  const scored = cands
    .map((c) => ({ c, s: scoreCandidate(c, sel, pref) }))
    .filter((x): x is { c: VideoCandidate; s: number } => x.s != null)
    .sort((a, b) => b.s - a.s);
  const out: VideoCandidate[] = [];
  for (const x of scored)
    if (out.length < n && !out.some((o) => o.creator === x.c.creator)) out.push(x.c);
  for (const x of scored) if (out.length < n && !out.includes(x.c)) out.push(x.c);
  return out.map((c) => ({
    ...c,
    activity: sel.activity,
    focus: sel.focus,
    minutes: sel.minutes,
    why: whyMatches(c, sel),
    difficulty: difficultyOf(c.title),
  }));
}

/** Reads a planned block / Coach phrase like "15-minute back yoga" into a selection. */
export function parseWellnessIntent(text: string, fallbackMinutes?: number) {
  const s = text.toLowerCase();
  const activity: Activity =
    /yoga|stretch|mobility/.test(s) && !/meditat/.test(s) ? "yoga" : "meditation";
  const list = focusList(activity);
  const hit =
    list.find((x) => s.includes(x.label.toLowerCase())) ??
    list.find((x) => x.key !== "wellbeing" && x.terms.test(s));
  const m = s.match(/(\d{1,2})\s*-?\s*(min|minute)/);
  const minutes = snapMinutes(activity, m ? Number(m[1]) : (fallbackMinutes ?? 10));
  const focus = hit?.key ?? (activity === "yoga" ? "wellbeing" : "relaxation");
  return { activity, focus, minutes };
}

export const YOGA_SAFETY =
  "General wellness only, not treatment. Move within a comfortable range and stop if anything hurts. If you have an injury, significant pain, recent surgery or are pregnant, check with a health professional first.";
export const MEDITATION_SAFETY =
  "Meditation supports calm and focus; it is not a treatment for mental-health conditions. If it brings up distress, stop and see Safety for support.";

/** Pain/injury language means a generic video must not be presented as the answer. */
export const reportsPainOrInjury = (s: string | null | undefined) =>
  !!s &&
  /\b(injur|surgery|operation|slipped disc|herniat|sciatica|fracture|sharp pain|severe pain|really hurts|can't move|numb|tingling)/i.test(
    s,
  );
