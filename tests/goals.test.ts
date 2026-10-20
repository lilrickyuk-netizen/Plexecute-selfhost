import { describe, it, expect } from "vitest";
import { goalProgress, planningGoals, createsCycle } from "../src/lib/goals";

describe("goal model", () => {
  it("measures progress in both directions and clamps", () => {
    expect(goalProgress(2, 6, 10)).toBe(0.5);
    expect(goalProgress(90, 85, 80)).toBe(0.5);
    expect(goalProgress(2, 12, 10)).toBe(1);
    expect(goalProgress(null, 5, 10)).toBeNull();
  });
  it("holds goals waiting on unfinished dependencies and plans protected first", () => {
    const goals = [
      { id: "a", title: "A", status: "active", priority: 5 },
      { id: "b", title: "B", status: "active", dependencies: ["a"] },
      { id: "c", title: "C", status: "active", is_protected: true, priority: 1 },
      { id: "d", title: "D", status: "completed" },
      { id: "e", title: "E", status: "active", dependencies: ["d"] },
    ];
    const r = planningGoals(goals);
    expect(r.ready.map((g) => g.id)).toEqual(["c", "a", "e"]);
    expect(r.waiting[0]).toMatchObject({ goal: { id: "b" }, waitingOn: ["A"] });
  });
  it("detects dependency cycles", () => {
    const goals = [
      { id: "a", title: "A", status: "active", dependencies: ["b"] },
      { id: "b", title: "B", status: "active" },
    ];
    expect(createsCycle(goals, "b", "a")).toBe(true);
    expect(createsCycle(goals, "a", "b")).toBe(false);
  });
});

import { feasibilityReport } from "../src/lib/scheduler";
describe("feasibility engine", () => {
  const p = {
    wake_time: "07:00",
    sleep_time: "23:00",
    work_start: "09:00",
    work_end: "17:00",
    work_days: [1, 2, 3, 4, 5],
  };
  const ws = new Date(2026, 9, 5);
  it("reports feasible when goals fit", () => {
    const r = feasibilityReport(
      p,
      [
        {
          id: "a",
          title: "A",
          domain: "training",
          weekly_minutes: 120,
          session_minutes: 40,
          preferred_time: "any",
          minimum_weekly_minutes: 60,
        },
      ],
      ws,
    );
    expect(r.level).toBe("feasible");
    expect(r.capacity.work_min).toBe(2400);
    expect(r.capacity.usable_min).toBeGreaterThan(0);
  });
  it("reports the real shortfall and never fabricates time", () => {
    const r = feasibilityReport(
      p,
      [
        {
          id: "a",
          title: "A",
          domain: "learning",
          weekly_minutes: 5000,
          session_minutes: 240,
          preferred_time: "any",
          minimum_weekly_minutes: 4000,
        },
      ],
      ws,
    );
    expect(r.level).toBe("infeasible");
    expect(r.goals[0]!.placed_min).toBeLessThanOrEqual(r.capacity.usable_min);
    expect(r.shortfall_min).toBe(4000 - r.goals[0]!.placed_min);
  });
});

import { buildWeekPlan, adherenceByHour } from "../src/lib/scheduler";
describe("constraint optimiser", () => {
  const p = {
    wake_time: "07:00",
    sleep_time: "23:00",
    work_start: "09:00",
    work_end: "17:00",
    work_days: [1, 2, 3, 4, 5],
  };
  const ws = new Date(2026, 9, 5);
  const g = (o: any) => ({
    id: "a",
    title: "A",
    domain: "training",
    weekly_minutes: 180,
    session_minutes: 60,
    preferred_time: "evening",
    ...o,
  });
  const day = (iso: string) => Math.round((new Date(iso).getTime() - ws.getTime()) / 864e5 - 0.49);
  it("never overlaps fixed blocks and keeps 48h between strength sessions", () => {
    const fixed = [{ starts_at: new Date(2026, 9, 5, 18, 0).toISOString(), duration_min: 120 }];
    const r = buildWeekPlan(p, [g({})], ws, { fixed });
    const days = r.blocks.map((b) => new Date(b.starts_at).getDate()).sort((a, b) => a - b);
    for (let i = 1; i < days.length; i++) expect(days[i]! - days[i - 1]!).toBeGreaterThanOrEqual(2);
    for (const b of r.blocks) {
      const s = new Date(b.starts_at);
      if (s.getDate() === 5)
        expect(
          s.getHours() * 60 + s.getMinutes() >= 20 * 60 + 15 ||
            s.getHours() * 60 + s.getMinutes() + 60 <= 17 * 60 + 45,
        ).toBe(true);
    }
  });
  it("respects deadlines and keeps hard exercise away from bedtime", () => {
    const r = buildWeekPlan(
      p,
      [g({ domain: "cardio", weekly_minutes: 60, session_minutes: 30, deadline: "2026-10-07" })],
      ws,
    );
    for (const b of r.blocks) {
      expect(new Date(b.starts_at).getDate()).toBeLessThanOrEqual(7);
      const s = new Date(b.starts_at);
      expect(s.getHours() * 60 + s.getMinutes() + 30).toBeLessThanOrEqual(22 * 60 - 30);
    }
  });
  it("prefers stable placement and hours with good adherence", () => {
    const prev = new Date(2026, 9, 6, 19, 0).toISOString();
    const r = buildWeekPlan(
      p,
      [g({ domain: "learning", weekly_minutes: 45, session_minutes: 45, preferred_time: "any" })],
      ws,
      { previous: [{ goal_id: "a", starts_at: prev }] },
    );
    expect(r.blocks[0]!.starts_at).toBe(prev);
    const adh = adherenceByHour([
      {
        domain: "learning",
        starts_at: new Date(2026, 8, 1, 7, 30).toISOString(),
        status: "skipped",
      },
      {
        domain: "learning",
        starts_at: new Date(2026, 8, 2, 7, 35).toISOString(),
        status: "skipped",
      },
    ]);
    expect(adh.learning![7]).toEqual({ done: 0, total: 2 });
  });
  it("relocates lower-priority work so a higher-priority session fits", () => {
    const tight = {
      wake_time: "07:00",
      sleep_time: "10:30",
      work_start: null,
      work_end: null,
      work_days: [],
    };
    const goals = [
      g({
        id: "hi",
        domain: "learning",
        priority: 5,
        weekly_minutes: 60,
        session_minutes: 60,
        preferred_time: "any",
      }),
      g({
        id: "lo",
        domain: "admin",
        priority: 1,
        weekly_minutes: 60,
        session_minutes: 60,
        preferred_time: "any",
      }),
    ];
    const r = buildWeekPlan(tight, goals, ws);
    expect(r.unplaced.find((u) => u.goal_id === "hi")).toBeUndefined();
    void day;
  });
  it("is deterministic", () => {
    const goals = [
      g({}),
      g({ id: "b", domain: "learning", weekly_minutes: 120, session_minutes: 40 }),
    ];
    expect(buildWeekPlan(p, goals, ws)).toEqual(buildWeekPlan(p, goals, ws));
  });
});
