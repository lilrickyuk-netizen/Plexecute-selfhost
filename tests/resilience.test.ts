import { describe, expect, it } from "vitest";
import {
  serviceState,
  stateLabel,
  stateDetail,
  retryDelayMinutes,
  shouldRetry,
  MAX_BACKGROUND_ATTEMPTS,
} from "@/lib/resilience";

describe("resilience rules", () => {
  it("unconfigured services report not_configured regardless of outcomes", () => {
    expect(serviceState({ configured: false })).toBe("not_configured");
    expect(serviceState({ configured: false, recent: [true, true, true] })).toBe("not_configured");
  });

  it("a paused flag wins over everything, including failures", () => {
    expect(
      serviceState({ configured: true, pausedByFlag: true, recent: [false, false, false] }),
    ).toBe("paused");
  });

  it("working when recent calls mostly succeed", () => {
    expect(serviceState({ configured: true, recent: [true, true, false] })).toBe("working");
    expect(serviceState({ configured: true })).toBe("working");
  });

  it("degraded when the majority of the last few calls failed", () => {
    expect(serviceState({ configured: true, recent: [false, false, true] })).toBe("degraded");
    expect(serviceState({ configured: true, recent: [false, false, false, false, true] })).toBe(
      "degraded",
    );
  });

  it("one or two failures alone never degrade a service", () => {
    expect(serviceState({ configured: true, recent: [false] })).toBe("working");
    expect(serviceState({ configured: true, recent: [false, false] })).toBe("working");
  });

  it("member wording never leaks provider names, codes or internals", () => {
    for (const s of ["working", "not_configured", "degraded", "paused"] as const) {
      const text = `${stateLabel(s)} ${stateDetail(s, "x")}`.toLowerCase();
      for (const banned of [
        "stripe",
        "twilio",
        "resend",
        "500",
        "error",
        "api",
        "token",
        "exception",
      ]) {
        expect(text).not.toContain(banned);
      }
    }
  });

  it("degraded and paused wording reassures the member their plan still works", () => {
    expect(stateDetail("degraded", "x")).toContain("still work");
    expect(stateDetail("paused", "x")).toContain("still work");
  });

  it("retry backoff is bounded, increasing and capped at 6 hours", () => {
    const seq = [1, 2, 3, 4, 5, 6, 100].map(retryDelayMinutes);
    expect(seq).toEqual([5, 15, 60, 180, 360, 360, 360]);
    expect(Math.max(...seq)).toBeLessThanOrEqual(360);
  });

  it("gives up after the attempt ceiling so items go to admin replay", () => {
    expect(shouldRetry(1)).toBe(true);
    expect(shouldRetry(MAX_BACKGROUND_ATTEMPTS - 1)).toBe(true);
    expect(shouldRetry(MAX_BACKGROUND_ATTEMPTS)).toBe(false);
  });
});
