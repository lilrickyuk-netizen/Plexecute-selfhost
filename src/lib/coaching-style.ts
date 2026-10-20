// V3 §15 Coaching styles (locked). Style changes tone, brevity and challenge level only.
export const COACHING_STYLES = [
  "supportive",
  "direct",
  "disciplined",
  "calm",
  "competitive",
] as const;
export type CoachingStyle = (typeof COACHING_STYLES)[number];

export const STYLE_LABEL: Record<CoachingStyle, string> = {
  supportive: "Supportive",
  direct: "Direct",
  disciplined: "Disciplined",
  calm: "Calm",
  competitive: "Competitive",
};

export const STYLE_HINT: Record<CoachingStyle, string> = {
  supportive: "Warm and encouraging.",
  direct: "Short, clear, no fluff.",
  disciplined: "Structured, firm about doing what you planned.",
  calm: "Steady and unhurried.",
  competitive: "Frames progress as beating your own previous best.",
};

const STYLE_PROMPT: Record<CoachingStyle, string> = {
  supportive:
    "Tone: warm and encouraging. Acknowledge effort before the next step. Gentle challenge.",
  direct: "Tone: short and plain. Lead with the answer and the next action. Moderate challenge.",
  disciplined:
    "Tone: structured and firm. Hold the user to the plan they chose, step by step. High challenge, never harsh.",
  calm: "Tone: steady and unhurried. Fewer, simpler points. Low challenge.",
  competitive:
    "Tone: energetic. Compare only with the user's own previous results. High challenge.",
};

export function normalizeStyle(s: string | null | undefined): CoachingStyle {
  return (COACHING_STYLES as readonly string[]).includes(s ?? "") ? (s as CoachingStyle) : "direct";
}

export const STYLE_BOUNDARIES =
  "Style never changes truth, safety boundaries or what the user's plan allows. In every style never use: insults, humiliation, guilt (including about leaving or not using the app), threats, jealousy or exclusivity, fabricated disappointment, emotional dependency language, diagnosing the user, or presenting unsafe training or diet behaviour as discipline.";

export function stylePrompt(s: string | null | undefined): string {
  return `${STYLE_PROMPT[normalizeStyle(s)]}\n${STYLE_BOUNDARIES}`;
}

// Deterministic backstop on model output for the prohibited categories.
const PROHIBITED: { kind: string; re: RegExp }[] = [
  { kind: "insult", re: /\b(lazy|pathetic|useless|weak-willed|loser|stupid|idiot)\b/i },
  {
    kind: "humiliation",
    re: /\b(embarrass(ing|ed)? yourself|shame on you|you should be ashamed)\b/i,
  },
  {
    kind: "guilt",
    re: /\b(you let (me|yourself) down|after all i('ve)? done|you('re| are) wasting)\b/i,
  },
  { kind: "threat", re: /\b(or else|you('ll| will) regret|i('ll| will) (stop|leave|cancel))\b/i },
  {
    kind: "jealousy",
    re: /\b(only i (understand|can help)|you don'?t need anyone else|other apps? (won'?t|can'?t))\b/i,
  },
  {
    kind: "fabricated_disappointment",
    re: /\b(i('m| am) (so )?disappointed|i('m| am) (sad|hurt) (that|when) you)\b/i,
  },
  {
    kind: "dependency",
    re: /\b(you need me|i('ll| will) miss you|don'?t leave me|without me you)\b/i,
  },
  {
    kind: "diagnosis",
    re: /\byou (have|are suffering from) (depression|anxiety|an eating disorder|adhd|insomnia|ocd)\b/i,
  },
  {
    kind: "unsafe_discipline",
    re: /\b(no pain,? no gain|push through (the )?pain|skip (meals|eating)|starve|train through (an )?injury)\b/i,
  },
];

export function styleViolations(text: string): string[] {
  return PROHIBITED.filter((p) => p.re.test(text)).map((p) => p.kind);
}

export const STYLE_FALLBACK =
  "I can't send that reply as written. Here is the plain version: check today's plan and pick the next session you can do safely.";

/** Coach replies read like a message from a person: no markdown symbols, headings or bold. */
export const MESSAGE_FORMAT =
  'Write like a thoughtful person texting: natural sentences in short paragraphs. Never use markdown, asterisks, bold, italics, headings, tables or code formatting. Only use a simple list (one item per line starting with "• ") when listing three or more separate items.';

export function plainMessage(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/__([^_\n]+?)__/g, "$1")
    .replace(/(^|[^\w*])\*([^*\n]+?)\*(?!\w)/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The model sometimes writes its answer twice (a draft, then a rewrite). Keep only the final version. */
export function dropRepeatedDraft(text: string): string {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length < 2) return text;
  const words = (ps: string[]) =>
    new Set(
      ps
        .join(" ")
        .toLowerCase()
        .replace(/\([^)]*\)/g, " ")
        .match(/[a-z]{4,}/g) ?? [],
    );
  let best = { score: 0, at: 0 };
  for (let i = 1; i < paras.length; i++) {
    const a = words(paras.slice(0, i));
    const b = words(paras.slice(i));
    if (a.size < 25 || b.size < 25) continue;
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    const score = shared / Math.min(a.size, b.size);
    if (score > best.score) best = { score, at: i };
  }
  return best.score >= 0.7 ? paras.slice(best.at).join("\n\n") : text;
}
