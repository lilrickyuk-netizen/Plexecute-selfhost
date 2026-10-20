import { describe, expect, it } from "vitest";
import { adaptForEffort, effortFeedback } from "@/lib/training";
import { isNearDuplicate } from "@/lib/task-dedupe";
import { allowedEquipment, unmentionedEquipment } from "@/lib/equipment";

describe("workout effort adaptation", () => {
  it("reads feedback", () => {
    expect(effortFeedback("finished the workout, way too easy")).toBe("too_easy");
    expect(effortFeedback("that was too hard, couldn't finish")).toBe("too_hard");
    expect(effortFeedback("done, it was not too easy")).toBe(null);
    expect(effortFeedback("done")).toBe(null);
  });
  it("makes bodyweight work harder", () => {
    const n = adaptForEffort(
      { exercise_key: "push_up", sets: 3, rep_min: 8, rep_max: 12, load_kg: null },
      "too_easy",
    );
    expect(n.rep_min).toBe(10);
    expect(n.rep_max).toBe(14);
    const m = adaptForEffort(
      { exercise_key: "push_up", sets: 3, rep_min: 15, rep_max: 20, load_kg: null },
      "too_easy",
    );
    expect(m.sets).toBe(4);
  });
  it("eases a too-hard session", () => {
    const n = adaptForEffort(
      { exercise_key: "push_up", sets: 3, rep_min: 8, rep_max: 12, load_kg: null },
      "too_hard",
    );
    expect(n.rep_max).toBe(10);
  });
});

describe("near-duplicate tasks", () => {
  it("merges two Reddit checks", () => {
    expect(
      isNearDuplicate(
        { title: "Check Reddit replies", destination: "r/SideProject" },
        { title: "Check replies on Reddit post", destination: "Reddit r/SideProject" },
      ),
    ).toBe(true);
    expect(
      isNearDuplicate({ title: "Check Reddit replies" }, { title: "Reddit reply check" }),
    ).toBe(true);
  });
  it("keeps different tasks", () => {
    expect(
      isNearDuplicate(
        { title: "Post on Reddit r/SideProject", destination: "Reddit" },
        { title: "Post on Indie Hackers", destination: "Indie Hackers" },
      ),
    ).toBe(false);
    expect(isNearDuplicate({ title: "Write CV summary" }, { title: "Shortlist 5 vacancies" })).toBe(
      false,
    );
  });
});

describe("equipment assumptions", () => {
  it("never assumes dumbbells", () => {
    expect(
      unmentionedEquipment("Dumbbell rows 3x10", "I want to get fitter at home", null),
    ).toEqual(["dumbbells"]);
    expect(unmentionedEquipment("Dumbbell rows 3x10", "I have a pair of dumbbells", null)).toEqual(
      [],
    );
    expect(unmentionedEquipment("Dumbbell rows", "I train at the gym", null)).toEqual([]);
    expect(allowedEquipment("home", "get fitter", null)).toBe("bodyweight");
    expect(allowedEquipment("gym", "I go to the gym", null)).toBe("gym");
    expect(allowedEquipment("gym", "get fitter", "gym")).toBe("gym");
  });
});
