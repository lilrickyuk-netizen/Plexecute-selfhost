import { describe, expect, it } from "vitest";
import { triageEvening, type TriageItem } from "../src/lib/evening-triage";
import { evidenceState, knowledgeBlock } from "../src/lib/knowledge.server";

const it0 = (
  o: Partial<TriageItem> & { id: string; start: number; minutes: number },
): TriageItem => ({
  title: o.id,
  isProtected: false,
  goalPriority: 3,
  deadlineDays: null,
  onMission: false,
  kind: "work_task",
  ...o,
});

describe("evening triage", () => {
  const items = [
    it0({ id: "pricing", start: 1020, minutes: 90, goalPriority: 5, deadlineDays: 1 }),
    it0({ id: "spanish", start: 1230, minutes: 45, goalPriority: 3 }),
    it0({ id: "kitchen", start: 1275, minutes: 45, goalPriority: 1 }),
    it0({ id: "review", start: 1290, minutes: 60, goalPriority: 5, deadlineDays: 1 }),
  ];
  const r = triageEvening(items, { startMin: 950, endMin: 1350, busy: [[945, 1215]] });

  it("uses real free minutes around commitments", () => {
    expect(r.freeMinutes).toBe(135);
    expect(r.plannedMinutes).toBe(240);
  });
  it("keeps deadline work first and never places it over a commitment or in the past", () => {
    expect(r.keep.map((k) => k.id)).toContain("pricing");
    for (const k of r.keep) {
      expect(k.newStart).toBeGreaterThanOrEqual(1215);
      expect(k.newStart + k.minutes).toBeLessThanOrEqual(1350);
    }
  });
  it("moves, never drops, everything else", () => {
    expect(r.keep.length + r.move.length).toBe(items.length);
    expect(r.move.map((m) => m.id)).toContain("kitchen");
  });
  it("keeps everything when it fits", () => {
    const f = triageEvening(items.slice(1, 3), { startMin: 1200, endMin: 1350, busy: [] });
    expect(f.move).toHaveLength(0);
  });
});

describe("evidence states", () => {
  it("separates found, none and failed", () => {
    expect(evidenceState({ status: "ok", evidence: [{} as never] })).toBe("KNOWLEDGE_FOUND");
    expect(evidenceState({ status: "empty", evidence: [] })).toBe("NO_RELEVANT_KNOWLEDGE");
    expect(evidenceState({ status: "unavailable", evidence: [] })).toBe(
      "KNOWLEDGE_RETRIEVAL_FAILED",
    );
  });
  it("prompt wording never conflates no-match with failure", () => {
    const none = knowledgeBlock({ status: "empty", method: "none", domains: [], evidence: [] });
    expect(none).toContain("NO_RELEVANT_KNOWLEDGE");
    expect(none).toMatch(/does not contain sourced guidance/);
    expect(none).toMatch(/never say you couldn't retrieve/);
    const fail = knowledgeBlock({
      status: "unavailable",
      method: "none",
      domains: [],
      evidence: [],
    });
    expect(fail).toContain("KNOWLEDGE_RETRIEVAL_FAILED");
    expect(fail).toMatch(/never say no evidence exists/);
    expect(fail).toMatch(/DETERMINISTIC PLANNING RULE/);
  });
});
