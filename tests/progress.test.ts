import { describe, it, expect } from "vitest";
import {
  goalTrajectory,
  planVsActual,
  recoveryPattern,
  smoothed,
  weeklyAdherence,
  type ProgressBlock,
} from "../src/lib/progress";
const now = new Date("2026-10-28T12:00:00Z");
const b = (
  id: string,
  at: string,
  status: string,
  extra: Partial<ProgressBlock> = {},
): ProgressBlock => ({
  id,
  status,
  starts_at: at,
  duration_min: 30,
  domain: "fitness",
  goal_id: "g",
  evidence: "unknown",
  ...extra,
});
describe("progress views", () => {
  it("weekly adherence by local week, excludes moved/cancelled/future-unfinished, counts sessions finished early, unknown stays unknown", () => {
    const w = weeklyAdherence(
      [
        b("1", "2026-10-26T08:00:00Z", "done"),
        b("2", "2026-10-27T08:00:00Z", "planned"),
        b("3", "2026-10-27T09:00:00Z", "rescheduled"),
        b("4", "2026-10-29T08:00:00Z", "done"),
        b("5", "2026-10-20T08:00:00Z", "skipped"),
      ],
      "UTC",
      now,
      2,
    );
    expect(w[1]).toMatchObject({ week: "2026-10-26", planned: 3, done: 2, unknown: 1, pct: 67 });
    expect(w[0]).toMatchObject({ week: "2026-10-19", skipped: 1, pct: 0 });
  });
  it("week boundary follows the user's time zone", () => {
    const w = weeklyAdherence([b("1", "2026-10-25T23:30:00Z", "done")], "Europe/London", now, 2);
    expect(w[1]!.planned).toBe(0); // Sunday 23:30 GMT is still the previous week
    expect(
      weeklyAdherence([b("1", "2026-10-25T23:30:00Z", "done")], "Europe/Berlin", now, 2)[1]!
        .planned,
    ).toBe(1);
  });
  it("plan vs actual credits only done minutes", () => {
    const p = planVsActual(
      [
        b("1", "2026-10-26T08:00:00Z", "done"),
        b("2", "2026-10-26T09:00:00Z", "partial"),
        b("3", "2026-10-26T10:00:00Z", "cancelled"),
      ],
      now,
    );
    expect(p[0]).toMatchObject({ plannedMin: 60, doneMin: 30, plannedCount: 2, doneCount: 1 });
  });
  it("goal trajectory needs 2 readings and compares to the straight line", () => {
    const g = {
      id: "g",
      title: "x",
      baseline_value: 0,
      target_value: 10,
      current_value: null,
      target_unit: "km",
      deadline: "2026-11-27",
      created_at: "2026-09-28T00:00:00Z",
    };
    expect(
      goalTrajectory(g, [{ value: 2, recorded_at: "2026-10-01T00:00:00Z" }], "UTC", now).enough,
    ).toBe(false);
    const t = goalTrajectory(
      g,
      [
        { value: 2, recorded_at: "2026-10-01T00:00:00Z" },
        { value: 8, recorded_at: "2026-10-27T00:00:00Z" },
      ],
      "UTC",
      now,
    );
    expect(t).toMatchObject({ enough: true, latest: 8, pctToTarget: 80, position: "ahead" });
  });
  it("smoothing and recovery averages", () => {
    expect(
      smoothed([
        { day: "a", value: 80 },
        { day: "b", value: 82 },
      ]).at(-1)!.avg,
    ).toBe(81);
    const r = recoveryPattern(
      [
        {
          check_date: "2026-10-27",
          readiness: 6,
          sleep_quality: 7,
          energy: 5,
          ill_or_injured: true,
        },
        {
          check_date: "2026-08-01",
          readiness: 1,
          sleep_quality: 1,
          energy: 1,
          ill_or_injured: false,
        },
      ],
      28,
      now,
      "UTC",
    );
    expect(r).toMatchObject({ logged: 1, readiness: 6, illDays: 1 });
  });
});
