// Picks the few knowledge passages relevant to one Coach message, deterministically and without a model call.
import { retrieveGrounded, sourceOf, type Domain } from "./knowledge";

const KIND_LABEL = {
  research: "research",
  official_guidance: "official guidance",
  coaching_technique: "coaching technique",
} as const;

export function coachingBrief(message: string, today: string, limit = 3, domains?: Domain[]) {
  const b = retrieveGrounded(message, { limit, today, ...(domains?.length ? { domains } : {}) });
  if (!b.evidence.length) return { text: "", refs: [] as string[] };
  const lines = b.evidence.map((e) => {
    const kind = KIND_LABEL[sourceOf(e.source_id).evidence_kind ?? "research"];
    return `- ${e.title} (${kind}; cite as [${e.citation_label}]): ${e.text_or_rule}`;
  });
  return {
    text: `Relevant coaching knowledge for this message (use if it helps, cite what you use):\n${lines.join("\n")}`,
    refs: b.evidence.map((e) => e.chunk_id),
  };
}
