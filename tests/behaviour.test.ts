import { describe, it, expect } from "vitest";
import { MISSED_REASONS, LAPSE_OPTIONS, reasonPattern, lapseMessage } from "../src/lib/behaviour";
describe("behaviour engine", () => {
  it("has the 15 locked missed reasons, each with a lapse option", () => {
    expect(MISSED_REASONS.length).toBe(15);
    for (const r of MISSED_REASONS) expect(LAPSE_OPTIONS[r].length).toBeGreaterThan(0);
  });
  it("pattern needs 5 reasons and ignores OTHER/DECLINE_TO_SAY", () => {
    expect(reasonPattern([{ reason: "FORGOT" }, { reason: "FORGOT" }])).toBeNull();
    expect(
      reasonPattern([
        { reason: "FORGOT" },
        { reason: "FORGOT" },
        { reason: "OTHER" },
        { reason: "DECLINE_TO_SAY" },
      ]),
    ).toBeNull();
    expect(
      reasonPattern([{ reason: "FORGOT" }, { reason: "FORGOT" }, { reason: "TRAVEL" }]),
    ).toBeNull();
    expect(
      reasonPattern(
        ["FORGOT", "FORGOT", "FORGOT", "TRAVEL", "ILLNESS"].map((reason) => ({ reason })),
      )?.reason,
    ).toBe("FORGOT");
  });
  it("messages never moralise", () => {
    for (const r of MISSED_REASONS)
      expect(lapseMessage(r)).not.toMatch(/fail(ed)? you|should have|lazy/i);
  });
});
