import { describe, expect, it } from "vitest";
import { buildConditioningProgramme } from "../src/lib/conditioning";

describe("conditioning programme", () => {
  it("always has HIIT, circuit and aerobic days — never the bodyweight strength programme", () => {
    const p = buildConditioningProgramme({ experience: "intermediate" });
    expect(p.days.map((d) => d.key)).toEqual(["hiit", "circuit", "aerobic"]);
    const hiit = p.days[0]!;
    expect(hiit.blocks.some((b) => b.heading.includes("5 rounds"))).toBe(true);
    const steps = hiit.blocks.flatMap((b) => b.steps.map((s) => `${s.name} ${s.amount}`));
    expect(steps.some((s) => s.includes("Sprint") && s.includes("30 seconds"))).toBe(true);
    expect(steps.some((s) => s.includes("90 seconds"))).toBe(true);
    expect(steps.some((s) => s.includes("Burpees"))).toBe(true);
    expect(steps.some((s) => s.includes("Mountain climbers"))).toBe(true);
    expect(steps.some((s) => s.includes("Plank"))).toBe(true);
  });

  it("keeps the circuit structure with kettlebell and dumbbell work on gym equipment", () => {
    const p = buildConditioningProgramme({ equipment: "gym", experience: "intermediate" });
    const steps = p.days[1]!.blocks.flatMap((b) => b.steps.map((s) => s.name));
    expect(steps).toContain("Kettlebell swings");
    expect(steps).toContain("Push-ups");
    expect(steps).toContain("Goblet squats");
    expect(steps).toContain("Dumbbell rows");
    expect(steps.some((s) => s.includes("250m row"))).toBe(true);
  });

  it("swaps weighted moves for no-equipment versions on bodyweight", () => {
    const p = buildConditioningProgramme({ equipment: "bodyweight" });
    const steps = p.days[1]!.blocks.flatMap((b) => b.steps.map((s) => s.name));
    expect(steps).toContain("Squat jumps");
    expect(steps).toContain("Air squats");
    expect(steps).toContain("Towel rows or superman pulls");
    expect(steps).not.toContain("Kettlebell swings");
    expect(steps).not.toContain("Dumbbell rows");
  });

  it("eases rounds and recoveries for a newer member", () => {
    const p = buildConditioningProgramme({ experience: "novice" });
    expect(p.days[0]!.blocks.some((b) => b.heading.includes("3 rounds"))).toBe(true);
    const steps = p.days[0]!.blocks.flatMap((b) => b.steps.map((s) => `${s.name} ${s.amount}`));
    expect(steps.some((s) => s.includes("20 seconds"))).toBe(true);
    expect(steps.some((s) => s.includes("120 seconds"))).toBe(true);
  });

  it("adjusts around injuries without diagnosing", () => {
    const p = buildConditioningProgramme({ limitations: ["knee_pain"] });
    const all = p.days.flatMap((d) => d.blocks.flatMap((b) => b.steps.map((s) => s.name)));
    expect(all).toContain("Step-back burpees (no jump)");
    expect(all).toContain("Glute bridges");
    const aerobic = p.days[2]!.blocks.flatMap((b) => b.steps.map((s) => s.amount)).join(" ");
    expect(aerobic).not.toContain("jogging");
    expect(aerobic).toContain("cycling");
  });

  it("lays out the weekly schedule and progression rules", () => {
    const p = buildConditioningProgramme({ daysPerWeek: 3 });
    expect(p.schedule).toEqual([
      { day: "Monday", session: "HIIT conditioning" },
      { day: "Wednesday", session: "Circuit conditioning" },
      { day: "Friday", session: "Aerobic base training" },
      { day: "Tuesday / Thursday / Saturday", session: "Strength training or mobility work" },
      { day: "Sunday", session: "Recovery" },
    ]);
    expect(p.progression.join(" ")).toContain("Add 1 round to circuits");
    expect(p.progression.join(" ")).toContain("5–10 seconds");
  });

  it("never references any specific user type", () => {
    const p = buildConditioningProgramme({});
    expect(JSON.stringify(p).toLowerCase()).not.toContain("construction");
    expect(JSON.stringify(p).toLowerCase()).not.toContain("student");
  });
});
