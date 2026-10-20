import { describe, expect, it } from "vitest";
import { CHUNKS, SOURCES, DOMAIN_LABEL, retrieveGrounded, sourceOf } from "../src/lib/knowledge";
import { coachingBrief } from "../src/lib/coaching-brief";
import { outputViolations } from "../src/lib/safety";

const today = "2026-10-12";
const top = (q: string) => retrieveGrounded(q, { limit: 3, today }).evidence.map((e) => e.domain);

describe("coaching knowledge library", () => {
  it("every chunk has a known source and every domain has a label", () => {
    const ids = new Set(SOURCES.map((s) => s.source_id));
    expect(ids.size).toBe(SOURCES.length);
    for (const c of CHUNKS) {
      expect(ids.has(c.source_id)).toBe(true);
      expect(DOMAIN_LABEL[c.domain]).toBeTruthy();
    }
    expect(new Set(CHUNKS.map((c) => c.chunk_id)).size).toBe(CHUNKS.length);
  });
  it("Plexecute techniques are never labelled as research", () => {
    for (const s of SOURCES.filter((s) => s.publisher === "Plexecute" && s.evidence_kind))
      expect(s.evidence_kind).toBe("coaching_technique");
  });
  const cases: [string, string][] = [
    ["I have no discipline and keep giving up on my goals.", "personal_development"],
    ["I work full time and want to start university.", "learning"],
    ["Help me improve my finances and save £5,000.", "finance"],
    ["I keep missing workouts because I'm exhausted after work.", "activity"],
    ["I want to change careers but don't know where to start.", "career"],
    ["I struggle with confidence before football matches.", "sports_psychology"],
    ["Help me eat healthier without spending hours cooking.", "nutrition"],
    ["I'm overwhelmed with work and family responsibilities.", "wellbeing"],
    ["I want to improve my sleep routine.", "sleep"],
    ["Help me build better study habits.", "learning"],
    ["I've missed three days of my plan. What should I do?", "motivation"],
    ["I want to become a better communicator and leader.", "career"],
    ["Help me make a major life decision.", "decisions"],
    ["I need help staying consistent with my long-term goals.", "goals"],
    ["I want to start a business while keeping my job.", "business"],
    ["How do I manage a project with a tight deadline?", "business"],
    ["I was made redundant last week. What now?", "transitions"],
    ["Teach me a breathing exercise to calm down.", "mindfulness"],
    ["I'm stiff from sitting at a desk all day.", "mobility"],
    ["I'm a complete beginner and want to start running.", "activity"],
    ["I want to get stronger at home with no equipment.", "resistance_training"],
    ["I can't decide whether to quit my job.", "decisions"],
    ["How do I find a job? My applications go nowhere.", "career"],
    ["I never see my kids because of work.", "relationships"],
    ["I feel like an imposter at work.", "wellbeing"],
  ];
  it.each(cases)("retrieves the right domain for %s", (q, d) => {
    expect(top(q)).toContain(d);
  });
  it("brief is small and tracked by chunk id", () => {
    const b = coachingBrief("Help me build better study habits.", today);
    expect(b.refs.length).toBeGreaterThan(0);
    expect(b.refs.length).toBeLessThanOrEqual(3);
    expect(b.text.length).toBeLessThan(2000);
  });
  it("unrelated chat adds no knowledge", () => {
    expect(coachingBrief("ok thanks", today).text).toBe("");
  });
  it("blocks regulated product recommendations but allows budgeting help", () => {
    expect(outputViolations("You should invest in index funds right away.")).toContain(
      "regulated_finance",
    );
    expect(outputViolations("I recommend you buy shares in Tesla.")).toContain("regulated_finance");
    expect(
      outputViolations("Set up an automatic transfer of £200 on payday into savings."),
    ).not.toContain("regulated_finance");
  });
  it("sources keep attribution and review dates", () => {
    for (const s of SOURCES) expect(sourceOf(s.source_id).url).toBeTruthy();
  });
});
