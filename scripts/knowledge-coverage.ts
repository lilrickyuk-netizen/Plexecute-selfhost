// Generates docs/KNOWLEDGE_COVERAGE.md: per-domain sources, passages, subtopics and trust tiers.
// Run: bun scripts/knowledge-coverage.ts
import { writeFileSync } from "node:fs";
import {
  CHUNKS,
  SOURCES,
  DOMAIN_LABEL,
  freshness,
  sourceOf,
  type Domain,
} from "../src/lib/knowledge";

const today = new Date().toISOString().slice(0, 10);
const domains = Object.keys(DOMAIN_LABEL) as Domain[];
const lines: string[] = [
  "# Knowledge coverage report",
  "",
  `Generated ${today} by scripts/knowledge-coverage.ts. Evergreen domains only; current information (jobs, prices, regulations, opening hours) is deliberately served by live research, not this library.`,
  "",
  "| Domain | Sources | Passages | Depth | Strongest tier | Subtopics covered |",
  "| --- | --- | --- | --- | --- | --- |",
];
const weak: string[] = [];
for (const d of domains) {
  const chunks = CHUNKS.filter((c) => c.domain === d);
  const srcIds = [...new Set(chunks.map((c) => c.source_id))];
  const srcs = srcIds.map(sourceOf);
  const best = srcs.map((s) => s.trust_tier).sort()[0] ?? "—";
  const subs = [...new Set(chunks.map((c) => c.subdomain ?? c.title))].join("; ");
  const depth =
    chunks.length >= 15
      ? "Deep"
      : chunks.length >= 8
        ? "Good"
        : chunks.length >= 4
          ? "Moderate"
          : "Thin";
  lines.push(
    `| ${DOMAIN_LABEL[d]} | ${srcIds.length} | ${chunks.length} | ${depth} | ${best} | ${subs} |`,
  );
  if (
    chunks.length < 3 ||
    (best !== "T1" && best !== "T2" && !srcIds.includes("plexecute-coaching-practice"))
  )
    weak.push(DOMAIN_LABEL[d]);
}
const due = SOURCES.filter((s) => freshness(s, today).status === "review_due");
lines.push(
  "",
  `Totals: ${SOURCES.length} sources, ${CHUNKS.length} passages across ${domains.length} domains.`,
  "",
  weak.length
    ? `Weak domains (<3 passages or no T1/T2 source): ${weak.join(", ")}.`
    : "No weak domains: every domain has at least 3 passages and a T1/T2 or Plexecute practice source.",
  "",
  due.length
    ? `Sources past review date: ${due.map((s) => s.source_id).join(", ")}.`
    : "All sources within their review cadence.",
  "",
  "## 2026-10-18 expansion",
  "",
  "Before: 47 sources, 92 passages. Strengthened: behaviour change and psychology, ADHD and executive function (productivity), stress and resilience, sleep, relationships and communication, career, business, money, learning, fitness, nutrition, wellness, smoking and alcohol (habits), time management, life transitions, home and life admin, social life and leisure, goal design, failure and recovery, personal organisation and coaching judgement. Areas without their own domain carry a subdomain on each passage.",
  "",
  "Comparatively thin: yoga and mobility, weight management, sports psychology, decision-making, and safety (safety responses are driven by the safety engine, not this library). Home admin, social life, failure recovery and coaching judgement rely mainly on Plexecute practice notes because few authoritative external sources exist.",
  "",
  "Stable vs live boundary: this library holds evergreen principles only. Current qualifications, vacancies, prices, regulations, businesses, communities, posting rules, travel and opening hours are answered by live research (src/lib/research.functions.ts), never by stored facts.",
);
writeFileSync("docs/KNOWLEDGE_COVERAGE.md", lines.join("\n") + "\n");
console.log(
  `wrote docs/KNOWLEDGE_COVERAGE.md (${SOURCES.length} sources, ${CHUNKS.length} passages)`,
);
