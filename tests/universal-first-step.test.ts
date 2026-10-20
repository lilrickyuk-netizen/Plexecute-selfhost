import { describe, it, expect } from "vitest";
import { buildSessionBrief } from "../src/lib/session-brief";
const block = (domain: string, kind: string) => ({
  id: "b",
  title: "Session",
  occurrence_kind: kind,
  domain,
  status: "planned",
  starts_at: "2026-10-14T09:00:00Z",
  duration_min: 45,
  goal_id: "g",
  commitment_id: null,
});
const ms = (sources: unknown[] = []) => [
  {
    id: "m",
    key: "s1",
    title: "Beekeeping foundations",
    status: "active",
    stage: 1,
    position: 0,
    depends_on: [],
    actions: [{ title: "List the equipment a first hive needs and its cost", minutes: 45 }],
    sources,
    evidence_type: "user_confirms",
    blocked_reason: null,
  },
];
describe("universal first step", () => {
  it("novel learning goal without a starter is executable from its prepared pathway", () => {
    const s = buildSessionBrief({
      block: block("learning", "learning"),
      goal: {
        id: "g",
        title: "Learn beekeeping",
        why: null,
        success_definition: null,
        domain: "learning",
      },
      milestones: ms(),
    });
    expect(s.objective).toContain("equipment");
    expect(s.primary.type).toBe("start");
    expect(s.missing).toEqual([]);
    expect(s.resources).toEqual([]);
  });
  it("resource-free non-learning goal gets a concrete behavioural step", () => {
    const s = buildSessionBrief({
      block: block("wellness", "task"),
      goal: {
        id: "g",
        title: "Improve my confidence",
        why: null,
        success_definition: null,
        domain: "wellness",
      },
      milestones: ms(),
    });
    expect(s.ready).toBe(true);
    expect(s.primary.label).not.toMatch(/pathway/i);
  });
  it("uses only researched links", () => {
    const s = buildSessionBrief({
      block: block("learning", "learning"),
      goal: {
        id: "g",
        title: "Learn beekeeping",
        why: null,
        success_definition: null,
        domain: "learning",
      },
      milestones: ms([
        {
          url: "https://www.bbka.org.uk/",
          title: "BBKA",
          publisher: "British Beekeepers Association",
        },
      ]),
    });
    expect(s.resources[0]?.url).toBe("https://www.bbka.org.uk/");
  });
});
