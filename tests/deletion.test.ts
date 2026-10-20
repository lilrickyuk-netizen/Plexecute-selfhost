import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { describeImpact } from "../src/lib/deletion.server";
import { COACH_ACTION_TOOLS, CONFIRM_KINDS } from "../src/lib/coach-action-names";

describe("member deletion of goals and plans", () => {
  it("Coach deletes only through confirm-first actions", () => {
    expect(COACH_ACTION_TOOLS).toContain("delete_goal");
    expect(COACH_ACTION_TOOLS).toContain("delete_plan");
    expect(CONFIRM_KINDS).toContain("delete_goal");
    expect(CONFIRM_KINDS).toContain("delete_plan");
  });
  it("screens and Coach share one deletion implementation", () => {
    const coach = readFileSync("src/lib/coach-actions.server.ts", "utf8");
    const fns = readFileSync("src/lib/deletion.functions.ts", "utf8");
    for (const s of [coach, fns]) expect(s).toMatch(/deletion\.server/);
    expect(fns).toMatch(/confirm: z\.literal\(true\)/);
    expect(readFileSync("src/routes/_authenticated/app.goals.tsx", "utf8")).not.toMatch(
      /from\("goals"\)\.delete\(\)/,
    );
  });
  it("describes what is removed and kept in plain words", () => {
    const t = describeImpact({
      removes: { milestones: 2, upcoming_sessions: 1, progress_entries: 3, calls: 0 },
      keeps: { finished_sessions: 1 },
    });
    expect(t.removes).toEqual(["2 milestones", "1 upcoming session", "3 progress entries"]);
    expect(t.keeps).toEqual(["1 finished or past session"]);
  });
});
