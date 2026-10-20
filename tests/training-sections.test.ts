import { describe, expect, it } from "vitest";
import { matchesTrainingSection, showsActiveWorkout } from "../src/lib/training-sections";

describe("training section isolation", () => {
  const strength = { id: "weights", goal: "strength", equipment: "gym" };
  it("a running weights workout stays in Strength", () => {
    const session = { programme_id: strength.id };
    expect(showsActiveWorkout("strength", strength, session)).toBe(true);
    expect(showsActiveWorkout("bodyweight", strength, session)).toBe(false);
    expect(showsActiveWorkout("conditioning", strength, session)).toBe(false);
  });
  it("a running bodyweight strength workout stays in Bodyweight", () => {
    const programme = { id: "body", goal: "strength", equipment: "bodyweight" };
    const session = { programme_id: programme.id };
    expect(showsActiveWorkout("bodyweight", programme, session)).toBe(true);
    expect(showsActiveWorkout("strength", programme, session)).toBe(false);
    expect(showsActiveWorkout("conditioning", programme, session)).toBe(false);
  });
  it("a running gym circuit stays in Conditioning", () => {
    const programme = { id: "circuit", goal: "conditioning", equipment: "gym" };
    const session = { programme_id: programme.id };
    expect(showsActiveWorkout("conditioning", programme, session)).toBe(true);
    expect(showsActiveWorkout("strength", programme, session)).toBe(false);
    expect(showsActiveWorkout("bodyweight", programme, session)).toBe(false);
  });
  it("never renders an old session with another programme's exercises", () => {
    expect(showsActiveWorkout("strength", strength, { programme_id: "old" })).toBe(false);
  });
  it("preserves bodyweight conditioning's equipment and goal categories", () => {
    const programme = { goal: "conditioning", equipment: "bodyweight" };
    expect(matchesTrainingSection("bodyweight", programme)).toBe(true);
    expect(matchesTrainingSection("conditioning", programme)).toBe(true);
    expect(matchesTrainingSection("strength", programme)).toBe(false);
  });
});
