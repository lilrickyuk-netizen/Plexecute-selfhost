import { describe, it, expect } from "vitest";
import { isActionableResearch, splitIntents } from "../src/lib/learning-subject";
import { readFileSync } from "node:fs";

describe("actionable research vs question", () => {
  it("find places to promote my waiting list is execution", () => {
    const p = splitIntents(
      "I want to learn organic marketing and find free places to promote my waiting list.",
    ).find((x) => x.system === "research_execution");
    expect(p && isActionableResearch(p.text)).toBe(true);
  });
  it("what places can I promote this is research only", () => {
    expect(isActionableResearch("What places can I promote this?")).toBe(false);
  });
});

describe("meal plan creates no unrequested schedule items", () => {
  it("meal tools do not trigger a whole-week rebuild", () => {
    const src = readFileSync("src/lib/coach.functions.ts", "utf8");
    const set = src.slice(
      src.indexOf("const RESHAPES"),
      src.indexOf("]);", src.indexOf("const RESHAPES")),
    );
    expect(set).not.toContain('"plan_meal_prep"');
    expect(set).not.toContain('"schedule_meals"');
  });
});
