import { describe, expect, it } from "vitest";
import {
  BUFFER_CHOICES,
  clampBuffer,
  DEFAULT_BUFFER_MIN,
  dueForRecheck,
  journeyTitle,
  leaveTime,
  MODE_LABELS,
  normMode,
  ROUTE_FAILURE_MESSAGE,
  shortPlace,
} from "@/lib/journeys";
import { allows, CAPABILITY_MESSAGE } from "@/lib/entitlements";

describe("journey entitlement", () => {
  it("is Pro/Execute only — Free cannot plan journeys", () => {
    expect(allows("free", "journey_planning")).toBe(false);
    expect(allows("pro", "journey_planning")).toBe(true);
    expect(allows("execute", "journey_planning")).toBe(true);
    expect(CAPABILITY_MESSAGE.journey_planning).toMatch(/Pro and Execute/);
  });
});

describe("leave time", () => {
  it("subtracts duration and buffer from the arrival target", () => {
    const arrive = new Date("2026-10-13T09:00:00Z");
    expect(leaveTime(arrive, 35, 10).toISOString()).toBe("2026-10-13T08:15:00.000Z");
    expect(leaveTime(arrive, 0, 0).toISOString()).toBe(arrive.toISOString());
  });
});

describe("buffer", () => {
  it("clamps to 0–120 and defaults sensibly", () => {
    expect(clampBuffer(undefined)).toBe(DEFAULT_BUFFER_MIN);
    expect(clampBuffer(-5)).toBe(0);
    expect(clampBuffer(999)).toBe(120);
    expect(clampBuffer(15)).toBe(15);
    expect(BUFFER_CHOICES).toContain(10);
  });
});

describe("modes", () => {
  it("normalises unknown modes to drive and labels all three", () => {
    expect(normMode("transit")).toBe("transit");
    expect(normMode("walk")).toBe("walk");
    expect(normMode("helicopter")).toBe("drive");
    expect(Object.keys(MODE_LABELS)).toEqual(["drive", "transit", "walk"]);
  });
});

describe("display privacy", () => {
  it("shortPlace shows only the first address part", () => {
    expect(shortPlace("12 Example Street, Manchester, M1 1AA, UK")).toBe("12 Example Street");
  });
  it("journey title prefers the saved label over the address", () => {
    expect(journeyTitle("work", "12 Example Street, Manchester", "drive")).toBe(
      "Travel to work (car)",
    );
    expect(journeyTitle(null, "Manchester Piccadilly, Manchester", "transit")).toContain(
      "Manchester Piccadilly",
    );
  });
});

describe("recheck cadence (cost control)", () => {
  const now = new Date("2026-10-13T08:00:00Z");
  it("skips cancelled/completed and far-future journeys", () => {
    expect(
      dueForRecheck(
        { leave_at: "2026-10-13T09:00:00Z", status: "cancelled", last_checked_at: null },
        now,
      ),
    ).toBe(false);
    expect(
      dueForRecheck(
        { leave_at: "2026-10-20T09:00:00Z", status: "planned", last_checked_at: null },
        now,
      ),
    ).toBe(false);
  });
  it("checks upcoming journeys, hourly beyond 2h out and every 15 min within 2h", () => {
    expect(
      dueForRecheck(
        { leave_at: "2026-10-13T12:00:00Z", status: "planned", last_checked_at: null },
        now,
      ),
    ).toBe(true);
    expect(
      dueForRecheck(
        {
          leave_at: "2026-10-13T12:00:00Z",
          status: "planned",
          last_checked_at: "2026-10-13T07:30:00Z",
        },
        now,
      ),
    ).toBe(false);
    expect(
      dueForRecheck(
        {
          leave_at: "2026-10-13T09:30:00Z",
          status: "monitoring",
          last_checked_at: "2026-10-13T07:30:00Z",
        },
        now,
      ),
    ).toBe(true);
    expect(
      dueForRecheck(
        {
          leave_at: "2026-10-13T09:30:00Z",
          status: "monitoring",
          last_checked_at: "2026-10-13T07:55:00Z",
        },
        now,
      ),
    ).toBe(false);
  });
});

describe("honest failure", () => {
  it("never invents a travel time", () => {
    expect(ROUTE_FAILURE_MESSAGE).toMatch(/haven't guessed/i);
  });
});
