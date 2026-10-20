import { describe, it, expect } from "vitest";
import { buildWeekPlan, startOfWeek } from "../src/lib/scheduler";
import { buildProgramme, resolveExercises, EX } from "../src/lib/training";
import { DEMO_SPECS } from "../src/lib/exercise-demo";
import { localHm, zonedParts } from "../src/lib/tz";

// The owner's real setup on 15 Oct 2026: wake 06:30, work 09:00-17:00 Mon-Fri, three other active goals.
const profile = {
  timezone: "Europe/London",
  wake_time: "06:30",
  sleep_time: "23:30",
  work_start: "09:00",
  work_end: "17:00",
  work_days: [1, 2, 3, 4, 5],
  commitments: [],
} as never;
const goals = [
  {
    id: "t",
    title: "Train",
    domain: "training",
    weekly_minutes: 300,
    session_minutes: 60,
    preferred_time: "morning",
    preferred_days: [1, 2, 3, 4, 5],
    preferred_start: "07:00",
  },
  {
    id: "l",
    title: "Learn a new skill",
    domain: "learning",
    weekly_minutes: 300,
    session_minutes: 60,
    preferred_time: "any",
  },
  {
    id: "c",
    title: "Scale my online platform",
    domain: "career",
    weekly_minutes: 300,
    session_minutes: 60,
    preferred_time: "any",
  },
  {
    id: "m",
    title: "Weekly meal prep",
    domain: "meal_prep",
    weekly_minutes: 145,
    session_minutes: 73,
    preferred_time: "evening",
  },
] as never;

describe("7am Monday to Friday is honoured even with other goals competing", () => {
  it("places every training session at 07:00 on weekdays only", () => {
    const ws = startOfWeek(new Date("2026-10-19T12:00:00Z"), "Europe/London");
    const plan = buildWeekPlan(profile, goals, ws);
    const train = plan.blocks.filter((b) => b.goal_id === "t");
    expect(train).toHaveLength(5);
    for (const b of train) {
      expect(localHm(b.starts_at, "Europe/London")).toBe("07:00");
      expect(zonedParts(b.starts_at, "Europe/London").isoDow).toBeLessThanOrEqual(5);
    }
  });
});

describe("member-named exercises", () => {
  it("maps everyday words to real exercises", () => {
    const r = resolveExercises(
      ["pull ups", "dips", "push ups", "squats", "Burpees", "ab exercises"],
      "bodyweight",
    );
    expect(r.unknown).toEqual([]);
    for (const k of [
      "pull_up",
      "dip",
      "push_up",
      "bodyweight_squat",
      "burpee",
      "lying_leg_raise",
      "bicycle_crunch",
    ])
      expect(r.keys).toContain(k);
  });
  it("builds every session from exactly those exercises", () => {
    const { keys } = resolveExercises(
      ["pull ups", "dips", "push ups", "squats", "burpees", "abs"],
      "bodyweight",
    );
    const p = buildProgramme({
      goal: "hypertrophy",
      experience: "novice",
      equipment: "bodyweight",
      days: 5,
      sessionMinutes: 60,
      limitations: [],
      exercises: keys,
    });
    expect(p.template_key).toBe("member_circuit");
    for (let d = 0; d < 5; d++)
      expect(p.prescriptions.filter((x) => x.day_index === d).map((x) => x.exercise_key)).toEqual(
        keys,
      );
    const mins =
      8 +
      p.prescriptions
        .filter((x) => x.day_index === 0)
        .reduce((t, x) => t + (x.sets * (45 + x.rest_sec)) / 60, 0);
    expect(mins).toBeLessThanOrEqual(62);
  });
  it("new exercises have demonstrations", () => {
    for (const k of [
      "dip",
      "bench_dip",
      "burpee",
      "mountain_climber",
      "lying_leg_raise",
      "bicycle_crunch",
    ]) {
      expect(EX[k], k).toBeTruthy();
      expect(DEMO_SPECS[k], k).toBeTruthy();
    }
  });
});

describe("standing orders run until the goal", () => {
  it("ends on goal completion or target weight, not before", async () => {
    const { orderFinished, needsNextWeek } = await import("../src/lib/standing-orders.server");
    const o = { target_weight_kg: 75, params: { start_weight_kg: 65 } } as never;
    expect(orderFinished(o, "active", 70)).toBeNull();
    expect(orderFinished(o, "active", 75.2)).toBe("target_weight_reached");
    expect(orderFinished(o, "completed", null)).toBe("goal_completed");
    expect(needsNextWeek("2026-10-15", 0)).toBe(true); // Thursday, nothing planned next week
    expect(needsNextWeek("2026-10-15", 5)).toBe(false);
    expect(needsNextWeek("2026-10-13", 0)).toBe(false); // Tuesday: too early
  });
  it("training is never saved as a fixed commitment", async () => {
    const { isOwnTrainingSession } = await import("../src/lib/coach-tools.server");
    expect(isOwnTrainingSession("Gym session")).toBe(true);
    expect(isOwnTrainingSession("Morning workout")).toBe(true);
    expect(isOwnTrainingSession("Physio appointment")).toBe(false);
    expect(isOwnTrainingSession("Sons' football match")).toBe(false);
  });
});
