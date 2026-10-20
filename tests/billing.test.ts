import { describe, expect, it } from "vitest";
import {
  PRODUCTS,
  TRIAL,
  VOICE_TOPUP,
  addInterval,
  allowanceLevel,
  canBuyTopUp,
  providerState,
  trialCallBlock,
  trialDisclosure,
} from "@/lib/billing";

describe("billing manifest (Steps 50–55)", () => {
  it("locks base UK prices", () => {
    expect([
      PRODUCTS.pro.month.pence,
      PRODUCTS.pro.year.pence,
      PRODUCTS.execute.month.pence,
      PRODUCTS.execute.year.pence,
    ]).toEqual([2399, 23999, 5999, 59999]);
    expect(VOICE_TOPUP).toMatchObject({ minutes: 60, pence: 1499 });
  });
  it("trial disclosure has every required field", () => {
    const d = trialDisclosure("execute", "year", new Date("2026-01-01T00:00:00Z"));
    expect(d.trialDays).toBe(7);
    expect(d.renewalPricePence).toBe(59999);
    expect(d.renewalDate.toISOString()).toBe("2026-01-08T00:00:00.000Z");
    expect(d.autoRenew).toMatch(/renews automatically/);
    expect(d.cancelPath).toMatch(/Cancel/);
  });
  it("normalises provider state without fabricating entitlement", () => {
    expect(providerState(null)).toEqual({ state: "none", entitled: false });
    expect(providerState({ status: "past_due" })).toEqual({ state: "grace", entitled: true });
    expect(providerState({ status: "active", cancel_at_period_end: true })).toEqual({
      state: "cancelling",
      entitled: true,
    });
    expect(providerState({ status: "unpaid" }).entitled).toBe(false);
    expect(providerState({ status: "canceled" }).entitled).toBe(false);
    expect(providerState({ status: "active", refunded: true }).entitled).toBe(false);
  });
  it("warns at 80% and 100%", () => {
    expect(allowanceLevel(7, 10)).toBeNull();
    expect(allowanceLevel(8, 10)).toBe(80);
    expect(allowanceLevel(10, 10)).toBe(100);
  });
  it("enforces trial call ceilings only while trialing", () => {
    expect(
      trialCallBlock({
        tier: "pro",
        trialing: true,
        campaigns: TRIAL.pro.campaigns,
        occurrences: 0,
        connectedSeconds: 0,
      }),
    ).toBe("trial_ceiling");
    expect(
      trialCallBlock({
        tier: "pro",
        trialing: false,
        campaigns: 9,
        occurrences: 0,
        connectedSeconds: 0,
      }),
    ).toBeNull();
    expect(
      trialCallBlock({
        tier: "execute",
        trialing: true,
        campaigns: 0,
        occurrences: 4,
        connectedSeconds: 899,
      }),
    ).toBeNull();
    expect(
      trialCallBlock({
        tier: "execute",
        trialing: true,
        campaigns: 0,
        occurrences: 4,
        connectedSeconds: 900,
      }),
    ).toBe("trial_ceiling");
  });
  it("top-ups need an entitled Pro or Execute plan", () => {
    expect(canBuyTopUp("execute", "active")).toBe(true);
    expect(canBuyTopUp("execute", "trialing")).toBe(false);
    expect(canBuyTopUp("pro", "active")).toBe(true);
    expect(canBuyTopUp("free", "active")).toBe(false);
  });
  it("annual windows clamp month ends", () => {
    expect(addInterval(new Date("2026-01-31T00:00:00Z"), "month").toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });
});
