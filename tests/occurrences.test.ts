import { describe, it, expect } from "vitest";
import { isReplanReplaceable, kindForDomain, routineOccurrences } from "@/lib/occurrences";
import { buildWeekPlan, startOfWeek } from "@/lib/scheduler";
describe("occurrences", () => {
  it("reserves a live wake routine instead of replacing it during a replan", () => {
    const now = "2026-10-17T06:00:00Z";
    const wake = {
      status: "planned",
      source_type: "routine",
      is_protected: false,
      starts_at: "2026-10-19T06:00:00Z",
      duration_min: 10,
      domain: "admin",
      goal_id: null,
    };
    expect(isReplanReplaceable(wake, now)).toBe(false);
    expect(isReplanReplaceable({ ...wake, source_type: "commitment" }, now)).toBe(false);
    expect(isReplanReplaceable({ ...wake, source_type: "goal" }, now)).toBe(true);
    expect(isReplanReplaceable({ ...wake, source_type: "manual", is_protected: true }, now)).toBe(
      false,
    );
    const fixed = [wake].filter((b) => !isReplanReplaceable(b, now));
    const plan = buildWeekPlan(
      {
        timezone: "Europe/London",
        wake_time: "07:00",
        sleep_time: "23:00",
        work_start: "09:00",
        work_end: "17:00",
        work_days: [1],
        commitments: [],
      },
      [
        {
          id: "strength",
          title: "Strength",
          domain: "training",
          weekly_minutes: 45,
          session_minutes: 45,
          preferred_days: [1],
          preferred_start: "07:00",
          priority: 3,
        },
      ],
      startOfWeek(new Date("2026-10-19T12:00:00Z"), "Europe/London"),
      { fixed },
    );
    expect(plan.blocks).toHaveLength(1);
    expect(Date.parse(plan.blocks[0]?.starts_at ?? "")).toBeGreaterThanOrEqual(
      Date.parse(wake.starts_at) + 10 * 60000,
    );
  });
  it("maps domains to kinds", () => {
    expect(kindForDomain("training")).toBe("workout");
    expect(kindForDomain("wellness")).toBe("meditation");
    expect(kindForDomain("training", "Easy walk")).toBe("recovery_action");
  });
  it("creates wake and prep occurrences deterministically", () => {
    const ws = new Date(2026, 9, 5); // Monday
    const occ = routineOccurrences(
      { wake_time: "06:30", work_start: "09:00", work_days: [1, 2] },
      [
        {
          id: "c1",
          title: "Standup",
          kind: "meeting",
          recurrence: "weekly",
          days: [1],
          on_date: null,
          start_time: "10:00",
          active: true,
        },
      ],
      ws,
      new Date(2026, 9, 1),
    );
    expect(occ.filter((o) => o.occurrence_kind === "wake_for_work")).toHaveLength(2);
    const prep = occ.find((o) => o.occurrence_kind === "meeting_prep")!;
    expect(new Date(prep.starts_at).getHours()).toBe(9);
    expect(new Date(prep.starts_at).getMinutes()).toBe(45);
    expect(
      routineOccurrences(
        { wake_time: "06:30", work_start: "09:00", work_days: [1, 2] },
        [],
        ws,
        new Date(2026, 9, 1),
      ),
    ).toEqual(
      routineOccurrences(
        { wake_time: "06:30", work_start: "09:00", work_days: [1, 2] },
        [],
        ws,
        new Date(2026, 9, 1),
      ),
    );
  });
});
