import { describe, it, expect } from "vitest";
import {
  groundBundle,
  retrieveGrounded,
  freshness,
  sourceOf,
  SOURCES,
  CHUNKS,
  type Evidence,
} from "../src/lib/knowledge";
const today = "2026-10-01";
describe("knowledge grounding", () => {
  it("every chunk has a source with licence and trust tier", () => {
    for (const c of CHUNKS) {
      const s = sourceOf(c.source_id);
      expect(s.rights).toBeTruthy();
      expect(s.trust_tier).toMatch(/T[1-4]/);
    }
  });
  it("drops weaker sources on safety-critical domains when T1/T2 present", () => {
    const base = CHUNKS.find((c) => c.chunk_id === "sl-1")!;
    const strong: Evidence = {
      ...base,
      trust_tier: "T1",
      jurisdiction: "UK",
      citation_label: "x",
      score: 5,
    };
    const weak: Evidence = {
      ...base,
      chunk_id: "weak",
      source_id: "aasm-sleep-2015",
      trust_tier: "T4",
      jurisdiction: "UK",
      citation_label: "y",
      score: 9,
    };
    const b = groundBundle([weak, strong], { today });
    expect(b.evidence.map((e) => e.chunk_id)).not.toContain("weak");
    expect(b.dropped_weaker).toBe(1);
  });
  it("reports no evidence as uncertainty", () => {
    expect(retrieveGrounded("zzzz qqqq", { today }).uncertainty).toContain("no_evidence");
  });
  it("flags sources past review", () => {
    const source = SOURCES[0];
    if (!source) throw new Error("Expected a knowledge source");
    const old = { ...source, last_reviewed: "2020-01-01", review_cadence: "12 months" };
    expect(freshness(old, today).status).toBe("review_due");
    expect(freshness({ ...old, last_reviewed: "2026-10-01" }, today).status).toBe("current");
  });
  it("domain restriction keeps safety", () => {
    const b = retrieveGrounded("protein chest pain emergency", { today, domains: ["nutrition"] });
    expect(b.evidence.every((e) => e.domain === "nutrition" || e.domain === "safety")).toBe(true);
  });
});
