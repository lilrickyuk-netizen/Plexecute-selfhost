// Plexecute Knowledge System (V3 §54–56, adapted).
// Copyright-restricted sources are represented by bibliographic metadata plus
// Plexecute-authored derived rules; no protected full text is copied.
// Retrieval is deterministic lexical scoring, shared by the Coach (server) and the Library page.

import { COACHING_CHUNKS, COACHING_SOURCES } from "./coaching-knowledge";
import { EXPANSION_CHUNKS, EXPANSION_SOURCES } from "./knowledge-expansion";

export type TrustTier = "T1" | "T2" | "T3" | "T4";
export type Domain =
  | "resistance_training"
  | "activity"
  | "mobility"
  | "nutrition"
  | "weight"
  | "sleep"
  | "mindfulness"
  | "behaviour"
  | "coaching"
  | "learning"
  | "safety"
  | "personal_development"
  | "motivation"
  | "goals"
  | "habits"
  | "productivity"
  | "career"
  | "finance"
  | "sports_psychology"
  | "wellbeing"
  | "relationships"
  | "decisions"
  | "transitions"
  | "business";

export const DOMAIN_LABEL: Record<Domain, string> = {
  resistance_training: "Resistance training",
  activity: "Physical activity",
  mobility: "Yoga & mobility",
  nutrition: "Nutrition",
  weight: "Weight management",
  sleep: "Sleep",
  mindfulness: "Mindfulness & relaxation",
  behaviour: "Behaviour change",
  coaching: "Coaching practice",
  learning: "Learning",
  safety: "Safety & privacy",
  personal_development: "Personal development",
  motivation: "Motivation & accountability",
  goals: "Goal-setting",
  habits: "Habits & behaviour change",
  productivity: "Productivity & time",
  career: "Career & professional growth",
  finance: "Financial wellbeing",
  sports_psychology: "Sports psychology",
  wellbeing: "Mental wellbeing & resilience",
  relationships: "Relationships & family",
  decisions: "Decision-making",
  transitions: "Life transitions",
  business: "Business & entrepreneurship",
};

export type KnowledgeSource = {
  source_id: string;
  title: string;
  publisher: string;
  url: string;
  jurisdiction: string;
  domain: Domain;
  rights: string;
  storage: "metadata_and_derived_rules";
  published: string;
  trust_tier: TrustTier;
  review_cadence: string;
  retrieval_method?: string;
  last_reviewed?: string;
  content_hash?: string | null;
  superseded_by?: string | null;
  /** research = peer-reviewed findings; official_guidance = public-body guidance; coaching_technique = general practice, never presented as science. */
  evidence_kind?: "research" | "official_guidance" | "coaching_technique";
};

export type KnowledgeChunk = {
  chunk_id: string;
  source_id: string;
  domain: Domain;
  /** Finer area within the domain (e.g. "task initiation"). */
  subdomain?: string;
  title: string;
  text_or_rule: string;
  keywords: string[];
  effective_date: string;
};

export const SOURCES: KnowledgeSource[] = [
  {
    source_id: "who-pa-2020",
    title: "WHO guidelines on physical activity and sedentary behaviour",
    publisher: "World Health Organization",
    url: "https://www.who.int/publications/i/item/9789240015128",
    jurisdiction: "Global",
    domain: "activity",
    rights: "Bibliographic reference",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "2020-11-25",
    trust_tier: "T1",
    review_cadence: "12 months",
  },
  {
    source_id: "uk-cmo-pa-2019",
    title: "UK Chief Medical Officers' Physical Activity Guidelines",
    publisher: "UK Department of Health and Social Care",
    url: "https://www.gov.uk/government/publications/physical-activity-guidelines-uk-chief-medical-officers-report",
    jurisdiction: "UK",
    domain: "activity",
    rights: "Open Government Licence (derived rules)",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "2019-09-07",
    trust_tier: "T1",
    review_cadence: "12 months",
  },
  {
    source_id: "acsm-progression-2009",
    title: "ACSM Position Stand: Progression models in resistance training for healthy adults",
    publisher: "American College of Sports Medicine",
    url: "https://pubmed.ncbi.nlm.nih.gov/19204579/",
    jurisdiction: "Global",
    domain: "resistance_training",
    rights: "Bibliographic reference",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "2009-03-01",
    trust_tier: "T2",
    review_cadence: "24 months",
  },
  {
    source_id: "morton-protein-2018",
    title:
      "Protein supplementation and resistance training: systematic review and meta-analysis (Morton et al.)",
    publisher: "British Journal of Sports Medicine",
    url: "https://bjsm.bmj.com/content/52/6/376",
    jurisdiction: "Global",
    domain: "nutrition",
    rights: "Bibliographic reference",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "2018-03-01",
    trust_tier: "T2",
    review_cadence: "24 months",
  },
  {
    source_id: "nhs-eatwell",
    title: "The Eatwell Guide",
    publisher: "NHS / Public Health England",
    url: "https://www.nhs.uk/live-well/eat-well/food-guidelines-and-food-labels/the-eatwell-guide/",
    jurisdiction: "UK",
    domain: "nutrition",
    rights: "Open Government Licence (derived rules)",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "2016-03-17",
    trust_tier: "T1",
    review_cadence: "12 months",
  },
  {
    source_id: "nice-obesity-ng246",
    title: "Overweight and obesity management (NG246)",
    publisher: "NICE",
    url: "https://www.nice.org.uk/guidance/ng246",
    jurisdiction: "UK",
    domain: "weight",
    rights: "Bibliographic reference",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "2025-01-14",
    trust_tier: "T1",
    review_cadence: "12 months",
  },
  {
    source_id: "aasm-sleep-2015",
    title: "Recommended amount of sleep for a healthy adult (AASM/SRS consensus)",
    publisher: "American Academy of Sleep Medicine & Sleep Research Society",
    url: "https://jcsm.aasm.org/doi/10.5664/jcsm.4758",
    jurisdiction: "Global",
    domain: "sleep",
    rights: "Bibliographic reference",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "2015-06-15",
    trust_tier: "T2",
    review_cadence: "24 months",
  },
  {
    source_id: "nhs-sleep",
    title: "How to get to sleep",
    publisher: "NHS",
    url: "https://www.nhs.uk/live-well/sleep-and-tiredness/how-to-get-to-sleep/",
    jurisdiction: "UK",
    domain: "sleep",
    rights: "Open Government Licence (derived rules)",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "2023-01-01",
    trust_tier: "T1",
    review_cadence: "12 months",
  },
  {
    source_id: "gollwitzer-1999",
    title: "Implementation intentions: strong effects of simple plans",
    publisher: "American Psychologist",
    url: "https://doi.org/10.1037/0003-066X.54.7.493",
    jurisdiction: "Global",
    domain: "behaviour",
    rights: "Bibliographic reference",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "1999-07-01",
    trust_tier: "T2",
    review_cadence: "36 months",
  },
  {
    source_id: "lally-2010",
    title: "How are habits formed: modelling habit formation in the real world (Lally et al.)",
    publisher: "European Journal of Social Psychology",
    url: "https://doi.org/10.1002/ejsp.674",
    jurisdiction: "Global",
    domain: "behaviour",
    rights: "Bibliographic reference",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "2010-10-01",
    trust_tier: "T2",
    review_cadence: "36 months",
  },
  {
    source_id: "sdt-2000",
    title: "Self-determination theory and intrinsic motivation (Ryan & Deci)",
    publisher: "American Psychologist",
    url: "https://doi.org/10.1037/0003-066X.55.1.68",
    jurisdiction: "Global",
    domain: "coaching",
    rights: "Bibliographic reference",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "2000-01-01",
    trust_tier: "T2",
    review_cadence: "36 months",
  },
  {
    source_id: "roediger-2006",
    title: "Test-enhanced learning (Roediger & Karpicke)",
    publisher: "Psychological Science",
    url: "https://doi.org/10.1111/j.1467-9280.2006.01693.x",
    jurisdiction: "Global",
    domain: "learning",
    rights: "Bibliographic reference",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "2006-03-01",
    trust_tier: "T2",
    review_cadence: "36 months",
  },
  {
    source_id: "cepeda-2006",
    title: "Distributed practice in verbal recall tasks: a review (Cepeda et al.)",
    publisher: "Psychological Bulletin",
    url: "https://doi.org/10.1037/0033-2909.132.3.354",
    jurisdiction: "Global",
    domain: "learning",
    rights: "Bibliographic reference",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "2006-05-01",
    trust_tier: "T2",
    review_cadence: "36 months",
  },
  {
    source_id: "nhs-yoga",
    title: "A guide to yoga",
    publisher: "NHS",
    url: "https://www.nhs.uk/live-well/exercise/guide-to-yoga/",
    jurisdiction: "UK",
    domain: "mobility",
    rights: "Open Government Licence (derived rules)",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "2022-01-01",
    trust_tier: "T1",
    review_cadence: "12 months",
  },
  {
    source_id: "nhs-mindfulness",
    title: "Mindfulness",
    publisher: "NHS",
    url: "https://www.nhs.uk/mental-health/self-help/tips-and-support/mindfulness/",
    jurisdiction: "UK",
    domain: "mindfulness",
    rights: "Open Government Licence (derived rules)",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "2022-09-01",
    trust_tier: "T1",
    review_cadence: "12 months",
  },
  {
    source_id: "plexecute-safety",
    title: "Plexecute safety & privacy policy",
    publisher: "Plexecute",
    url: "/safety",
    jurisdiction: "UK",
    domain: "safety",
    rights: "Plexecute-authored",
    storage: "metadata_and_derived_rules",
    last_reviewed: "2026-10-17",
    published: "2026-01-01",
    trust_tier: "T3",
    review_cadence: "6 months",
  },
];

const c = (
  chunk_id: string,
  source_id: string,
  domain: Domain,
  title: string,
  text_or_rule: string,
  keywords: string[],
  effective_date = "2026-01-01",
): KnowledgeChunk => ({
  chunk_id,
  source_id,
  domain,
  title,
  text_or_rule,
  keywords,
  effective_date,
});

export const CHUNKS: KnowledgeChunk[] = [
  c(
    "pa-1",
    "who-pa-2020",
    "activity",
    "Weekly aerobic target",
    "Adults should aim for 150 to 300 minutes of moderate aerobic activity, or 75 to 150 minutes of vigorous activity, per week, or an equivalent mix.",
    ["cardio", "aerobic", "walk", "run", "minutes", "week", "activity", "exercise"],
  ),
  c(
    "pa-2",
    "who-pa-2020",
    "activity",
    "Some is better than none",
    "Any amount of activity is better than none. Replacing sitting with light activity carries benefit, so short walks count when the week is busy.",
    ["sedentary", "sitting", "busy", "walk", "steps", "short"],
  ),
  c(
    "pa-3",
    "uk-cmo-pa-2019",
    "activity",
    "Strength on two days",
    "Adults should do muscle-strengthening activity on at least two days a week, working all major muscle groups.",
    ["strength", "muscle", "gym", "twice", "days"],
  ),
  c(
    "rt-1",
    "acsm-progression-2009",
    "resistance_training",
    "Progressive overload",
    "Progress load gradually once the target reps are achieved with good form; a 2 to 10 percent increase is typical. Novices progress fastest.",
    ["progress", "overload", "weight", "load", "increase", "plateau", "reps"],
  ),
  c(
    "rt-2",
    "acsm-progression-2009",
    "resistance_training",
    "Rep ranges",
    "For strength, moderate to heavy loads around 1 to 6 reps; for hypertrophy, roughly 6 to 12 reps; for muscular endurance, 15 or more. All ranges build muscle when sets are taken close to failure.",
    ["reps", "sets", "hypertrophy", "muscle", "strength", "range"],
  ),
  c(
    "rt-3",
    "acsm-progression-2009",
    "resistance_training",
    "Frequency and rest",
    "Train each muscle group 2 to 3 times a week for most adults. Allow around 48 hours before heavily loading the same muscles again.",
    ["frequency", "rest", "recovery", "split", "sore", "days"],
  ),
  c(
    "rt-4",
    "acsm-progression-2009",
    "resistance_training",
    "Effort and RPE",
    "Most working sets should finish with roughly 1 to 3 reps in reserve (RPE 7 to 9). Training to failure every set adds fatigue with little extra benefit.",
    ["rpe", "failure", "effort", "intensity", "reserve"],
  ),
  c(
    "nu-1",
    "morton-protein-2018",
    "nutrition",
    "Protein for muscle",
    "Muscle gain from resistance training plateaus around 1.6 g of protein per kg of body weight per day; up to about 2.2 g/kg is reasonable. Spread it across meals.",
    ["protein", "muscle", "grams", "kg", "gain", "shake"],
  ),
  c(
    "nu-2",
    "nhs-eatwell",
    "nutrition",
    "Balanced plate",
    "Base meals on starchy carbohydrates (wholegrain where possible), eat at least five portions of fruit and vegetables a day, include protein sources, and limit foods high in saturated fat, salt and sugar.",
    ["diet", "balanced", "vegetables", "fruit", "carbs", "meal", "healthy"],
  ),
  c(
    "nu-3",
    "nhs-eatwell",
    "nutrition",
    "Fluids",
    "Aim for 6 to 8 cups or glasses of fluid a day, more when training or in hot weather.",
    ["water", "hydration", "fluid", "drink"],
  ),
  c(
    "nu-4",
    "nhs-eatwell",
    "nutrition",
    "Energy reference",
    "The reference intake is around 2,000 kcal a day for women and 2,500 kcal for men; individual needs vary with size and activity.",
    ["calories", "kcal", "energy", "intake", "how much"],
  ),
  c(
    "wt-1",
    "nice-obesity-ng246",
    "weight",
    "Sustainable rate of loss",
    "A sustainable weight-loss rate is roughly 0.5 to 1 kg per week. Faster loss increases muscle loss and rebound risk. Plexecute never sets a target below a healthy BMI or an intake below safe minimums.",
    ["weight", "lose", "fat", "loss", "deficit", "cut", "diet"],
  ),
  c(
    "wt-2",
    "nice-obesity-ng246",
    "weight",
    "Combine diet and activity",
    "Weight management works best combining a modest energy deficit, regular activity and behaviour-change support rather than restriction alone.",
    ["weight", "deficit", "activity", "maintain"],
  ),
  c(
    "wt-3",
    "plexecute-safety",
    "weight",
    "Disordered eating boundary",
    "If a user describes bingeing, purging, extreme restriction or distress about food, Plexecute stops weight targets and signposts support (UK: Beat, beateatingdisorders.org.uk, or a GP).",
    ["binge", "purge", "starve", "eating disorder", "restrict", "anorexia", "bulimia"],
  ),
  c(
    "sl-1",
    "aasm-sleep-2015",
    "sleep",
    "How much sleep",
    "Adults should regularly sleep 7 or more hours per night. Consistently less is linked with poorer health, mood and performance.",
    ["sleep", "hours", "tired", "night", "rest"],
  ),
  c(
    "sl-2",
    "nhs-sleep",
    "sleep",
    "Sleep routine",
    "Keep regular sleep and wake times, wind down before bed, keep the bedroom dark, quiet and cool, and avoid screens just before sleeping.",
    ["routine", "insomnia", "bedtime", "screen", "wake", "sleep"],
  ),
  c(
    "sl-3",
    "nhs-sleep",
    "sleep",
    "Caffeine and alcohol",
    "Cut down on caffeine in the afternoon and evening, and avoid heavy meals and alcohol close to bedtime.",
    ["caffeine", "coffee", "alcohol", "evening", "sleep"],
  ),
  c(
    "sl-4",
    "plexecute-safety",
    "sleep",
    "When to see a professional",
    "Persistent insomnia, loud snoring with pauses in breathing, or excessive daytime sleepiness should be discussed with a GP.",
    ["snoring", "apnea", "insomnia", "doctor", "gp"],
  ),
  c(
    "mo-1",
    "nhs-yoga",
    "mobility",
    "Yoga safety",
    "Start with beginner classes, move within a pain-free range, and do not force stretches. Tell an instructor about injuries or pregnancy.",
    ["yoga", "stretch", "mobility", "flexibility", "injury", "pain"],
  ),
  c(
    "mo-2",
    "plexecute-safety",
    "mobility",
    "Pain rule",
    "Sharp, worsening or joint pain means stop that movement. Ordinary muscle soreness that eases over 1 to 3 days is normal.",
    ["pain", "sore", "doms", "injury", "hurt"],
  ),
  c(
    "mi-1",
    "nhs-mindfulness",
    "mindfulness",
    "What mindfulness is",
    "Mindfulness means paying attention to the present moment, your thoughts, feelings and body. It can help some people with wellbeing, but it is not a replacement for treatment; anyone struggling should speak to a GP.",
    ["mindfulness", "meditation", "meditate", "relax", "calm", "stress", "breathing"],
  ),
  c(
    "bc-1",
    "gollwitzer-1999",
    "behaviour",
    "If-then plans",
    "Plans stated as 'When X happens, I will do Y' (implementation intentions) markedly increase follow-through. Plexecute sessions are scheduled with a specific time and place for this reason.",
    ["habit", "plan", "motivation", "procrastinate", "follow through", "consistency"],
  ),
  c(
    "bc-2",
    "lally-2010",
    "behaviour",
    "Habits take time",
    "Habit automaticity took a median of about 66 days in one real-world study, with wide variation. Missing a single day did not meaningfully harm habit formation.",
    ["habit", "days", "missed", "streak", "consistency", "fail"],
  ),
  c(
    "bc-3",
    "lally-2010",
    "behaviour",
    "Never miss twice",
    "A missed session is data, not failure. Repair the day and protect the next occurrence rather than compensating with extra volume.",
    ["missed", "skipped", "guilt", "behind", "catch up", "fell off"],
  ),
  c(
    "co-1",
    "sdt-2000",
    "coaching",
    "Autonomy",
    "Motivation lasts longer when people feel ownership. The coach offers options and asks for the user's choice rather than dictating.",
    ["motivation", "choice", "autonomy", "why"],
  ),
  c(
    "co-2",
    "sdt-2000",
    "coaching",
    "Competence",
    "Small, achievable wins build competence and motivation. When adherence drops, reduce the plan until it is reliably achievable, then build up.",
    ["overwhelmed", "too much", "motivation", "adherence", "reduce"],
  ),
  c(
    "le-1",
    "roediger-2006",
    "learning",
    "Retrieval practice",
    "Testing yourself (recalling without notes) improves long-term retention more than re-reading.",
    ["study", "learn", "revise", "memory", "exam", "read"],
  ),
  c(
    "le-2",
    "cepeda-2006",
    "learning",
    "Spacing",
    "Spreading study across days beats cramming. Review gaps should grow as the material becomes familiar.",
    ["study", "spacing", "cram", "revise", "review", "language"],
  ),
  c(
    "sa-1",
    "plexecute-safety",
    "safety",
    "Not medical advice",
    "Plexecute is a wellness and planning tool for adults (18+). It does not diagnose or treat. Chest pain, fainting or other urgent symptoms need emergency care (UK: 999 or NHS 111).",
    ["medical", "doctor", "diagnose", "chest", "emergency", "medication"],
  ),
  c(
    "sa-2",
    "plexecute-safety",
    "safety",
    "Crisis support",
    "If a user mentions self-harm or suicidal thoughts, the coach stops planning and shares support: UK Samaritans 116 123, or emergency services.",
    ["suicide", "self harm", "hopeless", "crisis", "kill myself"],
  ),
  c(
    "sa-3",
    "plexecute-safety",
    "safety",
    "Your data",
    "Users can download or delete all their data from Settings at any time. Health data is used only to plan and coach.",
    ["privacy", "data", "delete", "gdpr", "export"],
  ),
];

SOURCES.push(...COACHING_SOURCES);
CHUNKS.push(...COACHING_CHUNKS);
SOURCES.push(...EXPANSION_SOURCES);
CHUNKS.push(...EXPANSION_CHUNKS);

const sourceById = new Map(SOURCES.map((s) => [s.source_id, s]));
export const sourceOf = (id: string) => sourceById.get(id)!;

/** Light suffix stemming so "procrastinating" matches "procrastinate", "routines" matches "routine". */
const stem = (w: string) =>
  w.length > 5
    ? w.replace(/(ization|isation|ing|ies|ed|es|s)$/, (m) => (m === "ies" ? "y" : ""))
    : w;

const tokenize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map(stem);

export type Evidence = KnowledgeChunk & {
  trust_tier: TrustTier;
  jurisdiction: string;
  citation_label: string;
  score: number;
};

/** Returns the smallest relevant evidence bundle for a query (V3 §56). Safety chunks always rank first on match. */
export function retrieve(query: string, limit = 4): Evidence[] {
  const q = query.toLowerCase();
  const words = new Set(tokenize(query));
  const tierW: Record<TrustTier, number> = { T1: 1.3, T2: 1.2, T3: 1, T4: 0.8 };
  return CHUNKS.map((ch) => {
    let score = 0;
    for (const k of ch.keywords)
      if (k.includes(" ") ? q.includes(k) : words.has(stem(k)) || q.includes(k)) score += 2;
    for (const w of tokenize(ch.title + " " + ch.text_or_rule)) if (words.has(w)) score += 0.3;
    const src = sourceOf(ch.source_id);
    score *= tierW[src.trust_tier];
    if (ch.domain === "safety" && score >= 2) score += 5;
    return {
      ...ch,
      trust_tier: src.trust_tier,
      jurisdiction: src.jurisdiction,
      citation_label: `${src.publisher}, ${src.published.slice(0, 4)}`,
      score,
    };
  })
    .filter((e) => e.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---- V3 §54–56 grounding rules ----
export const KNOWLEDGE_POLICY_VERSION = "knowledge_v2";
/** Domains where a weaker source must never be used when a stronger one covers the question (V3 §54). */
export const SAFETY_CRITICAL: Domain[] = [
  "safety",
  "weight",
  "sleep",
  "mobility",
  "nutrition",
  "mindfulness",
  "wellbeing",
  "finance",
];
const TIER_RANK: Record<TrustTier, number> = { T1: 1, T2: 2, T3: 3, T4: 4 };

export const cadenceMonths = (s: KnowledgeSource) => parseInt(s.review_cadence, 10) || 12;
export const lastReviewed = (s: KnowledgeSource) => s.last_reviewed ?? s.published;
export const retrievalMethod = (s: KnowledgeSource) => s.retrieval_method ?? "manual_curation";

/** "current" until the review cadence since the last review has passed. today = YYYY-MM-DD. */
export function freshness(
  s: KnowledgeSource,
  today: string,
): { status: "current" | "review_due"; due: string } {
  const d = new Date(lastReviewed(s) + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + cadenceMonths(s));
  const due = d.toISOString().slice(0, 10);
  return { status: due < today ? "review_due" : "current", due };
}

export type Uncertainty = "no_evidence" | "weak_only" | "review_due";
export type EvidenceBundle = {
  evidence: Evidence[];
  uncertainty: Uncertainty[];
  dropped_weaker: number;
  policy_version: string;
};

/** Applies superseded filtering, domain restriction, and safety-critical tier precedence to ranked evidence. */
export function groundBundle(
  ranked: Evidence[],
  opts: { limit?: number; domains?: Domain[]; today: string },
): EvidenceBundle {
  let ev = ranked.filter((e) => !sourceOf(e.source_id).superseded_by);
  if (opts.domains?.length)
    ev = ev.filter((e) => opts.domains!.includes(e.domain) || e.domain === "safety");
  let dropped = 0;
  for (const d of SAFETY_CRITICAL) {
    const inD = ev.filter((e) => e.domain === d);
    if (!inD.length) continue;
    const best = Math.min(...inD.map((e) => TIER_RANK[e.trust_tier]));
    if (best <= 2) {
      const before = ev.length;
      ev = ev.filter(
        (e) =>
          e.domain !== d ||
          TIER_RANK[e.trust_tier] <= 2 ||
          sourceOf(e.source_id).publisher === "Plexecute",
      );
      dropped += before - ev.length;
    }
  }
  ev = ev.slice(0, opts.limit ?? 4);
  const unc: Uncertainty[] = [];
  if (!ev.length) unc.push("no_evidence");
  else if (ev.every((e) => TIER_RANK[e.trust_tier] >= 3)) unc.push("weak_only");
  if (ev.some((e) => freshness(sourceOf(e.source_id), opts.today).status === "review_due"))
    unc.push("review_due");
  return {
    evidence: ev,
    uncertainty: unc,
    dropped_weaker: dropped,
    policy_version: KNOWLEDGE_POLICY_VERSION,
  };
}

export const UNCERTAINTY_TEXT: Record<Uncertainty, string> = {
  no_evidence: "No source in the library covers this, so any answer is not sourced.",
  weak_only: "Only supporting sources cover this; treat it as general context.",
  review_due: "At least one source is past its review date and may be out of date.",
};

/** Lexical retrieval run through the grounding rules. */
export function retrieveGrounded(
  query: string,
  opts: { limit?: number; domains?: Domain[]; today: string },
): EvidenceBundle {
  return groundBundle(retrieve(query, 20), opts);
}
