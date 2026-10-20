// V3 §20.1 current-source research helpers. Pure.
export const RESEARCH_POLICY_VERSION = "source_sufficiency_v2";
export type Trust = "official" | "education" | "professional_body" | "provider" | "other";
export const TRUST_LABEL: Record<Trust, string> = {
  official: "Official / government",
  education: "University or college",
  professional_body: "Professional or awarding body",
  provider: "Course provider",
  other: "Other website (check carefully)",
};
export const CATEGORIES = [
  "qualification",
  "awarding_body",
  "pathway",
  "course",
  "provider",
  "prerequisite",
  "exam_structure",
  "registration",
  "skills",
  "guidance",
  "resource",
  "deadline",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  qualification: "Qualification",
  awarding_body: "Awarding body",
  pathway: "Pathway",
  course: "Course",
  provider: "Training provider",
  prerequisite: "Prerequisite",
  exam_structure: "Exam structure",
  registration: "Registration / licensing",
  skills: "Role skills",
  guidance: "Professional guidance",
  resource: "Resource",
  deadline: "Deadline / enrolment / renewal",
};

/** Recognised UK professional, regulatory and awarding bodies on .com/.org domains (domain match only). */
const PROFESSIONAL_BODIES = [
  "icaew.com",
  "accaglobal.com",
  "cimaglobal.com",
  "aat.org.uk",
  "icas.com",
  "cipfa.org",
  "sra.org.uk",
  "barstandardsboard.org.uk",
  "lawsociety.org.uk",
  "gmc-uk.org",
  "nmc.org.uk",
  "hcpc-uk.org",
  "engc.org.uk",
  "theiet.org",
  "imeche.org",
  "ice.org.uk",
  "rics.org",
  "architects-register.org.uk",
  "cipd.org",
  "cii.co.uk",
  "cisi.org",
  "bcs.org",
  "pharmacyregulation.org",
  "gdc-uk.org",
  "cityandguilds.com",
  "pearson.com",
  "aqa.org.uk",
  "ocr.org.uk",
];
/** Open-edit or aggregator sites: never treated as authorities. */
const NON_AUTHORITY = /(^|\.)(wikipedia|wikihow|reddit|quora|medium|fandom)\.(org|com)$/;
/** Trust class from the publisher's domain only; never from page claims. */
export function trustOf(url: string): { publisher: string; trust: Trust } {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { publisher: url.slice(0, 80), trust: "other" };
  }
  if (NON_AUTHORITY.test(host)) return { publisher: host, trust: "other" };
  if (PROFESSIONAL_BODIES.some((d) => host === d || host.endsWith("." + d)))
    return { publisher: host, trust: "professional_body" };
  const t: Trust =
    /((^|\.)gov(\.[a-z]{2})?|\.gouv\.[a-z]{2}|\.gc\.ca|\.nhs\.uk|\.europa\.eu)$/.test(host)
      ? "official"
      : /(\.ac\.[a-z]{2}|\.edu(\.[a-z]{2})?)$/.test(host)
        ? "education"
        : /(\.org\.uk|\.org)$/.test(host)
          ? "professional_body"
          : "provider";
  return {
    publisher: host,
    trust:
      t === "provider" &&
      !/(course|learn|academy|training|college|school|udemy|coursera|edx|futurelearn)/.test(host)
        ? "other"
        : t,
  };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
/** A finding counts as sourced only when its quote appears verbatim in the fetched page text. */
export function quoteVerified(quote: string, pageText: string) {
  const q = norm(quote);
  return q.length >= 12 && norm(pageText).includes(q);
}

/** Research for places/channels to promote something (not rules or requirements). */
export function isChannelQuery(q: string): boolean {
  return /\b(promot\w*|advertis\w*|market(ing)?|waiting ?list|waitlist|launch|get (users|signups|customers)|where (can|to) (i )?(post|share|list))\b/i.test(
    String(q ?? ""),
  );
}

/** Only a product that serves a physical area should be shown local directories. */
export function isLocalProduct(context: string): boolean {
  return /\b(local|shop|caf[eé]|restaurant|salon|gym|clinic|plumb\w*|in-person|near me|town|city|high street|bakery|studio|store)\b/i.test(
    String(context ?? ""),
  );
}

const LOCAL_DIRECTORY =
  /(^|\.)(yelp\.[a-z.]+|yell\.com|bing\.com\/(places|forbusiness)|business\.google\.com|google\.com\/business|thomsonlocal|freeindex|cylex|hotfrog|foursquare|brownbook|scoot\.co\.uk|192\.com|bark\.com|nextdoor\.com|tripadvisor\.)/i;
export function isLocalDirectory(url: string): boolean {
  return LOCAL_DIRECTORY.test(String(url ?? "").replace(/^https?:\/\//, ""));
}

/** Channel searches describe the product and audience, never "<country> requirements". */
export function researchSearchQuery(query: string, jurisdiction: string, context = ""): string {
  const q = query.trim();
  const local = !isChannelQuery(q) || isLocalProduct(context || q);
  const region =
    local && jurisdiction && !q.toLowerCase().includes(jurisdiction.toLowerCase())
      ? ` ${jurisdiction}`
      : "";
  // Preserve the actual request. Never inject a product, stage, audience or qualification framing.
  const detail = context.trim().slice(0, 160);
  return `${q}${detail && !q.toLowerCase().includes(detail.toLowerCase()) ? ` ${detail}` : ""}${region}`;
}

/** A discovery question may ask us to find options without authorising a plan or tasks. */
export function isInformationOnly(text: string): boolean {
  const t = text.toLowerCase().replace(/[’]/g, "'").trim();
  if (
    /\binformation only\b/.test(t) &&
    /\b(do not|don't) (schedule|change|add|create|build)\b/.test(t)
  )
    return true;
  if (
    /\b(schedule|book|reserve|order|add to|put .{0,30} on|build me|make me|create .{0,30} plan|start learning|i want to learn|i need to learn|teach me|help me learn)\b/.test(
      t,
    )
  )
    return false;
  return (
    /^(what|why|how|where|which|is|are|do|does|should|find|search|research|compare|explain)\b/.test(
      t,
    ) ||
    /\b(advice|what should|how (should|could|can|do) (i|we)|what qualifications|what courses|where (can|could)|what is the difference)\b/.test(
      t,
    )
  );
}

export const CHANNEL_RANKING_RULES =
  "Rank options by evidenced fit to the actual subject and audience, relevant usage rules and expected usefulness. Location matters only for a local request. Free is a constraint, not evidence of fit. Name only options present in sources; never inject a subject, product stage or audience.";

/** Personal records are relevant to a personal-state question, not to a general definition or discovery. */
export function needsMemberContext(text: string): boolean {
  // Any first-person question ("How many calories have I eaten?", "What have I got tomorrow?") is about the member's own data.
  return /\b(i|me|my|mine|i'm|i've|i'd|myself|for me|based on|our|we have)\b/i.test(text);
}

export type ResearchQuery = { query: string; category: string };
/** Bound fan-out and deduplicate wording; category choice belongs to the actual question, not a subject template. */
export function researchQueries(value: unknown, fallback: string, limit = 5): ResearchQuery[] {
  const seen = new Set<string>();
  const out: ResearchQuery[] = [];
  for (const raw of Array.isArray(value) ? value : []) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Record<string, unknown>;
    if (typeof v["query"] !== "string") continue;
    const query = v["query"].trim().slice(0, 300);
    const key = query.toLowerCase().replace(/\s+/g, " ");
    if (query.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push({
      query,
      category: typeof v["category"] === "string" ? v["category"].slice(0, 80) : "general",
    });
    if (out.length >= limit) break;
  }
  return out.length ? out : [{ query: fallback, category: "general" }];
}

export function researchSourceType(url: string): string {
  const trust = trustOf(url).trust;
  if (trust !== "other" && trust !== "provider") return trust;
  try {
    const host = new URL(url).hostname;
    if (/jobs?|careers?|vacanc|recruit|indeed|glassdoor|reed|totaljobs/i.test(url))
      return "employer_or_job_listing";
    if (/reddit|ycombinator|indiehackers|forum|community/i.test(host)) return "community_or_forum";
  } catch {
    return "other";
  }
  return trust;
}

export function researchSourceKey(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|srsltid|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString().replace(/\/$/, "");
}

/** Share discovery reading budget; original pages remain available for quote validation. */
export function researchEvidenceText(
  pages: { url: string; title?: string; markdown?: string; category?: string }[],
  employerDemand = false,
): string {
  const perPage = employerDemand
    ? 14000
    : Math.min(4200, Math.floor(48000 / Math.max(1, pages.length)));
  return pages
    .map(
      (p, i) =>
        `[${i}] ${p.url}\nType hint: ${researchSourceType(p.url)}; search category: ${p.category ?? "general"}\n${p.title ?? ""}\n${(p.markdown ?? "").slice(0, perPage)}`,
    )
    .join("\n\n");
}

/** Preserve attributable research when the conversational summary drops every URL. No new claims are added. */
export function retainResearchLinks(reply: string, sources: string[]): string {
  // Coach owns the answer: never append a source dump. Only when the reply cites nothing, add the single best source inline.
  if (/https?:\/\//.test(reply)) return reply;
  const url = [...new Set(sources)]
    .filter((u) => /^https?:\/\//.test(u))
    .sort(
      (a, b) =>
        Number(/jobs?|vacanc|jobadvert/i.test(b)) - Number(/jobs?|vacanc|jobadvert/i.test(a)),
    )[0];
  if (!url) return reply;
  return `${reply}\n\nSource: [${new URL(url).hostname.replace(/^www\./, "")}](${url})`;
}
