import { describe, it, expect } from "vitest";
import { gateTool, deriveContract } from "../src/lib/coach-tools";
describe("coach tool gating", () => {
  it("free gets core reads", () => expect(gateTool("get_plan", "free", 0).allowed).toBe(true));
  it("free blocked from experiments and call settings", () => {
    expect(gateTool("start_experiment_proposal", "free", 0)).toEqual({
      allowed: false,
      reason: "paid_only",
    });
    expect(gateTool("request_call_setting_change", "free", 0).allowed).toBe(false);
  });
  it("free replan limited to one per week", () => {
    expect(gateTool("request_replan", "free", 0).allowed).toBe(true);
    expect(gateTool("request_replan", "free", 1)).toEqual({
      allowed: false,
      reason: "allowance_used",
    });
  });
  it("paid gets everything", () =>
    expect(gateTool("start_experiment_proposal", "pro", 9).allowed).toBe(true));
  it("contract comes from tools actually used", () => {
    expect(deriveContract("COACH", [], [], [], []).source_of_truth).toBe("AI_SYNTHESIS");
    const c = deriveContract(
      "EXPERT",
      ["get_nutrition_context"],
      ["nu-1"],
      [{ kind: "replan", label: "x", reason: "y" }],
      [],
    );
    expect(c.confidence).toBe("HIGH");
    expect(c.requires_user_confirmation).toBe(true);
  });
});
