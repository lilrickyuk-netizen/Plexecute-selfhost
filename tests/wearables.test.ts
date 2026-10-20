import { describe, it, expect } from "vitest";
import {
  mapWhoop,
  mapOura,
  mapFitbit,
  mapStrava,
  mapGarmin,
  classifyFailure,
  isStale,
} from "../src/lib/wearables";
describe("wearable adapters", () => {
  it("WHOOP sleep excludes naps and awake time; workouts get stable ids", () => {
    const s = mapWhoop({
      sleep: [
        {
          id: "a",
          start: "2026-10-01T22:00:00Z",
          end: "2026-10-02T06:00:00Z",
          score: {
            stage_summary: { total_in_bed_time_milli: 8 * 36e5, total_awake_time_milli: 36e5 },
          },
        },
        { id: "n", nap: true, start: "2026-10-02T13:00:00Z", end: "2026-10-02T13:30:00Z" },
      ],
      workout: [
        {
          id: "w",
          start: "2026-10-02T07:00:00Z",
          end: "2026-10-02T07:45:00Z",
          score: { kilojoule: 1000 },
        },
      ],
    });
    expect(s.find((x) => x.kind === "sleep_hours")!.value).toBe(7);
    expect(s.filter((x) => x.kind === "sleep_hours").length).toBe(1);
    expect(s.find((x) => x.kind === "workout_minutes")).toMatchObject({
      value: 45,
      provider_event_id: "workout:w",
    });
    expect(s.find((x) => x.kind === "active_kcal")!.value).toBe(239);
  });
  it("Oura uses long sleep only and day-level steps", () => {
    const s = mapOura({
      daily_activity: [{ id: "d", day: "2026-10-01", steps: 9000 }],
      sleep: [
        {
          id: "x",
          type: "late_nap",
          bedtime_start: "2026-10-01T14:00:00Z",
          bedtime_end: "2026-10-01T14:30:00Z",
          total_sleep_duration: 1800,
        },
      ],
    });
    expect(s).toEqual([
      {
        kind: "steps",
        value: 9000,
        recorded_at: "2026-10-01T12:00:00.000Z",
        provider_event_id: "steps:2026-10-01",
      },
    ]);
  });
  it("Fitbit skips zero-step days and converts km", () => {
    const s = mapFitbit({
      steps: [{ dateTime: "2026-10-01", value: "0" }],
      activities: [
        {
          logId: 1,
          startTime: "2026-10-01T08:00:00.000+01:00",
          activeDuration: 1800000,
          distance: 5,
        },
      ],
    });
    expect(s.map((x) => [x.kind, x.value])).toEqual([
      ["workout_minutes", 30],
      ["distance_m", 5000],
    ]);
  });
  it("Strava and Garmin map workouts with provider ids", () => {
    expect(
      mapStrava([
        { id: 9, start_date: "2026-10-01T08:00:00Z", moving_time: 1500, distance: 5000 },
      ])[0],
    ).toMatchObject({ kind: "workout_minutes", value: 25, provider_event_id: "activity:9" });
    expect(
      mapGarmin({
        sleeps: [
          {
            summaryId: "s",
            startTimeInSeconds: 0,
            durationInSeconds: 28800,
            awakeDurationInSeconds: 3600,
          },
        ],
      })[0]!.value,
    ).toBe(7);
  });
  it("failures become revoked or degraded", () => {
    expect(classifyFailure(401)).toBe("revoked");
    expect(classifyFailure(400, "invalid_grant")).toBe("revoked");
    expect(classifyFailure(429)).toBe("degraded");
    expect(isStale("whoop", null)).toBe(true);
  });
});
