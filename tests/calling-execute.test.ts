import { describe, it, expect } from "vitest";
import {
  executeRetryGap,
  executeRetryBlock,
  executeCampaignEligibility,
  reputationHold,
  timedPolicyDue,
  callAnalytics,
  dayPrompt,
  missedPrompt,
  EXECUTE_ALLOWANCE,
  EXECUTE_CEILINGS,
} from "@/lib/calling";

const r = {
  attempts: 1,
  userMax: 6,
  attemptsLast24h: 1,
  unresolved: true,
  inWindow: true,
  inQuiet: false,
  callsStopped: false,
  safetyPause: false,
  reputationHold: false,
};
const e = {
  tier: "execute" as const,
  providerReady: true,
  marketApproved: true,
  phoneVerified: true,
  consented: true,
  callsStopped: false,
  inQuiet: false,
  safetyPause: false,
  attemptsLast24h: 0,
  connectedSecondsUsed: 0,
  topUpSeconds: 0,
  reputationHold: false,
};

describe("Execute persistent calling", () => {
  it("retry schedule: +5, +10, +20, then every 30 minutes", () => {
    expect([1, 2, 3, 4, 5, 9].map(executeRetryGap)).toEqual([5, 10, 20, 30, 30, 30]);
  });
  it("ceilings: 6 per session (or lower user/market cap) and 12 per rolling 24 hours", () => {
    expect(EXECUTE_CEILINGS).toEqual({ perOccurrence: 6, rolling24h: 12 });
    expect(executeRetryBlock(r)).toBeNull();
    expect(executeRetryBlock({ ...r, attempts: 6 })).toBe("occurrence_ceiling");
    expect(executeRetryBlock({ ...r, attempts: 3, userMax: 3 })).toBe("occurrence_ceiling");
    expect(executeRetryBlock({ ...r, attempts: 2, marketMax: 2 })).toBe("occurrence_ceiling");
    expect(executeRetryBlock({ ...r, userMax: 99, attempts: 6 })).toBe("occurrence_ceiling");
    expect(executeRetryBlock({ ...r, attemptsLast24h: 12 })).toBe("rolling_ceiling");
  });
  it("stops when resolved, out of window, quiet hours, stopped, safety or reputation hold", () => {
    expect(executeRetryBlock({ ...r, unresolved: false })).toBe("resolved");
    expect(executeRetryBlock({ ...r, inWindow: false })).toBe("window_ended");
    expect(executeRetryBlock({ ...r, inQuiet: true })).toBe("quiet_hours");
    expect(executeRetryBlock({ ...r, callsStopped: true })).toBe("calls_stopped");
    expect(executeRetryBlock({ ...r, safetyPause: true })).toBe("safety_pause");
    expect(executeRetryBlock({ ...r, reputationHold: true })).toBe("reputation_hold");
  });
  it("Execute allowance: 120 connected minutes plus purchased top-ups; Pro can't inherit persistence", () => {
    expect(EXECUTE_ALLOWANCE.connectedMinutes).toBe(120);
    expect(executeCampaignEligibility(e)).toEqual({ ok: true });
    expect(executeCampaignEligibility({ ...e, connectedSecondsUsed: 7200 })).toEqual({
      ok: false,
      reason: "allowance_exhausted",
    });
    expect(
      executeCampaignEligibility({ ...e, connectedSecondsUsed: 7200, topUpSeconds: 3600 }),
    ).toEqual({ ok: true });
    expect(executeCampaignEligibility({ ...e, tier: "pro" })).toEqual({
      ok: false,
      reason: "not_execute",
    });
    expect(executeCampaignEligibility({ ...e, tier: "free" })).toEqual({
      ok: false,
      reason: "tier_free",
    });
    expect(executeCampaignEligibility({ ...e, marketApproved: false })).toEqual({
      ok: false,
      reason: "market_not_cleared",
    });
    expect(executeCampaignEligibility({ ...e, attemptsLast24h: 12 })).toEqual({
      ok: false,
      reason: "rolling_ceiling",
    });
  });
  it("reputation guard pauses calls when most recent calls go unanswered", () => {
    expect(reputationHold(Array.from({ length: 9 }, () => ({ answered: false })))).toBe(false);
    expect(
      reputationHold([
        ...Array.from({ length: 9 }, () => ({ answered: false })),
        { answered: true },
      ]),
    ).toBe(true);
    expect(
      reputationHold([
        ...Array.from({ length: 8 }, () => ({ answered: false })),
        { answered: true },
        { answered: true },
      ]),
    ).toBe(false);
  });
  it("morning/evening policies fire once inside the 5-minute tick, across midnight", () => {
    expect(timedPolicyDue(8 * 60 + 2, "08:00")).toBe(true);
    expect(timedPolicyDue(8 * 60 + 5, "08:00")).toBe(false);
    expect(timedPolicyDue(2, "00:00")).toBe(true);
    expect(timedPolicyDue(1439, "00:00")).toBe(false);
  });
  it("analytics", () => {
    const a = callAnalytics([
      { state: "ACKNOWLEDGED", attempts: 1, acknowledgement: "START_NOW", connected_seconds: 40 },
      { state: "NO_ANSWER", attempts: 3, acknowledgement: null, connected_seconds: 0 },
    ]);
    expect(a).toMatchObject({
      campaigns: 2,
      attempts: 4,
      answerRate: 0.5,
      ackRate: 0.5,
      startRate: 0.5,
      avgAttempts: 2,
      connectedSeconds: 40,
    });
    expect(callAnalytics([]).answerRate).toBeNull();
  });
  it("scripts: no upsell, no shame", () => {
    const texts = [
      dayPrompt("morning", [{ title: "Gym", status: "planned" }]),
      dayPrompt("evening", [{ title: "Gym", status: "expired" }]),
      missedPrompt("Gym"),
      dayPrompt("morning", []),
    ];
    for (const t of texts) expect(t).not.toMatch(/upgrade|subscribe|£|lazy|failed you|disappoint/i);
    expect(
      dayPrompt("evening", [
        { title: "A", status: "done" },
        { title: "B", status: "planned" },
      ]),
    ).toMatch(/completed 1 of 2/);
  });
});
