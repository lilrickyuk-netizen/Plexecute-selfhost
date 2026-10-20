import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { allows, CAPABILITY_TIERS, FREE_LIMITS, normTier } from "@/lib/entitlements";

describe("V3 §5 entitlements", () => {
  it("locks Free limits to the spec", () => {
    expect(FREE_LIMITS).toEqual({
      activeGoals: 3,
      externalCalendars: 1,
      majorReplansPer7Days: 2,
      aiFoodLogsPerDay: 1,
      coachTurnsPerDay: 5,
    });
  });
  it("Free excludes paid capabilities; Execute-only stays Execute-only", () => {
    for (const cap of Object.keys(CAPABILITY_TIERS) as (keyof typeof CAPABILITY_TIERS)[]) {
      expect(allows("free", cap)).toBe(false);
      expect(allows("execute", cap)).toBe(true);
    }
    expect(allows("pro", "persistent_calls")).toBe(false);
    expect(allows("pro", "live_voice")).toBe(false);
    expect(allows("pro", "experiments")).toBe(true);
  });
  it("unknown or missing tiers are Free", () => {
    expect(normTier(undefined)).toBe("free");
    expect(normTier("admin")).toBe("free");
  });
  it("every gated capability is enforced in a server function, not only on screen", () => {
    const src = (f: string) => readFileSync(`src/lib/${f}`, "utf8");
    expect(src("experiments.functions.ts")).toMatch(/requireCapability\([^)]*"experiments"/);
    expect(src("professional.functions.ts")).toMatch(
      /requireCapability\([^)]*"professional_connect"/,
    );
    expect(src("wearables.functions.ts")).toMatch(/requireCapability\([^)]*"premium_wearables"/);
    expect(src("behaviour.functions.ts")).toMatch(/requireCapability\([^)]*"behaviour_model"/);
    expect(src("planning.functions.ts").match(/"recovery_mode"/g)?.length).toBe(2);
    expect(src("planning.functions.ts")).toMatch(/requireReplanAllowance/);
    expect(src("calendar.functions.ts")).toMatch(/requireCalendarSlot/);
    expect(src("nutrition.functions.ts")).toMatch(/requireAiFoodAllowance/);
  });
});
