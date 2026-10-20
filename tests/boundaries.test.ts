import { describe, expect, it } from "vitest";
import { extractBoundaries } from "../src/lib/boundaries";

describe("stated life boundaries", () => {
  const b = extractBoundaries(
    "I work 9-5 weekdays, I have £4,000 saved, my kids' bedtime is 7:30pm and weekends are family time.",
  );
  it("protects weekday work hours", () => {
    expect(b).toContainEqual(
      expect.objectContaining({
        kind: "shift",
        days: [1, 2, 3, 4, 5],
        start_time: "09:00",
        end_time: "17:00",
      }),
    );
  });
  it("protects weekends for family", () => {
    expect(b).toContainEqual(expect.objectContaining({ kind: "family", days: [6, 7] }));
  });
  it("protects the evening before a 7:30pm bedtime", () => {
    expect(b).toContainEqual(expect.objectContaining({ start_time: "17:30", end_time: "19:45" }));
  });
  it("does not treat offered goal time as a boundary", () => {
    expect(
      extractBoundaries("I have 6 hours a week on Monday, Wednesday and Thursday evenings"),
    ).toEqual([]);
  });
});

import { extractAvailability } from "../src/lib/boundaries";
describe("offered goal time", () => {
  it("reads the days and part of day offered for the goal", () => {
    expect(
      extractAvailability(
        "I have 6 hours a week on Monday, Wednesday and Thursday evenings and a £500 budget",
      ),
    ).toEqual({ days: [1, 3, 4], part: "evening", weeklyMinutes: 360 });
  });
  it("ignores text with no offered days", () => {
    expect(extractAvailability("I work 9-5 weekdays")).toBeNull();
  });
});
