import { describe, expect, it } from "vitest";
import { dailyLimitFreesAt } from "../src/lib/calling.server";

const at = new Date("2026-10-17T11:30:00Z");
const hours = (h: number) => new Date(at.getTime() - h * 3600e3).toISOString();

describe("12 calls in 24 hours safety limit", () => {
  it("allows the 12th call", () => {
    expect(
      dailyLimitFreesAt(
        Array.from({ length: 11 }, (_, i) => hours(i + 1)),
        at,
      ),
    ).toBeNull();
  });
  it("holds a call once 12 have been placed, and says when calls ring again", () => {
    const placed = Array.from({ length: 14 }, (_, i) => hours(23 - i));
    // The 3rd-oldest call must drop out for the count to fall below 12.
    expect(dailyLimitFreesAt(placed, at)).toBe(
      new Date(new Date(hours(21)).getTime() + 864e5).toISOString(),
    );
  });
  it("ignores calls older than 24 hours", () => {
    expect(
      dailyLimitFreesAt(
        Array.from({ length: 12 }, () => hours(25)),
        at,
      ),
    ).toBeNull();
  });
});
