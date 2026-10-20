import { describe, expect, it } from "vitest";
import {
  inQuietHours,
  localDayKey,
  localDayRange,
  startOfLocalDay,
  weekKeyOf,
  zonedInstant,
  zonedParts,
} from "../src/lib/tz";
import { buildWeekPlan, startOfWeek } from "../src/lib/scheduler";

describe("tz", () => {
  it("London summer local day differs from UTC near midnight", () => {
    expect(localDayKey("2026-07-01T23:30:00Z", "Europe/London")).toBe("2026-07-02");
    expect(localDayKey("2026-07-01T23:30:00Z", "UTC")).toBe("2026-07-01");
  });
  it("local midnight instant across DST", () => {
    expect(startOfLocalDay("2026-07-02T10:00:00Z", "Europe/London").toISOString()).toBe(
      "2026-07-01T23:00:00.000Z",
    );
    expect(startOfLocalDay("2026-12-02T10:00:00Z", "Europe/London").toISOString()).toBe(
      "2026-12-02T00:00:00.000Z",
    );
  });
  it("DST change day is 23 hours long (spring forward)", () => {
    const [a, b] = localDayRange("2026-03-29T12:00:00Z", "Europe/London");
    expect((b.getTime() - a.getTime()) / 36e5).toBe(23);
  });
  it("wall clock 07:00 stays 07:00 either side of DST", () => {
    expect(zonedParts(zonedInstant("2026-03-28", 420, "Europe/London"), "Europe/London").h).toBe(7);
    expect(zonedParts(zonedInstant("2026-03-30", 420, "Europe/London"), "Europe/London").h).toBe(7);
  });
  it("week starts Monday local", () => {
    expect(weekKeyOf("2026-10-04T23:30:00Z", "Europe/London")).toBe("2026-10-05");
  });
  it("quiet hours wrap midnight", () => {
    expect(inQuietHours(new Date("2026-10-01T22:30:00Z"), "22:00", "07:00", "Europe/London")).toBe(
      true,
    );
    expect(inQuietHours(new Date("2026-10-01T12:00:00Z"), "22:00", "07:00", "Europe/London")).toBe(
      false,
    );
  });
  it("planner places sessions in the user's zone, not the server's", () => {
    const p = {
      wake_time: "07:00",
      sleep_time: "23:00",
      work_start: null,
      work_end: null,
      work_days: [],
      timezone: "America/New_York",
    };
    const ws = startOfWeek(new Date("2026-10-07T12:00:00Z"), p.timezone);
    const r = buildWeekPlan(
      p,
      [
        {
          id: "g",
          title: "Run",
          domain: "cardio",
          weekly_minutes: 60,
          session_minutes: 30,
          preferred_time: "morning",
        } as never,
      ],
      ws,
    );
    for (const b of r.blocks) {
      const h = zonedParts(b.starts_at, p.timezone).h;
      expect(h).toBeGreaterThanOrEqual(7);
      expect(h).toBeLessThan(23);
    }
    expect(r.blocks.length).toBeGreaterThan(0);
  });
});
