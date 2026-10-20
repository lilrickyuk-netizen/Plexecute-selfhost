import { describe, it, expect } from "vitest";
import { DEMO_SPECS, scoreDemo, pickDemos, resolveExerciseRef } from "../src/lib/exercise-demo";
import { EXERCISES, EX, buildSession } from "../src/lib/training";

const v = (title: string, creator = "Jeff Nippard", seconds = 120) => ({
  videoId: "abcdefghijk",
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  title,
  creator,
  platform: "YouTube" as const,
  seconds,
  embeddable: true,
  verifiedAt: new Date().toISOString(),
});

describe("exercise demonstrations", () => {
  it("every engine exercise has an exact-variation spec", () => {
    for (const e of EXERCISES) expect(DEMO_SPECS[e.key], e.key).toBeTruthy();
  });
  it("matches the exact variation and rejects others", () => {
    expect(scoreDemo("db_rdl", v("How To: Dumbbell Romanian Deadlift"))).not.toBeNull();
    expect(scoreDemo("db_rdl", v("How To Barbell Romanian Deadlift"))).toBeNull();
    expect(scoreDemo("romanian_deadlift", v("How to Romanian Deadlift with Dumbbells"))).toBeNull();
    expect(scoreDemo("bodyweight_squat", v("How to do a bodyweight squat"))).not.toBeNull();
    expect(scoreDemo("bodyweight_squat", v("How to goblet squat"))).toBeNull();
    expect(scoreDemo("back_squat", v("How to Goblet Squat"))).toBeNull();
    expect(scoreDemo("push_up", v("How to do a pike push up"))).toBeNull();
  });
  it("rejects clickbait, full workouts and unknown non-instructional creators", () => {
    expect(scoreDemo("bench_press", v("You're doing bench press WRONG!!!"))).toBeNull();
    expect(scoreDemo("bench_press", v("30 minute chest workout bench press"))).toBeNull();
    expect(scoreDemo("bench_press", v("bench press PR", "random guy"))).toBeNull();
    expect(scoreDemo("bench_press", v("Bench press", "Jeff Nippard", 40 * 60))).toBeNull();
    expect(
      pickDemos("plank", [v("Plank 30 day challenge"), v("How to plank properly")]),
    ).toHaveLength(1);
  });
  it("resolves 'exercise 2', names and RDL variants", () => {
    const w = [
      { exercise_key: "back_squat", name: "Barbell back squat" },
      { exercise_key: "bench_press", name: "Barbell bench press" },
    ];
    expect(resolveExerciseRef("How do I do exercise 2?", w, EXERCISES)).toBe("bench_press");
    expect(resolveExerciseRef("the last one", w, EXERCISES)).toBe("bench_press");
    expect(resolveExerciseRef("Show me how to do a Romanian deadlift", w, EXERCISES)).toBe(
      "romanian_deadlift",
    );
    expect(resolveExerciseRef("dumbbell romanian deadlift", w, EXERCISES)).toBe("db_rdl");
  });
  it("single sessions come from the engine: equipment, focus and duration", () => {
    const base = { goal: "general" as const, experience: "novice" as const, limitations: [] };
    const bw = buildSession({ ...base, equipment: "bodyweight", sessionMinutes: 30 }, "full");
    expect(bw.every((p) => EX[p.exercise_key]!.equipment.includes("bodyweight"))).toBe(true);
    const up = buildSession({ ...base, equipment: "gym", sessionMinutes: 45 }, "upper");
    expect(up.every((p) => EX[p.exercise_key]!.cls !== "lower_compound")).toBe(true);
    const lo = buildSession({ ...base, equipment: "gym", sessionMinutes: 45 }, "lower");
    expect(
      lo.every((p) =>
        ["squat", "hinge", "lunge", "core", "calves"].includes(
          EX[p.exercise_key]!.movement_pattern,
        ),
      ),
    ).toBe(true);
    const s20 = buildSession({ ...base, equipment: "gym", sessionMinutes: 20 }, "full");
    const mins = 8 + s20.reduce((t, p) => t + (p.sets * (45 + p.rest_sec)) / 60, 0);
    expect(mins).toBeLessThanOrEqual(22);
  });
});
