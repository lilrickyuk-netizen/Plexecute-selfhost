import { describe, it, expect } from "vitest";
import {
  marketDecision,
  inPermittedHours,
  marketReputationHold,
  type MarketRow,
} from "@/lib/call-compliance";
import { CALL_CONSENT_VERSION, DISCLOSURE_SCRIPT_VERSION } from "@/lib/calling";

const gb: MarketRow = {
  country: "GB",
  enabled: true,
  killed: false,
  signed_off_by: "Counsel",
  signed_off_at: "2026-10-01",
  review_ref: null,
  permitted_start: "08:00",
  permitted_end: "21:00",
  consent_version: CALL_CONSENT_VERSION,
  disclosure_version: DISCLOSURE_SCRIPT_VERSION,
  max_attempts_per_occurrence: 4,
  max_per_24h: 8,
  pro_retry_allowed: false,
  min_answer_rate: 0.3,
};
const noon = 12 * 60;

describe("Step 49 call compliance", () => {
  it("allows a signed-off market and applies its stricter caps", () => {
    expect(marketDecision({ ...gb, disclosure_version: "gb_disclosure_v1" }, null, noon).ok).toBe(
      true,
    );
    expect(marketDecision(gb, { killed: false }, noon)).toEqual({
      ok: true,
      maxPerOccurrence: 4,
      max24h: 8,
      proRetry: false,
      minAnswerRate: 0.3,
    });
  });
  it("never exceeds engineering ceilings", () => {
    const d = marketDecision(
      { ...gb, max_attempts_per_occurrence: null, max_per_24h: null },
      null,
      noon,
    );
    expect(d.ok && [d.maxPerOccurrence, d.max24h]).toEqual([6, 12]);
  });
  it("blocks: global kill, market kill, missing/unsigned rows, versions, hours", () => {
    expect(marketDecision(gb, { killed: true }, noon)).toMatchObject({
      reason: "global_kill_switch",
    });
    expect(marketDecision({ ...gb, killed: true }, null, noon)).toMatchObject({
      reason: "market_kill_switch",
    });
    expect(marketDecision(null, null, noon)).toMatchObject({ reason: "market_not_cleared" });
    expect(marketDecision({ ...gb, enabled: false }, null, noon)).toMatchObject({
      reason: "market_not_cleared",
    });
    expect(marketDecision({ ...gb, signed_off_by: null }, null, noon)).toMatchObject({
      reason: "market_not_cleared",
    });
    expect(marketDecision({ ...gb, consent_version: "old" }, null, noon)).toMatchObject({
      reason: "consent_not_approved",
    });
    expect(marketDecision({ ...gb, disclosure_version: "old" }, null, noon)).toMatchObject({
      reason: "disclosure_not_approved",
    });
    expect(marketDecision(gb, null, 7 * 60 + 59)).toMatchObject({
      reason: "outside_permitted_hours",
    });
    expect(marketDecision(gb, null, 21 * 60)).toMatchObject({ reason: "outside_permitted_hours" });
  });
  it("permitted hours across midnight", () => {
    expect(inPermittedHours(23 * 60, "22:00", "02:00")).toBe(true);
    expect(inPermittedHours(60, "22:00", "02:00")).toBe(true);
    expect(inPermittedHours(12 * 60, "22:00", "02:00")).toBe(false);
  });
  it("market answer-rate floor needs enough calls", () => {
    const r = (a: number, n: number) => Array.from({ length: n }, (_, i) => ({ answered: i < a }));
    expect(marketReputationHold(r(2, 10), 0.3)).toBe(true);
    expect(marketReputationHold(r(3, 10), 0.3)).toBe(false);
    expect(marketReputationHold(r(0, 9), 0.3)).toBe(false);
    expect(marketReputationHold(r(0, 10), null)).toBe(false);
  });
});
