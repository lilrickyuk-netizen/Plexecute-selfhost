import { describe, expect, it } from "vitest";
import { buildWeekPlan, startOfWeek } from "@/lib/scheduler";
import { zonedParts } from "@/lib/tz";

// Owner's real case: train at 7am Mon–Fri, business work also wanted in the morning,
// breakfast at 08:30 and work from 09:00. Training must keep 07:00.
const profile = {
  timezone: "Europe/London",
  wake_time: "06:30",
  sleep_time: "23:30",
  work_start: "09:00",
  work_end: "17:00",
  work_days: [1, 2, 3, 4, 5],
  commitments: [
    {
      recurrence: "weekly",
      days: [1, 2, 3, 4, 5],
      on_date: null,
      start_time: "08:30",
      end_time: "09:00",
      active: true,
    },
  ],
} as never;
const train = {
  id: "train",
  title: "Train",
  domain: "training",
  weekly_minutes: 150,
  session_minutes: 30,
  preferred_time: "morning",
  preferred_days: [1, 2, 3, 4, 5],
  preferred_start: "07:00",
  priority: 3,
};
const business = {
  id: "biz",
  title: "Scale my online platform",
  domain: "career",
  weekly_minutes: 300,
  session_minutes: 60,
  preferred_time: "morning",
  preferred_days: [1, 2, 3, 4, 5],
  preferred_start: "08:00",
  priority: 3,
};

describe("exact member-chosen times", () => {
  const ws = startOfWeek(new Date("2026-10-19T12:00:00Z"), "Europe/London");
  it("keeps 07:00 training on every weekday even when a longer goal also wants the morning", () => {
    for (const goals of [
      [train, business],
      [business, train],
    ]) {
      const plan = buildWeekPlan(profile, goals as never, ws);
      const t = plan.blocks.filter((b) => b.goal_id === "train");
      expect(t).toHaveLength(5);
      for (const b of t) {
        const z = zonedParts(b.starts_at, "Europe/London");
        expect(z.minutes).toBe(7 * 60);
        expect(z.isoDow).toBeLessThanOrEqual(5);
      }
      for (const b of plan.blocks.filter((b) => b.goal_id === "biz"))
        expect(zonedParts(b.starts_at, "Europe/London").minutes).not.toBe(7 * 60);
    }
  });
});

describe("exact time right at wake-up", () => {
  const ws = startOfWeek(new Date("2026-10-19T12:00:00Z"), "Europe/London");
  it("places 7am training for someone who wakes at 7 and works at 9", () => {
    const p = {
      timezone: "Europe/London",
      wake_time: "07:00",
      sleep_time: "23:30",
      work_start: "09:00",
      work_end: "17:00",
      work_days: [1, 2, 5],
      commitments: [],
    } as never;
    const g = { ...train, session_minutes: 60, weekly_minutes: 300 };
    const plan = buildWeekPlan(p, [g] as never, ws);
    const t = plan.blocks.filter((b) => b.goal_id === "train");
    expect(t).toHaveLength(5);
    for (const b of t) expect(zonedParts(b.starts_at, "Europe/London").minutes).toBe(7 * 60);
  });
});
