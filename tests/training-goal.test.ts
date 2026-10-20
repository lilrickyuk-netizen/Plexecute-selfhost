import { describe, expect, it } from "vitest";
import { isTrainingGoal, planTrainingGoalMerge } from "@/lib/training-goal";
const g = (id: string, title: string, domain: string, status = "active", created_at = id) => ({
  id,
  title,
  domain,
  status,
  created_at,
});
describe("one training owner", () => {
  it("folds the programme goal into the member's fitness goal", () => {
    expect(
      planTrainingGoalMerge(
        [g("1", "Training programme", "training"), g("2", "Get fitter", "fitness")],
        true,
      ),
    ).toEqual({ keeperId: "2", mergeIds: ["1"] });
  });
  it("leaves things alone without a programme", () => {
    expect(planTrainingGoalMerge([g("1", "Get fitter", "fitness")], false)).toBeNull();
    expect(planTrainingGoalMerge([g("1", "Training programme", "training")], true)).toEqual({
      keeperId: "1",
      mergeIds: [],
    });
  });
  it("never touches unrelated goals", () => {
    expect(isTrainingGoal(g("1", "Learn Spanish", "learning"))).toBe(false);
    expect(isTrainingGoal(g("1", "Lose 5kg", "nutrition"))).toBe(false);
    expect(isTrainingGoal(g("1", "20 push-ups by Christmas", "other"))).toBe(true);
  });
});
