import { describe, it, expect } from "vitest";
import {
  detectSignals,
  policyFor,
  stateFor,
  outputViolations,
  crisisResources,
  safetyMessage,
  CRISIS_MANIFEST,
} from "../src/lib/safety";
describe("central safety engine", () => {
  it("crisis language -> CRISIS_SUPPORT, pauses accountability", () => {
    const s = detectSignals("I want to end my life");
    expect(stateFor(s)).toBe("CRISIS_SUPPORT");
    const p = policyFor(s);
    expect(p.pauseAccountability && p.stopOrdinaryCoaching && p.blockUpsell).toBe(true);
  });
  it("chest pain -> EMERGENCY_GUIDANCE and stops training", () => {
    const p = policyFor(detectSignals("got chest pain on the run"));
    expect(p.state).toBe("EMERGENCY_GUIDANCE");
    expect(p.stopTraining).toBe(true);
  });
  it("pregnancy blocks deficit and progressive training only", () => {
    const p = policyFor(["pregnancy_postpartum"]);
    expect(p.state).toBe("BLOCK_SPECIALIST_AUTOMATION");
    expect(p.blockCalorieDeficit && p.blockProgressiveTraining).toBe(true);
    expect(p.pauseAccountability).toBe(false);
  });
  it("eating-disorder signal suppresses food/weight calls", () => {
    const p = policyFor(detectSignals("I make myself sick after eating"));
    expect(p.suppressFoodWeightCalls && p.blockCalorieDeficit).toBe(true);
  });
  it("pain is CAUTION", () =>
    expect(stateFor(detectSignals("sharp pain in my knee"))).toBe("CAUTION"));
  it("normal text is NORMAL", () =>
    expect(policyFor(detectSignals("Ran 5k, felt good")).state).toBe("NORMAL"));
  it("blocks diagnosis, medication and very-low-energy output", () => {
    expect(outputViolations("You probably have insomnia")).toContain("diagnosis");
    expect(outputViolations("Take ibuprofen before training")).toContain("medication");
    expect(outputViolations("Eat 600 kcal a day")).toContain("very_low_energy");
    expect(outputViolations("Eat 2,100 kcal and walk 30 min")).toEqual([]);
  });
  it("crisis manifest rows carry source and verification date; unknown country gets generic guidance", () => {
    for (const r of Object.values(CRISIS_MANIFEST)) {
      expect(r.source).toMatch(/^https:/);
      expect(r.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(crisisResources("Europe/London")?.emergency).toBe("999");
    expect(safetyMessage(policyFor(["self_harm_crisis"]), "America/Chicago")).toMatch(/988/);
    expect(safetyMessage(policyFor(["self_harm_crisis"]), "Europe/Paris")).toMatch(
      /local emergency services/,
    );
  });
});
