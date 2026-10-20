import { describe, it, expect } from "vitest";
import {
  serviceMonth,
  proUsage,
  proCampaignEligibility,
  afterFinal,
  mapProviderStatus,
  parseE164,
  ACK_DIGITS,
  PRO_ALLOWANCE,
  DISCLOSURE,
  CONFIRM_PROMPT,
  taskPrompt,
  ACK_MENU,
} from "@/lib/calling";

const base = {
  tier: "pro" as const,
  providerReady: true,
  marketApproved: true,
  phoneVerified: true,
  consented: true,
  callsStopped: false,
  inQuiet: false,
  safetyPause: false,
  usage: { campaignsUsed: 0, connectedSeconds: 0, includedAvailable: true },
};

describe("Pro accountability calling", () => {
  it("Pro retains 2 attempts and +10 min retry without monthly count/minute caps", () => {
    expect(PRO_ALLOWANCE).toEqual({
      maxAttempts: 2,
      retryAfterMin: 10,
    });
  });
  it("service month is anchored monthly, including for annual plans and month ends", () => {
    const a = new Date("2026-01-31T09:00:00Z");
    const w = serviceMonth(new Date("2026-03-05T00:00:00Z"), a);
    expect(w.start.toISOString()).toBe("2026-02-28T09:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-03-31T09:00:00.000Z");
    const future = serviceMonth(new Date("2026-10-02T10:00:00Z"), new Date("2027-01-15T00:00:00Z"));
    expect(future.start.toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });
  it("Pro exceeds 20 calls while combined usage remains", () => {
    expect(
      proCampaignEligibility({ ...base, usage: { ...base.usage, campaignsUsed: 21 } }),
    ).toEqual({ ok: true });
  });
  it("Pro exceeds 20 connected minutes while combined usage remains", () => {
    expect(
      proCampaignEligibility({ ...base, usage: { ...base.usage, connectedSeconds: 1260 } }),
    ).toEqual({ ok: true });
  });
  it("eligibility rules", () => {
    expect(proCampaignEligibility(base)).toEqual({ ok: true });
    expect(proCampaignEligibility({ ...base, tier: "free" })).toEqual({
      ok: false,
      reason: "tier_free",
    });
    expect(proCampaignEligibility({ ...base, marketApproved: false })).toEqual({
      ok: false,
      reason: "market_not_cleared",
    });
    expect(proCampaignEligibility({ ...base, phoneVerified: false })).toEqual({
      ok: false,
      reason: "phone_unverified",
    });
    expect(proCampaignEligibility({ ...base, consented: false })).toEqual({
      ok: false,
      reason: "no_consent",
    });
    expect(proCampaignEligibility({ ...base, callsStopped: true })).toEqual({
      ok: false,
      reason: "calls_stopped",
    });
    expect(proCampaignEligibility({ ...base, safetyPause: true })).toEqual({
      ok: false,
      reason: "safety_pause",
    });
    expect(proCampaignEligibility({ ...base, inQuiet: true })).toEqual({
      ok: false,
      reason: "quiet_hours",
    });
    expect(
      proCampaignEligibility({ ...base, usage: { ...base.usage, includedAvailable: false } }),
    ).toEqual({ ok: false, reason: "allowance_exhausted" });
    expect(
      proCampaignEligibility({
        ...base,
        usage: { ...base.usage, includedAvailable: false, connectedSeconds: 1200 },
      }),
    ).toEqual({ ok: false, reason: "allowance_exhausted" });
  });
  it("purchased minutes allow calls beyond twenty until the purchased seconds run out", () => {
    const usage = {
      campaignsUsed: 80,
      connectedSeconds: 1200 + 3599,
      topUpSeconds: 3600,
      topUpUsedSeconds: 3599,
    };
    expect(proUsage(usage).secondsLeft).toBe(1);
    expect(proCampaignEligibility({ ...base, usage })).toEqual({ ok: true });
    expect(
      proCampaignEligibility({ ...base, usage: { ...usage, topUpUsedSeconds: 3600 } }),
    ).toEqual({ ok: false, reason: "allowance_exhausted" });
  });
  it("one courtesy retry after no-answer/busy/voicemail, then stop", () => {
    const now = new Date("2026-10-02T10:00:00Z");
    for (const s of ["NO_ANSWER", "BUSY", "MACHINE_DETECTED"] as const) {
      const r = afterFinal("pro", 1, s, now);
      expect(r.state).toBe("RETRY_SCHEDULED");
      expect(r.retryAt?.getTime()).toBe(now.getTime() + 600000);
      expect(afterFinal("pro", 2, s, now)).toEqual({ state: s, retryAt: null });
    }
    expect(afterFinal("pro", 1, "FAILED", now).retryAt).toBeNull();
  });
  it("provider statuses map to domain states", () => {
    expect(mapProviderStatus("ringing")).toBe("RINGING");
    expect(mapProviderStatus("no-answer")).toBe("NO_ANSWER");
    expect(mapProviderStatus("in-progress", "machine_start")).toBe("MACHINE_DETECTED");
    expect(mapProviderStatus("in-progress", "human")).toBe("ANSWERED_PENDING_HUMAN");
  });
  it("keypad offers every acknowledgement; 9 stops all calls", () => {
    expect(new Set(Object.values(ACK_DIGITS)).size).toBe(7);
    expect(ACK_DIGITS["9"]).toBe("STOP_ALL_CALLS");
  });
  it("disclosure first, no upsell in the call script", () => {
    expect(DISCLOSURE).toBe("This is a call from Plexecute.");
    expect(`${DISCLOSURE} ${CONFIRM_PROMPT}`.split(/\s+/).length).toBeLessThanOrEqual(20);
    expect(CONFIRM_PROMPT).toBe("Say hello to speak to Coach.");
    for (const t of [DISCLOSURE, taskPrompt("Gym"), ACK_MENU])
      expect(t).not.toMatch(/upgrade|execute plan|subscribe|£/i);
  });
  it("parses E.164 numbers", () => {
    expect(parseE164("+44 7700 900123")).toEqual({ e164: "+447700900123", country: "GB" });
    expect(parseE164("07700900123")).toBeNull();
  });
});
