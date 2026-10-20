import { describe, it, expect } from "vitest";
import { buildProgramme, EXERCISES, nextTrainingDay, returningLoad } from "../src/lib/training";
import { assessRecovery } from "../src/lib/recovery-state";
import { wearableEvidence } from "../src/lib/training.functions";
const now = new Date("2026-10-01T12:00:00Z");
describe("training engine additions", () => {
  it("no-equipment programmes never prescribe table/towel rows", () => {
    const p = buildProgramme({
      goal: "strength",
      experience: "novice",
      equipment: "bodyweight",
      days: 3,
      sessionMinutes: 45,
      limitations: [],
    });
    expect(p.prescriptions.some((x) => x.exercise_key === "prone_w_raise")).toBe(true);
    expect(p.prescriptions.some((x) => x.exercise_key === "towel_row")).toBe(false);
    const row = EXERCISES.find((x) => x.key === "towel_row");
    expect(row?.equipment).not.toContain("bodyweight");
  });
  it("conditioning uses short rest, mixed alternates strength and muscle days", () => {
    const c = buildProgramme({
      goal: "conditioning",
      experience: "novice",
      equipment: "bodyweight",
      days: 3,
      sessionMinutes: 30,
      limitations: [],
    });
    expect(c.prescriptions.every((p) => p.rest_sec <= 75)).toBe(true);
    const m = buildProgramme({
      goal: "mixed",
      experience: "intermediate",
      equipment: "gym",
      days: 3,
      sessionMinutes: 75,
      limitations: [],
    });
    expect(m.prescriptions.find((p) => p.day_index === 0 && p.order_index === 0)!.rep_max).toBe(6);
    expect(m.prescriptions.find((p) => p.day_index === 1 && p.order_index === 0)!.rep_max).toBe(12);
  });
  it("resumes in sequence and eases loads after a break", () => {
    expect(nextTrainingDay([], 3, now).dayIndex).toBe(0);
    const r = nextTrainingDay(
      [
        { day_index: 1, status: "completed", started_at: "2026-09-10T10:00:00Z" },
        { day_index: 0, status: "abandoned", started_at: "2026-09-20T10:00:00Z" },
      ],
      3,
      now,
    );
    expect(r.dayIndex).toBe(2);
    expect(r.returnFactor).toBe(0.9);
    expect(returningLoad(100, 0.9)).toBe(90);
  });
  it("wearable resting HR rise makes recovery AMBER", () => {
    const s = [
      { kind: "resting_hr", value: 62, recorded_at: "2026-10-01T07:00:00Z" },
      ...[1, 2, 3, 4].map((d) => ({
        kind: "resting_hr",
        value: 54,
        recorded_at: `2026-09-2${d}T07:00:00Z`,
      })),
    ];
    const w = wearableEvidence(s, now.getTime());
    expect(w.restingHrDelta).toBe(8);
    expect(
      assessRecovery({ checkin: { sleep_quality: 4, energy: 4, soreness: 2, stress: 2 }, ...w })
        .state,
    ).toBe("AMBER");
  });
});
