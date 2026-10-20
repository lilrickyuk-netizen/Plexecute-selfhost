import { describe, expect, it } from "vitest";
import { CHUNKS, SOURCES, retrieveGrounded, sourceOf } from "../src/lib/knowledge";
import { EXPANSION_CHUNKS, EXPANSION_SOURCES } from "../src/lib/knowledge-expansion";

const today = "2026-10-18";
const ids = (q: string) => retrieveGrounded(q, { limit: 3, today }).evidence.map((e) => e.chunk_id);

// One real member question per expanded area; the expected passage must be in the top 3.
const cases: [string, string, string][] = [
  [
    "Behaviour change",
    "I'm a perfectionist and never finish anything because it's never good enough.",
    "kx-bc-4",
  ],
  [
    "Behaviour change",
    "I slipped and now I feel like I've blown it and I'm back to square one.",
    "kx-bc-11",
  ],
  [
    "ADHD & executive function",
    "I have ADHD and can't get started on anything at work.",
    "kx-ef-1",
  ],
  ["ADHD & executive function", "I have time blindness and I'm always late.", "kx-ef-2"],
  [
    "Stress & resilience",
    "I think I'm burnt out from work, I'm exhausted all the time.",
    "kx-st-4",
  ],
  ["Sleep", "I work night shifts and my sleep is a mess.", "kx-sl-5"],
  ["Sleep", "I slept badly last night, how should I adapt today?", "kx-sl-4"],
  [
    "Relationships & family",
    "My partner and I keep having arguments about the same thing.",
    "kx-rf-2",
  ],
  ["Career", "Can you help me write my CV?", "kx-cr-1"],
  ["Career", "I've got a job interview next week, how do I prepare?", "kx-cr-2"],
  [
    "Business",
    "My small business keeps running out of money even though we're busy. Cash flow help?",
    "kx-bz-3",
  ],
  ["Money", "How big should my emergency fund be?", "kx-mn-1"],
  ["Money", "I've got credit card debt and an overdraft, where do I start?", "kx-mn-2"],
  ["Learning", "How do I stop cramming and actually remember what I study?", "kx-ln-2"],
  ["Fitness", "I took three weeks off the gym, have I lost fitness from detraining?", "kx-ft-2"],
  ["Nutrition", "How much fibre should I be eating?", "kx-nu-1"],
  ["Wellness", "Would journalling help me?", "kx-wl-2"],
  ["Smoking & alcohol", "I keep getting cravings for a cigarette since I quit smoking.", "kx-sm-1"],
  ["Smoking & alcohol", "I want to cut down my drinking, how many units is too many?", "kx-sm-5"],
  ["Time management", "I always underestimate how long tasks take.", "kx-tm-1"],
  [
    "Life transitions",
    "We've got a new baby and I'm becoming a parent, how do I keep my goals?",
    "kx-lt-2",
  ],
  ["Home & life admin", "My paperwork and life admin backlog is out of control.", "kx-ha-1"],
  ["Social life & leisure", "I have no time for hobbies or downtime anymore.", "kx-sc-2"],
  ["Goal design", "What's the difference between an outcome goal and a process goal?", "kx-gd-1"],
  ["Failure & recovery", "I've been ill with flu, how do I return to my plan?", "kx-fr-2"],
  ["Communication", "I need to have a difficult conversation with my boss.", "kx-cm-1"],
  ["Personal organisation", "My email inbox is overflowing.", "kx-po-2"],
  ["Coaching judgement", "I don't want a plan, I just want to talk.", "kx-cj-1"],
];

describe("knowledge expansion", () => {
  it("adds sources and passages with full provenance", () => {
    expect(EXPANSION_SOURCES.length).toBeGreaterThanOrEqual(40);
    expect(EXPANSION_CHUNKS.length).toBeGreaterThanOrEqual(130);
    expect(new Set(SOURCES.map((s) => s.source_id)).size).toBe(SOURCES.length);
    expect(new Set(CHUNKS.map((c) => c.chunk_id)).size).toBe(CHUNKS.length);
    for (const c of EXPANSION_CHUNKS) {
      const s = sourceOf(c.source_id);
      expect(s, c.chunk_id).toBeTruthy();
      expect(s.url).toBeTruthy();
      expect(c.subdomain).toBeTruthy();
    }
  });
  it.each(cases)("%s: retrieves the right passage for %s", (_a, q, id) => {
    expect(ids(q)).toContain(id);
  });
  it("crisis safety still ranks first over expanded passages", () => {
    const b = retrieveGrounded("I'm so stressed and hopeless I might kill myself", {
      limit: 3,
      today,
    });
    expect(b.evidence[0]?.domain).toBe("safety");
  });
});
