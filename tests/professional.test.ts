import { describe, it, expect } from "vitest";
import { effectivePermissions, screenProposal } from "../src/lib/professional";
describe("professional connect", () => {
  it("health domains need explicit consent", () => {
    expect(
      effectivePermissions(
        ["VIEW_SELECTED_PLAN", "VIEW_SELECTED_NUTRITION", "VIEW_SELECTED_RECOVERY"],
        ["VIEW_SELECTED_RECOVERY"],
      ),
    ).toEqual(["VIEW_SELECTED_PLAN", "VIEW_SELECTED_RECOVERY"]);
  });
  it("consent without the permission grants nothing", () =>
    expect(effectivePermissions([], ["VIEW_SELECTED_TRAINING"])).toEqual([]));
  it("unsafe suggestions are blocked, normal ones pass", () => {
    expect(screenProposal("Eat 600 kcal a day")).toMatch(/very low calorie/);
    expect(
      screenProposal("No running until your knee settles; keep Tuesday physio slot"),
    ).toBeNull();
  });
});
