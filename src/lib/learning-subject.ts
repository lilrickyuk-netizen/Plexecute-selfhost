/** Normalised subject key so "Learn Spanish", "spanish" and "learning Spanish" are one pathway. */
export function learningSubjectKey(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(
      /\b(i|want|to|learn|learning|study|studying|how|about|the|a|an|some|more|start|starting|basics?|of|in|for my app|for my business)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Learning intent: the member wants to learn/study a subject (not a capability question). */
export function isLearningIntent(text: string): boolean {
  const t = text.toLowerCase();
  if (
    /\b(can you|could you|are you able|do you)\b.*\b(help|teach)\b.*\?\s*$/.test(t) &&
    !/\bwant\b/.test(t)
  )
    return false;
  return /\b(i want to|i'd like to|i would like to|i need to|help me|teach me|i wanna|i'm going to|i am going to)\s+(start\s+)?(learn|learning|study|get better at)\b/.test(
    t,
  );
}

export type IntentSystem = "learning" | "nutrition" | "research_execution";
export type IntentPart = { text: string; system: IntentSystem; subject?: string };

/**
 * Splits one message into its separate requests ("learn X and find Y") so Coach handles every
 * intent, not only the first. Same-system clauses merge into one part; returns [] when nothing
 * actionable is found. Deterministic so routing is testable.
 */
export function splitIntents(text: string): IntentPart[] {
  const raw = String(text ?? "")
    .replace(/[’]/g, "'")
    .trim();
  const clauses = raw
    .split(
      /\s*(?:[.;!?]\s+|,\s*(?:and\s+)?|\s+(?:and|also|plus|then)\s+)(?=(?:also\s+)?(?:i\s+(?:want|need|'d like|would like|wanna)|find|make|help|get|build|show|tell|where|what|which|create|put|give|search|look|sort|plan|book|i\s+can)\b)/i,
    )
    .map((c) => c.trim())
    .filter((c) => c.length > 2);
  const out: IntentPart[] = [];
  for (const c of clauses) {
    const t = c.toLowerCase();
    let system: IntentSystem | null = null;
    if (
      /\b(meal ?plans?|diet plan|eat (better|healthier|more|less|well)|healthy eating|nutrition|calories|meals?)\b/.test(
        t,
      )
    )
      system = "nutrition";
    else if (isLearningIntent(c) || /^(also\s+)?(learn|study)\b/.test(t)) system = "learning";
    else if (
      /\b(find|where|search|look (for|up)|research|which|qualifications?|certifications?|courses?|promote|places|free|put my|list my|providers?)\b/.test(
        t,
      )
    )
      system = "research_execution";
    if (!system) continue;
    const prev = out.find((p) => p.system === system);
    if (prev) {
      prev.text += ` and ${c}`;
      continue;
    }
    const part: IntentPart = { text: c, system };
    if (system === "learning") {
      const m = c.match(/\b(?:learn(?:ing)?|study(?:ing)?|get better at)\s+(.+)$/i);
      if (m) part.subject = (m[1] ?? "").replace(/[.!?]+$/, "").trim();
    }
    out.push(part);
  }
  return out;
}

/** "Find places to promote my waiting list" is something to do (research then tasks); "What places can I promote this?" is a question (research only). */
export function isActionableResearch(text: string): boolean {
  const t = String(text ?? "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .trim();
  if (/^(what|which|where|how|can|could|is|are|do|does|should)\b/.test(t) || /\?\s*$/.test(t))
    return false;
  return /\b(promote|advertise|market|post|list|put|share|launch|apply|start|sign up|enrol|enroll|submit|pitch)\b/.test(
    t,
  );
}
