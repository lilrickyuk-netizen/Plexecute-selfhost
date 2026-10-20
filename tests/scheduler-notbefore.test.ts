import { describe, expect, it } from "vitest";
import { buildWeekPlan, feasibilityReport, startOfWeek } from "@/lib/scheduler";

const profile = {
  timezone: "Europe/London",
  wake_time: "07:00",
  sleep_time: "23:00",
  work_start: "09:00",
  work_end: "17:00",
  work_days: [1, 2, 3, 4, 5],
  commitments: [],
} as never;
const goal = {
  id: "g1",
  title: "Get stronger",
  domain: "training",
  weekly_minutes: 180,
  session_minutes: 60,
  preferred_time: "evening",
  priority: 1,
} as never;

describe("planning only the rest of the week (item 71 journey)", () => {
  const ws = startOfWeek(new Date("2026-10-01T12:00:00Z"), "Europe/London");
  const thursdayNoon = new Date("2026-10-01T11:00:00Z");

  it("never places a session before notBefore", () => {
    const plan = buildWeekPlan(profile, [goal], ws, { notBefore: thursdayNoon });
    expect(plan.blocks.length).toBeGreaterThan(0);
    for (const b of plan.blocks)
      expect(new Date(b.starts_at).getTime()).toBeGreaterThan(thursdayNoon.getTime());
  });

  it("uses the remaining days instead of losing sessions to past days", () => {
    const whole = buildWeekPlan(profile, [goal], ws).blocks.filter(
      (b) => b.starts_at >= thursdayNoon.toISOString(),
    );
    const rest = buildWeekPlan(profile, [goal], ws, { notBefore: thursdayNoon });
    expect(rest.blocks.length).toBeGreaterThanOrEqual(whole.length);
    expect(rest.blocks.length).toBeGreaterThan(whole.length); // strength sessions stay 48h apart, so Thu + Sat
  });

  it("feasibility reflects what can still be placed", () => {
    const sundayNight = new Date("2026-10-04T21:00:00Z");
    expect(feasibilityReport(profile, [goal], ws, sundayNight).level).not.toBe("fits");
  });
});
