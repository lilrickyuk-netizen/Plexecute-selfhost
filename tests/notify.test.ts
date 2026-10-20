import { describe, it, expect } from "vitest";
import {
  resolveChannels,
  prefsMap,
  defaultPref,
  nextRetry,
  isPermanent,
  quietDeferral,
  dedupeKey,
  weeklySummaryDue,
  EMAIL_SUBJECT,
  MAX_ATTEMPTS,
} from "@/lib/notify";

describe("notification delivery rules", () => {
  it("defaults: email opt-in except account/billing; weekly summary not pushed", () => {
    expect(defaultPref("UPCOMING")).toEqual({ in_app: true, push: true, email: false });
    expect(defaultPref("BILLING").email).toBe(true);
    expect(defaultPref("WEEKLY_REVIEW").push).toBe(false);
  });
  it("respects channel availability and email-allowed classes", () => {
    const p = { in_app: true, push: true, email: true };
    expect(resolveChannels("UPCOMING", p, { push: false, email: true })).toEqual([
      "in_app",
      "email",
    ]);
    expect(resolveChannels("DUE", p, { push: true, email: true })).toEqual(["in_app", "push"]);
    expect(resolveChannels("UPCOMING", p, { push: true, email: false })).toEqual([
      "in_app",
      "push",
    ]);
  });
  it("safety and account notices always appear in the app", () => {
    const off = { in_app: false, push: false, email: false };
    expect(resolveChannels("SAFETY", off, { push: true, email: true })).toEqual(["in_app"]);
    expect(resolveChannels("UPCOMING", off, { push: true, email: true })).toEqual([]);
  });
  it("legacy email reminder switch still emails upcoming reminders", () => {
    expect(
      resolveChannels("UPCOMING", defaultPref("UPCOMING"), {
        push: false,
        email: true,
        legacyEmail: true,
      }),
    ).toEqual(["in_app", "email"]);
  });
  it("prefsMap ignores unknown categories", () => {
    const m = prefsMap([
      { category: "DUE", in_app: false, push: false, email: false },
      { category: "NOPE", in_app: false, push: false, email: false },
    ]);
    expect(m.DUE.in_app).toBe(false);
    expect(m.UPCOMING.in_app).toBe(true);
  });
  it("retries 1, 5, 15, 60 minutes then gives up", () => {
    const now = new Date("2026-10-02T10:00:00Z");
    expect(nextRetry(1, now)!.getTime() - now.getTime()).toBe(60000);
    expect(nextRetry(4, now)!.getTime() - now.getTime()).toBe(3600000);
    expect(nextRetry(MAX_ATTEMPTS, now)).toBeNull();
    expect(nextRetry(1, now, 300)!.getTime() - now.getTime()).toBe(300000);
  });
  it("classifies permanent failures", () => {
    expect(isPermanent(429)).toBe(false);
    expect(isPermanent(500)).toBe(false);
    expect(isPermanent(null)).toBe(false);
    expect(isPermanent(400)).toBe(true);
    expect(isPermanent(200, "DeviceNotRegistered")).toBe(true);
  });
  it("quiet hours defer phone/email to local quiet end, across DST", () => {
    const q = { start: "22:00", end: "07:00", tz: "Europe/London" };
    // 23:30 BST on 24 Oct 2026; clocks go back on 25 Oct at 02:00 → 07:00 GMT = 07:00Z
    const at = quietDeferral(new Date("2026-10-24T22:30:00Z"), "UPCOMING", "push", q)!;
    expect(at.toISOString()).toBe("2026-10-25T07:00:00.000Z");
    // 05:00 local same morning → today 07:00
    expect(
      quietDeferral(new Date("2026-10-02T04:00:00Z"), "UPCOMING", "email", q)!.toISOString(),
    ).toBe("2026-10-02T06:00:00.000Z");
    expect(quietDeferral(new Date("2026-10-24T22:30:00Z"), "UPCOMING", "in_app", q)).toBeNull();
    expect(quietDeferral(new Date("2026-10-24T22:30:00Z"), "SAFETY", "push", q)).toBeNull();
    expect(quietDeferral(new Date("2026-10-02T12:00:00Z"), "UPCOMING", "push", q)).toBeNull();
  });
  it("dedupe keys are stable", () => {
    expect(dedupeKey(["reminder", "b1", null])).toBe("reminder:b1:-");
  });
  it("email subjects carry no health or body details", () => {
    for (const s of Object.values(EMAIL_SUBJECT))
      expect(s).not.toMatch(/weight|calorie|sleep|heart|injur|pain|kg/i);
  });
  it("weekly summary due Sunday from 18:00 local", () => {
    expect(weeklySummaryDue(new Date("2026-10-04T17:05:00Z"), "Europe/London")).toBe(true);
    expect(weeklySummaryDue(new Date("2026-10-04T16:30:00Z"), "Europe/London")).toBe(false);
    expect(weeklySummaryDue(new Date("2026-10-03T18:30:00Z"), "Europe/London")).toBe(false);
  });
});
