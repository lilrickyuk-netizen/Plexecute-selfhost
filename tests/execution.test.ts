import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  timeStep,
  EXECUTION_STATES,
  V3_NAME,
  TRANSITIONS,
} from "@/lib/execution";
describe("execution state machine", () => {
  it("covers every V3 state", () => {
    expect(EXECUTION_STATES.map((s) => V3_NAME[s]).sort()).toEqual([
      "ACKNOWLEDGED",
      "BLOCKED",
      "CANCELLED",
      "COMPLETED",
      "CONTACTING",
      "DUE",
      "EXPIRED",
      "IN_PROGRESS",
      "PARTIAL",
      "PLANNED",
      "RESCHEDULED",
      "SAFETY_STOPPED",
      "SCHEDULED",
      "SKIPPED",
      "SNOOZED",
      "STARTED",
      "UPCOMING",
    ]);
    for (const s of EXECUTION_STATES)
      for (const t of TRANSITIONS[s]) expect(EXECUTION_STATES).toContain(t);
  });
  it("allows legal and refuses illegal moves", () => {
    expect(canTransition("planned", "done")).toBe(true);
    expect(canTransition("snoozed", "due")).toBe(true);
    expect(canTransition("cancelled", "done")).toBe(false);
    expect(canTransition("in_progress", "snoozed")).toBe(false);
    expect(() => assertTransition("rescheduled", "planned")).toThrow(
      /EXECUTION_TRANSITION_INVALID/,
    );
  });
  it("time steps", () => {
    const start = new Date("2026-10-01T10:00:00Z");
    const b = { status: "planned", starts_at: start.toISOString(), duration_min: 30 };
    expect(timeStep(b, new Date("2026-10-01T07:00:00Z"))).toBeNull();
    expect(timeStep(b, new Date("2026-10-01T09:00:00Z"))).toBe("upcoming");
    expect(timeStep({ ...b, status: "upcoming" }, new Date("2026-10-01T10:05:00Z"))).toBe("due");
    expect(timeStep({ ...b, status: "due" }, new Date("2026-10-01T13:00:00Z"))).toBe("expired");
    expect(timeStep({ ...b, status: "done" }, new Date("2026-10-01T13:00:00Z"))).toBeNull();
  });
});
