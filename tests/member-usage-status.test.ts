import { describe, expect, it } from "vitest";
import { allowanceMicro, memberUsageStatus, callAllowed } from "@/lib/spend";

describe("member-safe usage state", () => {
  for (const tier of ["free", "pro", "execute"]) {
    it(`${tier} exposes states, never internal accounting`, () => {
      const result = memberUsageStatus(
        { allowanceMicro: allowanceMicro(tier), usedMicro: 123456, creditMicro: 654321 },
        tier,
      );
      expect(result).toEqual({ includedEnded: false, aiEnded: false, creditAvailable: true });
      expect(Object.values(result).every((value) => typeof value === "boolean")).toBe(true);
    });
  }
  it("Pro included usage ends at exactly £8, AI credit never buys calls", () => {
    const state = {
      allowanceMicro: allowanceMicro("pro"),
      usedMicro: 8000000,
      creditMicro: 7500000,
    };
    expect(state.allowanceMicro).toBe(8000000);
    expect(memberUsageStatus(state, "pro").includedEnded).toBe(true);
    expect(callAllowed(state, "pro", 0)).toBe(false);
    expect(callAllowed(state, "pro", 1)).toBe(true);
    expect(callAllowed({ ...state, usedMicro: 7999999 }, "pro", 0)).toBe(true);
  });
});
