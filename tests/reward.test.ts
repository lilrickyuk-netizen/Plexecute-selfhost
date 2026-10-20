import { describe, it, expect } from "vitest";
import {
  evaluatePeriod,
  decide,
  periodEligibility,
  invoiceConfirmsCredit,
  REWARD,
  discountedRenewalPence,
  type RewardBlock,
  type SubscriptionInfo,
} from "@/lib/reward";
import { zonedInstant } from "@/lib/tz";

const period = { start: new Date("2026-10-01T09:00:00Z"), end: new Date("2026-11-01T09:00:00Z") };
const mk = (id: string, o: Partial<RewardBlock> = {}): RewardBlock => ({
  id,
  status: "done",
  source_type: "goal",
  original_starts_at: "2026-10-10T08:00:00Z",
  completed_at: "2026-10-10T09:00:00Z",
  created_at: "2026-09-30T10:00:00Z",
  plan_version_id: "v1",
  done_event_at: "2026-10-10T09:00:00Z",
  rescheduled_at: null,
  ...o,
});
const month = (n: number, open = 0) => [
  ...Array.from({ length: n - open }, (_, i) => mk(`d${i}`)),
  ...Array.from({ length: open }, (_, i) =>
    mk(`o${i}`, { status: "expired", completed_at: null, done_event_at: null }),
  ),
];
const sub = (o: Partial<SubscriptionInfo> = {}): SubscriptionInfo => ({
  tier: "execute",
  status: "active",
  billing_interval: "month",
  current_period_start: period.start.toISOString(),
  current_period_end: period.end.toISOString(),
  trial_ends_at: null,
  subscription_id: "sub_1",
  customer_id: "cus_1",
  ...o,
});

describe("Execute Monthly Execution Reward", () => {
  it("1. 100% completion earns exactly £10; renewal £59.99 → £49.99", () => {
    const ev = evaluatePeriod(month(31), period);
    expect([ev.completed, ev.required]).toEqual([31, 31]);
    expect(decide(ev)).toEqual({ state: "EARNED", amountPence: 1000 });
    expect(REWARD.amountPence).toBe(1000);
    expect(discountedRenewalPence).toBe(4999);
  });
  it("2. 99% (one action short) earns £0", () => {
    const ev = evaluatePeriod(month(100, 1), period);
    expect(ev.completed).toBe(99);
    expect(decide(ev)).toEqual({ state: "NOT_EARNED", amountPence: 0 });
  });
  it("3. moving a session keeps it in the month it was planned in", () => {
    const moved = mk("m", {
      original_starts_at: "2026-10-31T20:00:00Z",
      completed_at: "2026-10-31T23:00:00Z",
      done_event_at: "2026-10-31T23:00:00Z",
    });
    expect(decide(evaluatePeriod([...month(5), moved], period)).state).toBe("EARNED");
    const snoozedOut = mk("s", {
      original_starts_at: "2026-10-31T20:00:00Z",
      status: "planned",
      completed_at: null,
      done_event_at: null,
    });
    expect(decide(evaluatePeriod([...month(5), snoozedOut], period)).state).toBe("NOT_EARNED");
  });
  it("4. accepted replans: replaced future sessions drop out, replacement sessions and versions count", () => {
    const replaced = mk("r", {
      status: "rescheduled",
      completed_at: null,
      done_event_at: null,
      plan_version_id: "v1",
      original_starts_at: "2026-10-20T08:00:00Z",
      rescheduled_at: "2026-10-15T08:00:00Z",
    });
    const replacement = mk("n", {
      plan_version_id: "v2",
      original_starts_at: "2026-10-21T08:00:00Z",
      completed_at: "2026-10-21T09:00:00Z",
      done_event_at: "2026-10-21T09:00:00Z",
    });
    const ev = evaluatePeriod([...month(3), replaced, replacement], period);
    expect(ev.complete).toBe(true);
    expect(ev.planVersionIds).toEqual(["v1", "v2"]);
    expect(ev.excluded).toEqual([{ id: "r", why: "replaced_by_accepted_replan" }]);
  });
  it("5. unfinished work can't be removed to fake 100%", () => {
    for (const o of [
      { status: "cancelled" },
      { status: "skipped" },
      { status: "blocked" },
      { status: "partial" },
      { status: "rescheduled", rescheduled_at: "2026-10-25T00:00:00Z" }, // rescheduled after it was due
      { status: "rescheduled", rescheduled_at: null }, // no server replan record
    ]) {
      const b = mk("x", {
        ...o,
        original_starts_at: "2026-10-20T08:00:00Z",
        completed_at: null,
        done_event_at: null,
      });
      expect(decide(evaluatePeriod([...month(4), b], period)).state).toBe("NOT_EARNED");
    }
  });
  it("6/7. duplicate rows don't double count; an empty month earns nothing", () => {
    const ev = evaluatePeriod(
      [mk("a"), mk("a"), mk("b", { status: "expired", completed_at: null, done_event_at: null })],
      period,
    );
    expect([ev.completed, ev.required]).toEqual([1, 2]);
    expect(decide(evaluatePeriod([], period)).state).toBe("NOT_EARNED");
  });
  it("8. reconciliation needs a paid renewal invoice that consumed the credit", () => {
    const reward = {
      subscription_id: "sub_1",
      period_end: period.end.toISOString(),
      provider_credit_ref: "cbtxn_1",
    };
    const inv = {
      status: "paid",
      billing_reason: "subscription_cycle",
      subscription: "sub_1",
      starting_balance: -1000,
      ending_balance: 0,
      period_start_unix: period.end.getTime() / 1000,
      currency: "gbp",
    };
    expect(invoiceConfirmsCredit(inv, reward)).toBe(true);
  });
  it("9. failures never count as applied", () => {
    const reward = {
      subscription_id: "sub_1",
      period_end: period.end.toISOString(),
      provider_credit_ref: "cbtxn_1",
    };
    const inv = {
      status: "paid",
      billing_reason: "subscription_cycle",
      subscription: "sub_1",
      starting_balance: -1000,
      ending_balance: 0,
      period_start_unix: period.end.getTime() / 1000,
      currency: "gbp",
    };
    expect(invoiceConfirmsCredit({ ...inv, status: "open" }, reward)).toBe(false);
    expect(invoiceConfirmsCredit(inv, { ...reward, provider_credit_ref: null })).toBe(false);
    expect(invoiceConfirmsCredit({ ...inv, starting_balance: 0 }, reward)).toBe(false);
    expect(invoiceConfirmsCredit({ ...inv, subscription: "sub_other" }, reward)).toBe(false);
    expect(invoiceConfirmsCredit({ ...inv, billing_reason: "subscription_create" }, reward)).toBe(
      false,
    );
    expect(
      invoiceConfirmsCredit(
        { ...inv, period_start_unix: period.end.getTime() / 1000 + 40 * 86400 },
        reward,
      ),
    ).toBe(false);
  });
  it("10/11/12. only paid monthly Execute periods qualify", () => {
    expect(periodEligibility(sub())).toEqual({ ok: true });
    expect(periodEligibility(sub({ tier: "pro" }))).toEqual({ ok: false, reason: "not_execute" });
    expect(periodEligibility(null)).toEqual({ ok: false, reason: "not_execute" });
    expect(periodEligibility(sub({ status: "trialing" }))).toEqual({ ok: false, reason: "trial" });
    expect(periodEligibility(sub({ trial_ends_at: "2026-10-08T09:00:00Z" }))).toEqual({
      ok: false,
      reason: "trial",
    });
    expect(periodEligibility(sub({ billing_interval: "year" }))).toEqual({
      ok: false,
      reason: "annual_not_covered",
    });
  });
  it("13. service-month boundaries are exact instants, whatever the local clock says", () => {
    const tz = "Europe/London";
    const p = { start: zonedInstant("2026-10-01", 0, tz), end: zonedInstant("2026-11-01", 0, tz) }; // BST start, GMT end
    const lastMinute = mk("l", {
      original_starts_at: new Date(p.end.getTime() - 60000).toISOString(),
      completed_at: new Date(p.end.getTime() - 30000).toISOString(),
      done_event_at: new Date(p.end.getTime() - 30000).toISOString(),
    });
    const nextMonth = mk("n", { original_starts_at: p.end.toISOString() });
    const ev = evaluatePeriod([lastMinute, nextMonth], p);
    expect(ev.requiredIds).toEqual(["l"]);
    const late = mk("late", {
      original_starts_at: new Date(p.end.getTime() - 60000).toISOString(),
      completed_at: new Date(p.end.getTime() + 60000).toISOString(),
      done_event_at: new Date(p.end.getTime() + 60000).toISOString(),
    });
    expect(evaluatePeriod([late], p).complete).toBe(false);
  });
  it("14. a status set directly without a server completion record does not count", () => {
    expect(evaluatePeriod([mk("a", { done_event_at: null })], period).complete).toBe(false);
    expect(evaluatePeriod([mk("c", { source_type: "commitment" })], period).required).toBe(0);
    expect(evaluatePeriod([mk("z", { created_at: "2026-11-02T00:00:00Z" })], period).required).toBe(
      0,
    );
  });
  it("stopped-for-safety sessions never count against the reward", () => {
    const ev = evaluatePeriod(
      [...month(3), mk("s", { status: "safety_stopped", completed_at: null, done_event_at: null })],
      period,
    );
    expect(ev.complete).toBe(true);
  });
});
