import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveDay, parseTime, callMinute, commitmentKey, kindFor } from "@/lib/coach-scheduling";
import { COACH_DENIED_TABLES, coachMayAccess, FREE_TOOLS } from "@/lib/coach-tools";
import { guardCoachDb, TOOL_DEFS } from "@/lib/coach-tools.server";
import { zonedInstant } from "@/lib/tz";

// Sunday 11 Oct 2026
const today = "2026-10-11";

describe("Coach request → time resolution (no special cases)", () => {
  it("doctor tomorrow at 12, call 30 min before", () => {
    const day = resolveDay("tomorrow", today)!;
    const start = parseTime("12:00")!;
    expect(day).toBe("2026-10-12");
    expect(callMinute(start, { lead_minutes: 30 })).toBe(11 * 60 + 30);
    expect(zonedInstant(day, 11 * 60 + 30, "Europe/London").toISOString()).toBe(
      "2026-10-12T10:30:00.000Z",
    );
  });
  it("dentist tomorrow at 2 (pm), 30 minutes before", () => {
    expect(parseTime("14:00")).toBe(840);
    expect(parseTime("2pm")).toBe(840);
    expect(callMinute(840, { lead_minutes: 30 })).toBe(810);
  });
  it("meeting Friday at 9, ring at 8:30", () => {
    expect(resolveDay("friday", today)).toBe("2026-10-16");
    expect(callMinute(540, { call_time: "08:30" })).toBe(510);
  });
  it("exam next Monday at 10, an hour before", () => {
    expect(resolveDay("next monday", today)).toBe("2026-10-12");
    expect(resolveDay("monday", "2026-10-12")).toBe("2026-10-19");
    expect(callMinute(600, { lead_minutes: 60 })).toBe(540);
    expect(kindFor("exam")).toBe("study");
  });
  it("same request twice gives the same dedupe key", () => {
    expect(commitmentKey("Doctor's appointment", "2026-10-12", 720)).toBe(
      commitmentKey("doctor's  Appointment", "2026-10-12", 720),
    );
  });
  it("rejects nonsense", () => {
    expect(resolveDay("someday", today)).toBeNull();
    expect(parseTime("25:00")).toBeNull();
  });
});

describe("Coach access boundary is technically enforced", () => {
  const fake = { from: (t: string) => ({ table: t }), rpc: () => 1 };
  const g = guardCoachDb(fake);
  it("blocks every denied table and rpc", () => {
    for (const t of COACH_DENIED_TABLES) expect(() => g.from(t)).toThrow(/COACH_ACCESS_DENIED/);
    expect(() => g.rpc()).toThrow(/COACH_ACCESS_DENIED/);
  });
  it("allows life/planning tables", () => {
    for (const t of [
      "goals",
      "plan_blocks",
      "commitments",
      "scheduled_calls",
      "food_entries",
      "wellness_sessions",
    ])
      expect(g.from(t)).toEqual({ table: t });
  });
  it("covers payment, security, secret and admin tables", () => {
    for (const t of [
      "subscriptions",
      "billing_events",
      "phone_numbers",
      "calendar_credentials",
      "wearable_credentials",
      "user_roles",
      "admin_access_log",
      "owner_notes",
    ])
      expect(coachMayAccess(t)).toBe(false);
  });
  it("coach tool code never bypasses the guard", () => {
    const src = readFileSync("src/lib/coach-tools.server.ts", "utf8");
    // The only raw admin import is inside adminDb(), which wraps it.
    expect(src.match(/client\.server"\)/g)?.length).toBe(1);
    expect(src).toMatch(/exec\(\{ \.\.\.ctx, db: guardCoachDb\(ctx\.db\) \}/);
    for (const t of COACH_DENIED_TABLES) expect(src).not.toContain(`from("${t}")`);
  });
  it("execution tools are registered and available to every tier", () => {
    const names = TOOL_DEFS.map((t) => t.name);
    for (const n of [
      "schedule_commitment",
      "get_schedule_context",
      "get_journal_context",
      "cancel_scheduled_call",
    ] as const)
      expect(names).toContain(n);
    expect(FREE_TOOLS).toContain("schedule_commitment");
  });
});
