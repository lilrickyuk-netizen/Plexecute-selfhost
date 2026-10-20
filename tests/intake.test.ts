import { describe, expect, it } from "vitest";
import {
  applyDefaults,
  commitmentsForPlan,
  goalsForPlan,
  missingQuestions,
  normaliseDraft,
} from "@/lib/intake";
import { buildWeekPlan, commitmentBusy } from "@/lib/scheduler";

const parent = normaliseDraft({
  wake_time: "06:00",
  sleep_time: "23:00",
  work: { days: [1, 2, 3, 4, 5], start: "07:00", end: "16:00" },
  commitments: [
    {
      title: "University",
      kind: "study",
      days: [2, 4],
      on_date: null,
      start_time: null,
      end_time: null,
      protected: false,
    },
    {
      title: "Football",
      kind: "other",
      days: [3],
      on_date: null,
      start_time: "19:00",
      end_time: null,
      protected: false,
    },
    {
      title: "Time with the kids",
      kind: "family",
      days: [6],
      on_date: null,
      start_time: "09:00",
      end_time: "18:00",
      protected: true,
    },
  ],
  goals: [
    {
      title: "Train",
      domain: "training",
      sessions_per_week: 4,
      session_minutes: null,
      preferred_time: "any",
      deadline: null,
      why: null,
    },
    {
      title: "Finish qualification",
      domain: "career",
      sessions_per_week: null,
      session_minutes: null,
      preferred_time: "any",
      deadline: null,
      why: null,
    },
  ],
  health_notes: null,
  nutrition_goal: "lose",
});

describe("conversational intake", () => {
  it("asks only for what is missing", () => {
    const q = missingQuestions(parent).map((x) => x.key);
    expect(q).toEqual(["c:University", "c:Football", "g:Train", "health"].slice(0, 4));
    expect(q).not.toContain("sleep");
    expect(q).not.toContain("work");
  });
  it("asks nothing once complete", () => {
    const done = normaliseDraft({
      ...parent,
      health_notes: "none",
      commitments: parent.commitments.map((c) => ({
        ...c,
        start_time: c.start_time ?? "10:00",
        end_time: c.end_time ?? "21:00",
      })),
      goals: parent.goals.map((g) => ({ ...g, session_minutes: 60 })),
    });
    expect(missingQuestions(done)).toEqual([]);
  });
  it("rejects invalid model output instead of guessing", () => {
    const d = normaliseDraft({
      wake_time: "7am",
      commitments: [{ title: "X", days: [9], kind: "zzz" }],
      goals: [{ title: "" }],
    });
    expect(d.wake_time).toBeNull();
    expect(d.commitments).toHaveLength(0);
    expect(d.goals).toHaveLength(0);
  });
  it("defaults are explicit and recorded", () => {
    const d = applyDefaults(parent);
    expect(d.assumed.length).toBeGreaterThan(0);
    expect(d.commitments.find((c) => c.title === "University")).toBeUndefined();
    expect(d.commitments.find((c) => c.title === "Football")?.end_time).toBe("20:00");
    expect(missingQuestions(d).filter((q) => q.key !== "goals")).toEqual([]);
  });
  it("feeds the deterministic planner, which never overlaps the commitments", () => {
    const d = applyDefaults(parent);
    const cs = commitmentsForPlan(d);
    const plan = buildWeekPlan(
      {
        wake_time: "06:00",
        sleep_time: "23:00",
        work_start: "07:00",
        work_end: "16:00",
        work_days: [1, 2, 3, 4, 5],
        commitments: cs,
        timezone: "UTC",
      },
      goalsForPlan(d),
      new Date("2026-10-12T00:00:00Z"),
    );
    expect(plan.blocks.length).toBeGreaterThan(0);
    for (const b of plan.blocks) {
      const s = new Date(b.starts_at);
      const dow = ((s.getUTCDay() + 6) % 7) + 1;
      const a = s.getUTCHours() * 60 + s.getUTCMinutes();
      const e = a + b.duration_min;
      for (const [x, y] of commitmentBusy(cs, dow, b.starts_at.slice(0, 10)))
        expect(e <= x || a >= y).toBe(true);
    }
  });
});

import { normaliseVision, needsVisionQuestion, EMPTY_DRAFT as EMPTY_V } from "../src/lib/intake";
describe("5-year vision", () => {
  it("counts only real objectives or a confirmed reply; never invents one", () => {
    expect(
      normaliseVision({ answered: true, summary: "Retired life", objectives: [] }).answered,
    ).toBe(false);
    expect(
      normaliseVision({ answered: true, summary: null, objectives: [], _confirmed: true }),
    ).toEqual({ answered: true, summary: null, objectives: [] });
    const v = normaliseVision({
      objectives: [
        { area: "career", text: "Run my own company" },
        { area: "bogus", text: "Own a home" },
      ],
    });
    expect(v.answered).toBe(true);
    expect(v.objectives[1]!.area).toBe("other");
    expect(needsVisionQuestion(EMPTY_V)).toBe(true);
    expect(needsVisionQuestion({ ...EMPTY_V, vision: v })).toBe(false);
  });
});
