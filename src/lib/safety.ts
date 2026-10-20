// V3 §62 central safety engine (locked). One canonical classifier + policy used by every domain.
// Runs before and after AI generation and before every high-impact plan mutation.
export const SAFETY_POLICY_VERSION = "safety_v1";

export const SAFETY_STATES = [
  "NORMAL",
  "CAUTION",
  "BLOCK_SPECIALIST_AUTOMATION",
  "CRISIS_SUPPORT",
  "EMERGENCY_GUIDANCE",
] as const;
export type SafetyState = (typeof SAFETY_STATES)[number];
const RANK: Record<SafetyState, number> = {
  NORMAL: 0,
  CAUTION: 1,
  BLOCK_SPECIALIST_AUTOMATION: 2,
  CRISIS_SUPPORT: 3,
  EMERGENCY_GUIDANCE: 4,
};

export type SafetySignal =
  | "exercise_red_flag"
  | "pain"
  | "pregnancy_postpartum"
  | "eating_disorder_risk"
  | "self_harm_crisis"
  | "immediate_danger";
export type SafetyDomain =
  | "training"
  | "nutrition"
  | "sleep"
  | "wellness"
  | "coach"
  | "research"
  | "calling"
  | "ai_input"
  | "ai_output"
  | "plan_mutation"
  | "user";

const SIGNAL_STATE: Record<SafetySignal, SafetyState> = {
  pain: "CAUTION",
  pregnancy_postpartum: "BLOCK_SPECIALIST_AUTOMATION",
  eating_disorder_risk: "BLOCK_SPECIALIST_AUTOMATION",
  exercise_red_flag: "EMERGENCY_GUIDANCE",
  self_harm_crisis: "CRISIS_SUPPORT",
  immediate_danger: "EMERGENCY_GUIDANCE",
};

// §62.2 / §62.4 / §62.5 signal patterns (text the user writes, or text an AI produced).
// Step 97: widened after adversarial testing (plain-language, slang, misspellings and obfuscation).
const PATTERNS: { signal: SafetySignal; re: RegExp }[] = [
  {
    signal: "immediate_danger",
    re: /\b(in danger|going to hurt me|(is|are|keeps?) (hitting|beating|attacking|choking|threatening) me|threatening me|overdos(e|ed|ing)|taken? (too many|a (whole )?(bottle|packet|box) of) (pills|tablets|paracetamol)|took (too many|a (whole )?(bottle|packet|box) of|all (my|the)) (pills|tablets|paracetamol|meds))\b/i,
  },
  {
    signal: "self_harm_crisis",
    re: /\b(suicid\w*|kms|kill(ing)? myself|end(ing)? it all|end(ing)? my (own )?life|take my (own )?life|self[- ]?harm\w*|hurt(ing)? myself|cut(ting)? myself|(want to|wanna|going to|gonna) die|wish i (was|were) dead|better off (dead|without me)|no (reason|point) (to|in) (live|living|being alive)|don'?t want to (be alive|live|be here)|want to disappear (forever|for good)|not want to wake up)\b/i,
  },
  {
    signal: "exercise_red_flag",
    re: /\b(chest (pain|pains|tightness|feels tight|is tight|hurts)|tight chest|faint(ed|ing)?|passed out|blacked out|(about to|going to|might) collapse|collapsed|can'?t breathe|severe(ly)? breathless\w*|numb(ness)? (in|down) (my )?(arm|face|side)|(left )?arm (hurts|pain|is numb).{0,30}chest|chest.{0,30}(left )?arm (hurts|pain)|slurred speech|face droop\w*|heart (is )?(racing|pounding|fluttering|beating (irregularly|strangely|weird))|irregular heart\w*|palpitations?|coughing (up )?blood|lightheaded|light-headed|dizzy)\b/i,
  },
  {
    signal: "eating_disorder_risk",
    re: /\b(purg(e|ed|ing)|make myself (sick|throw up|vomit)|throw(ing)? up after (meals|eating|food)|laxatives? to lose|starv(e|ing) myself|stop(ped)? eating|binge(d)? and|hate my body|eat nothing|hide (that )?(i'?m |i am )?not eating|skip(ping)? meals to (punish|lose)|punish myself|compensate for (eating|a binge)|binged and need to compensate|(only|under|below|just) [1-9]\d{2} ?(kcal|cals?|calories)|(?<!(burn|burns|burning|burned|deficit of|surplus of) )[1-9]\d{2} ?(kcal|cals?|calories) (a|per) day(?! ?(deficit|surplus))|fast(ing)? for ([3-9]|\d{2}) days)\b/i,
  },
  {
    signal: "pregnancy_postpartum",
    re: /\b(i'?m (\d{1,2} weeks )?pregnant|i am (currently |\d{1,2} weeks )?pregnant|currently pregnant|expecting a baby|(we'?re|i'?m) expecting|postpartum|post-partum|breast ?feeding|just (had|gave birth to) (a|my) baby)\b/i,
  },
  {
    signal: "pain",
    re: /\b(sharp|stabbing|shooting|tingl\w*|swollen|popped|injur\w*|worsening pain|new pain)\b/i,
  },
];

/** Undo common obfuscation (leetspeak, curly quotes, spacing tricks) before matching. */
export function normaliseForSafety(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/(?<=[a-z])[1!|](?=[a-z])/gi, "i")
    .replace(/(?<=[a-z])0(?=[a-z])/gi, "o")
    .replace(/(?<=[a-z])3(?=[a-z])/gi, "e")
    .replace(/(?<=[a-z])@(?=[a-z])/gi, "a")
    .replace(/(?<=[a-z])\$(?=[a-z])/gi, "s");
}

export function detectSignals(text: string | null | undefined): SafetySignal[] {
  if (!text) return [];
  const t = normaliseForSafety(text);
  return PATTERNS.filter((p) => p.re.test(t)).map((p) => p.signal);
}

export function stateFor(signals: readonly SafetySignal[]): SafetyState {
  return signals.reduce<SafetyState>(
    (s, sig) => (RANK[SIGNAL_STATE[sig]] > RANK[s] ? SIGNAL_STATE[sig] : s),
    "NORMAL",
  );
}

/** What every domain must honour for the current signal set. */
export type SafetyPolicy = {
  state: SafetyState;
  signals: SafetySignal[];
  stopTraining: boolean; // §62.2 stop the session, never coach through exercise
  blockProgressiveTraining: boolean; // §62.3
  blockCalorieDeficit: boolean; // §62.3 / §62.4
  suppressFoodWeightCalls: boolean; // §62.4
  disablePunitiveAccountability: boolean; // §62.4
  pauseAccountability: boolean; // §62.5 planned escalation pauses
  stopOrdinaryCoaching: boolean; // §62.5
  blockUpsell: boolean; // §63
  intervention: string;
};

export function policyFor(signals: readonly SafetySignal[]): SafetyPolicy {
  const s = new Set(signals);
  const state = stateFor(signals);
  const crisis = s.has("self_harm_crisis") || s.has("immediate_danger");
  const ed = s.has("eating_disorder_risk");
  const preg = s.has("pregnancy_postpartum");
  const red = s.has("exercise_red_flag");
  const intervention = crisis
    ? "crisis_resources"
    : red
      ? "stop_session_emergency_guidance"
      : ed
        ? "neutral_support_refer"
        : preg
          ? "block_specialist_automation"
          : s.has("pain")
            ? "conservative_substitution"
            : "none";
  return {
    state,
    signals: [...s],
    stopTraining: red || crisis,
    blockProgressiveTraining: preg || red || crisis,
    blockCalorieDeficit: preg || ed || crisis,
    suppressFoodWeightCalls: ed,
    disablePunitiveAccountability: ed || crisis,
    pauseAccountability: crisis,
    stopOrdinaryCoaching: crisis || red,
    blockUpsell: state !== "NORMAL",
    intervention,
  };
}

/** §62.1 things Plexecute must not say. Checked on every AI output. */
const OUTPUT_PROHIBITED: { kind: string; re: RegExp }[] = [
  // Regulated financial advice (FCA/SEC): naming a product to buy, sell or move money into.
  {
    kind: "regulated_finance",
    re: /\b(you should|i recommend|i'd recommend|i suggest) (that )?(you )?(buy|sell|invest in|put (your|the) (money|savings) (in|into)|switch to|open) (some |a |an )?(shares|stocks?|crypto|bitcoin|etfs?|index funds?|funds?|a stocks and shares isa|a pension|a 401k|a mortgage|bonds?)\b/i,
  },
  {
    kind: "diagnosis",
    re: /\byou (definitely |probably |likely |clearly )?(have|are suffering from) (a |an )?(depression|anxiety disorder|eating disorder|anorexia|bulimia|adhd|insomnia|sleep apnoea|sleep apnea|ocd|tendinitis|a tear|a fracture|a hernia)\b/i,
  },
  {
    kind: "medication",
    re: /\b(take|start|stop taking|increase|reduce|double|halve) (your |the )?(dose of |dosage of )?(\d+ ?mg|ibuprofen|paracetamol|antidepressants?|medication|insulin|metformin|dose|dosage)\b/i,
  },
  {
    kind: "cure_claim",
    re: /\b(cures?|will cure|treats|prevents) (your )?(disease|depression|diabetes|anxiety|cancer)\b/i,
  },
  {
    kind: "override_clinician",
    re: /\b(ignore|you don'?t need to follow) (your )?(doctor|gp|physio|clinician)\b/i,
  },
  // §47: never generate <1200 kcal/day in self-directed V3.
  {
    kind: "very_low_energy",
    re: /(?<!(burn|burns|burning|burned|deficit of|surplus of|about|roughly|extra) )(?<![\d,])(1[01]\d\d|1,[01]\d\d|[1-9]\d\d|[1-9]\d) ?(kcal|cals?|calories)( a| per)? ?(day|daily)\b(?! ?(deficit|surplus))/i,
  },
  {
    kind: "extended_fast",
    re: /\b(fast(ing)?|go without food|not eat(ing)?) for (2[4-9]|[3-9]\d|\d{3}) ?(hours|hrs|h)\b|\b(fast(ing)?|go without food) for ([2-9]|\d{2}) days\b/i,
  },
  { kind: "skip_meals_to_lose", re: /\bskip(ping)? meals to (lose|hit|reach|drop)\b/i },
  {
    kind: "train_through_red_flag",
    re: /\b(train|push|work|run|lift) through (the )?(pain|chest pain|dizziness|faintness)\b/i,
  },
  {
    kind: "wearable_diagnosis",
    re: /\byour (watch|wearable|heart rate|hrv) (shows|means|proves) you (have|are ill)/i,
  },
];
export function outputViolations(text: string): string[] {
  return OUTPUT_PROHIBITED.filter((p) => p.re.test(text)).map((p) => p.kind);
}

// §62.5 jurisdictional crisis manifest. Countries without a verified row get generic guidance only.
export type CrisisRow = {
  country: string;
  emergency: string;
  urgent: string;
  crisis: string;
  source: string;
  verified: string;
};
export const CRISIS_MANIFEST: Record<string, CrisisRow> = {
  GB: {
    country: "United Kingdom",
    emergency: "999",
    urgent: "NHS 111",
    crisis: "Samaritans 116 123 (free, 24 hours)",
    source:
      "https://www.nhs.uk/nhs-services/mental-health-services/where-to-get-urgent-help-for-mental-health/",
    verified: "2026-10-01",
  },
  US: {
    country: "United States",
    emergency: "911",
    urgent: "your doctor or an urgent care centre",
    crisis: "the 988 Suicide & Crisis Lifeline (call or text 988, 24 hours)",
    source: "https://988lifeline.org/",
    verified: "2026-10-12",
  },
};
const US_ZONES =
  /^(America\/(New_York|Detroit|Chicago|Denver|Phoenix|Boise|Los_Angeles|Anchorage|Juneau|Sitka|Nome|Adak|Metlakatla|Yakutat|Menominee|Indiana\/.+|Kentucky\/.+|North_Dakota\/.+)|Pacific\/Honolulu|US\/.+)$/;
const TZ_COUNTRY: Record<string, string> = { "Europe/London": "GB", "Europe/Belfast": "GB" };
function countryOfZone(tz: string): string | undefined {
  return TZ_COUNTRY[tz] ?? (US_ZONES.test(tz) ? "US" : undefined);
}
export function crisisResources(timezone: string | null | undefined): CrisisRow | null {
  return CRISIS_MANIFEST[countryOfZone(timezone ?? "") ?? ""] ?? null;
}
export const GENERIC_EMERGENCY =
  "If you are in immediate danger, contact your local emergency services now.";

export function safetyMessage(
  policy: SafetyPolicy,
  timezone: string | null | undefined,
): string | null {
  const r = crisisResources(timezone);
  const local = r
    ? `${r.country}: emergency ${r.emergency}, urgent advice ${r.urgent}, or ${r.crisis}.`
    : GENERIC_EMERGENCY;
  switch (policy.intervention) {
    case "crisis_resources":
      return `I'm really glad you told me. I'm not an emergency service, and planning can wait. Please reach out now: ${local} If you can, tell someone you trust how you're feeling.`;
    case "stop_session_emergency_guidance":
      return `Stop exercising now. Symptoms like these need medical help, not coaching. ${r ? `${r.country}: call ${r.emergency} for an emergency, or ${r.urgent} for urgent advice.` : GENERIC_EMERGENCY}`;
    case "neutral_support_refer":
      return "Thank you for sharing that. I won't push calorie or weight targets right now. Talking to your GP or an eating-disorder support service can really help. Your other plans stay available.";
    default:
      return null;
  }
}
