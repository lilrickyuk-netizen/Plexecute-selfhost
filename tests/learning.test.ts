import { describe, it, expect } from "vitest";
import { nextReview, syllabusProgress } from "../src/lib/learning";
describe("learning engine", () => {
  it("success advances 1→3→7→14→30 and stays", () => {
    expect(nextReview(0, true)).toEqual({ toStep: 1, days: 3 });
    expect(nextReview(3, true)).toEqual({ toStep: 4, days: 30 });
    expect(nextReview(4, true).days).toBe(30);
  });
  it("failure reduces the interval", () => {
    expect(nextReview(3, false)).toEqual({ toStep: 2, days: 7 });
    expect(nextReview(0, false)).toEqual({ toStep: 0, days: 1 });
  });
  it("syllabus counts leaves", () => {
    expect(
      syllabusProgress([
        { id: "a", parent_id: null, done_at: null },
        { id: "b", parent_id: "a", done_at: "x" },
        { id: "c", parent_id: "a", done_at: null },
      ]),
    ).toMatchObject({ done: 1, total: 2, pct: 50 });
  });
});
