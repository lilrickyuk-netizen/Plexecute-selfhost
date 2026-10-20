import { describe, expect, it } from "vitest";
import { adaptForRecovery, assessRecovery } from "@/lib/recovery-state";
import { recommend, hasDistress, buildSession } from "@/lib/wellness";
import { hasRedFlag, prescribeCardio } from "@/lib/movement";
import { capTargetChange } from "@/lib/nutrition-engine";

describe("recovery", () => {
  it("is UNKNOWN without a check-in, never GREEN", () =>
    expect(assessRecovery({ checkin: null }).state).toBe("UNKNOWN"));
  it("RED on very high soreness", () =>
    expect(
      assessRecovery({ checkin: { sleep_quality: 3, energy: 3, soreness: 5, stress: 2 } }).state,
    ).toBe("RED"));
  it("never touches protected sessions", () => {
    const r = adaptForRecovery("RED", [
      {
        id: "a",
        goal_id: "g",
        title: "Run",
        domain: "cardio",
        starts_at: "",
        duration_min: 40,
        is_protected: true,
      },
    ]);
    expect(r.changes).toHaveLength(0);
  });
  it("RED replaces hard sessions with 20 min recovery", () => {
    const r = adaptForRecovery("RED", [
      {
        id: "a",
        goal_id: "g",
        title: "Squat",
        domain: "training",
        starts_at: "",
        duration_min: 60,
        is_protected: false,
      },
    ]);
    expect(r.blocks[0]!.duration_min).toBe(20);
  });
});

describe("wellness", () => {
  const prefs = {
    session_types: ["mindfulness", "breath"],
    experience: "beginner" as const,
    min_minutes: 5,
    max_minutes: 15,
    preferred_time: "evening",
  };
  it("starts beginners at 5 minutes", () => expect(recommend(prefs, [], 14).minutes).toBe(5));
  it("lengthens after three full sessions", () => {
    const h = Array.from({ length: 3 }, () => ({
      session_type: "breath",
      planned_minutes: 5,
      actual_minutes: 5,
      completion_state: "completed",
      useful: 4,
      created_at: "",
    }));
    expect(recommend(prefs, h, 14).minutes).toBe(7);
  });
  it("detects crisis language", () => expect(hasDistress("I want to hurt myself")).toBe(true));
  it("script timings fill the session", () =>
    expect(
      buildSession("body_scan", 10).steps.reduce((s, x) => s + x.seconds, 0),
    ).toBeGreaterThanOrEqual(590));
});

describe("movement & nutrition", () => {
  it("flags red-flag notes", () => expect(hasRedFlag("sharp pain in knee")).toBe(true));
  it("starts cardio at a base duration", () =>
    expect(prescribeCardio("easy", []).minutes).toBeGreaterThan(0));
  it("caps automatic kcal changes at 150", () =>
    expect(capTargetChange(2000, 2300).needsApproval).toBe(true));
});

import { buildWeekPlan as bwp, startOfWeek as sow } from "../src/lib/scheduler";
describe("commitments", () => {
  it("never places sessions over a weekly commitment", () => {
    const ws = sow(new Date("2026-10-05T12:00:00"));
    const r = bwp(
      {
        wake_time: "07:00",
        sleep_time: "23:00",
        work_start: null,
        work_end: null,
        work_days: [],
        commitments: [
          {
            recurrence: "weekly",
            days: [1, 2, 3, 4, 5, 6, 7],
            on_date: null,
            start_time: "07:00",
            end_time: "20:00",
          },
        ],
      },
      [
        {
          id: "g",
          title: "Run",
          domain: "cardio",
          weekly_minutes: 90,
          session_minutes: 30,
          preferred_time: "morning",
        },
      ],
      ws,
    );
    for (const b of r.blocks) {
      const d = new Date(b.starts_at);
      expect(d.getHours() * 60 + d.getMinutes()).toBeGreaterThanOrEqual(20 * 60 + 15);
    }
    expect(r.blocks.length).toBe(3);
  });
});
