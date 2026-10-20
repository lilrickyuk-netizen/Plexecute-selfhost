import { describe, it, expect } from "vitest";
import { AUTO_ADAPT_DEFAULTS, movesWithinBounds, reminderLeadMin, toMap } from "@/lib/auto-adapt";
describe("auto-adapt", () => {
  it("never auto-moves by default", () => {
    expect(
      movesWithinBounds(
        [{ from: "2026-10-01T09:00:00Z", to: "2026-10-01T12:00:00Z" }],
        AUTO_ADAPT_DEFAULTS,
      ),
    ).toBe(false);
  });
  it("24h bound", () => {
    const p = toMap([{ permission: "MOVE_NONPROTECTED_TASK_WITHIN_24H", enabled: true }]);
    expect(
      movesWithinBounds([{ from: "2026-10-01T09:00:00Z", to: "2026-10-02T08:00:00Z" }], p),
    ).toBe(true);
    expect(
      movesWithinBounds([{ from: "2026-10-01T09:00:00Z", to: "2026-10-03T08:00:00Z" }], p),
    ).toBe(false);
    expect(movesWithinBounds([{ from: null, to: "2026-10-01T10:00:00Z" }], p)).toBe(false);
  });
  it("reminder lead only when allowed", () => {
    expect(reminderLeadMin(10, 3, AUTO_ADAPT_DEFAULTS)).toBe(10);
    expect(
      reminderLeadMin(10, 5, toMap([{ permission: "CHANGE_REMINDER_TIMING", enabled: true }])),
    ).toBe(25);
  });
});
