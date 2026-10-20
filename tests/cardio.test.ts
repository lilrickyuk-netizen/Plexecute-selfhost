import { describe, it, expect } from "vitest";
import { recoveryGate, weeklyCardio, moderateEquivalent } from "../src/lib/movement";
describe("cardio engine", () => {
  it("recovery gates intensity", () => {
    expect(recoveryGate("vigorous", 40, "AMBER")).toMatchObject({
      intensity: "moderate",
      minutes: 40,
    });
    expect(recoveryGate("moderate", 40, "RED")).toMatchObject({ intensity: "easy", minutes: 40 });
    expect(recoveryGate("vigorous", 40, "GREEN").minutes).toBe(40);
  });
  it("weekly minutes count intensity and steps", () => {
    expect(moderateEquivalent(20, "vigorous")).toBe(40);
    const w = weeklyCardio(
      "health",
      [
        { duration_min: 30, prescribed: { intensity: "moderate" }, completed: true },
        { duration_min: 20, prescribed: { intensity: "vigorous" }, completed: true },
      ],
      [9000],
    );
    expect(w.done).toBe(90);
    expect(w.remaining).toBe(60);
  });
});
