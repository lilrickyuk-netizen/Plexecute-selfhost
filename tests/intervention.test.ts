import { describe, it, expect } from "vitest";
import {
  decideIntervention,
  adaptiveBudget,
  type InterventionInput,
} from "../src/lib/intervention";
const now = new Date("2026-10-01T10:05:00Z");
const base: InterventionInput = {
  now,
  kind: "adaptive",
  tier: "pro",
  level: "adaptive",
  remindersEnabled: true,
  chosenBudget: 6,
  block: { status: "due", starts_at: "2026-10-01T10:00:00Z", duration_min: 30 },
  leadMin: 10,
  inQuiet: false,
  conflict: false,
  safety: { pauseAccountability: false, stopOrdinaryCoaching: false },
  recoveryRed: false,
  alreadySentForBlock: false,
  adaptiveSentToday: 0,
  lastAdaptiveAt: null,
  reminderOnly: { n: 0, actedOn: 0 },
  emailAllowed: false,
};
describe("intervention engine", () => {
  it("authorises a due-not-started nudge", () =>
    expect(decideIntervention(base)).toMatchObject({ allowed: true, channels: ["in_app"] }));
  it("free tier: user reminders only", () => {
    expect(adaptiveBudget("free", 6)).toBe(0);
    expect(decideIntervention({ ...base, tier: "free" }).reason).toBe("tier_reminders_only");
    expect(
      decideIntervention({
        ...base,
        tier: "free",
        kind: "reminder",
        block: { ...base.block, status: "upcoming", starts_at: "2026-10-01T10:10:00Z" },
      }).allowed,
    ).toBe(true);
  });
  it("hard cap 12", () => expect(adaptiveBudget("pro", 40)).toBe(12));
  it("enforces budget and 30-minute spacing", () => {
    expect(decideIntervention({ ...base, adaptiveSentToday: 6 }).reason).toBe(
      "daily_budget_reached",
    );
    expect(decideIntervention({ ...base, lastAdaptiveAt: "2026-10-01T09:50:00Z" }).reason).toBe(
      "min_spacing",
    );
  });
  it("user reminders are exempt from spacing", () => {
    expect(
      decideIntervention({
        ...base,
        kind: "reminder",
        lastAdaptiveAt: "2026-10-01T10:04:00Z",
        adaptiveSentToday: 12,
        block: { ...base.block, status: "upcoming", starts_at: "2026-10-01T10:10:00Z" },
      }).allowed,
    ).toBe(true);
  });
  it("respects quiet hours, conflicts, recovery, safety and user choice", () => {
    expect(decideIntervention({ ...base, inQuiet: true }).reason).toBe("quiet_hours");
    expect(decideIntervention({ ...base, conflict: true }).reason).toBe("calendar_conflict");
    expect(decideIntervention({ ...base, recoveryRed: true }).reason).toBe("recovery_red");
    expect(
      decideIntervention({
        ...base,
        safety: { pauseAccountability: true, stopOrdinaryCoaching: false },
      }).reason,
    ).toBe("safety_pause");
    expect(decideIntervention({ ...base, level: "reminders_only" }).reason).toBe(
      "level_reminders_only",
    );
    expect(decideIntervention({ ...base, level: "off" }).reason).toBe("user_turned_off");
  });
  it("prefers the minimum effective intervention", () => {
    expect(decideIntervention({ ...base, reminderOnly: { n: 6, actedOn: 4 } }).reason).toBe(
      "reminder_alone_effective",
    );
    expect(decideIntervention({ ...base, reminderOnly: { n: 4, actedOn: 4 } }).allowed).toBe(true);
  });
  it("email never in quiet hours", () => {
    const r = {
      ...base,
      kind: "reminder" as const,
      emailAllowed: true,
      block: { ...base.block, status: "upcoming", starts_at: "2026-10-01T10:10:00Z" },
    };
    expect(decideIntervention(r).channels).toEqual(["in_app", "email"]);
    expect(decideIntervention({ ...r, inQuiet: true }).channels).toEqual(["in_app"]);
  });
});
