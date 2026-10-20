import { describe, it, expect } from "vitest";
import { buildSchedule, conditionOn, analyse, experimentGate } from "../src/lib/experiments";
import { policyFor } from "../src/lib/safety";
const ok = policyFor([]);
describe("experiment engine", () => {
  it("fixed A/B 2-week schedule, minimum 28 days", () => {
    const s = buildSchedule("2026-10-01", 10);
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({ from: "2026-10-01", to: "2026-10-14", condition: "A" });
    expect(s[1]!.to).toBe("2026-10-28");
    expect(conditionOn(s, "2026-10-15")).toBe("B");
    expect(conditionOn(s, "2026-10-29")).toBeNull();
    expect(
      buildSchedule("2026-10-01", 56)
        .map((x) => x.condition)
        .join(""),
    ).toBe("ABAB");
  });
  it("needs 4 observations per condition and reports uncertainty", () => {
    const s = buildSchedule("2026-10-01", 28);
    const e = (d: string, v: number) => ({ entry_date: d, value: v, condition: null });
    const three = analyse(
      s,
      [
        e("2026-10-01", 1),
        e("2026-10-02", 2),
        e("2026-10-03", 3),
        e("2026-10-15", 5),
        e("2026-10-16", 6),
        e("2026-10-17", 7),
        e("2026-10-18", 6),
      ],
      4,
      null,
      "2026-10-29",
    );
    expect(three.enough).toBe(false);
    const four = analyse(
      s,
      [
        e("2026-10-01", 1),
        e("2026-10-02", 2),
        e("2026-10-03", 3),
        e("2026-10-04", 2),
        e("2026-10-15", 5),
        e("2026-10-16", 6),
        e("2026-10-17", 7),
        e("2026-10-18", 6),
      ],
      4,
      "holiday",
      "2026-10-29",
    );
    expect(four.enough).toBe(true);
    expect(four.difference).toBe(4);
    expect(four.range).not.toBeNull();
    expect(four.confidence).toBe("low");
    expect(four.limitations.join(" ")).toMatch(/holiday/);
  });
  it("prohibits unsafe experiments", () => {
    expect(experimentGate(["Study at 7am vs 7pm"], ok).ok).toBe(true);
    expect(experimentGate(["Water fast for 3 days"], ok).ok).toBe(false);
    expect(experimentGate(["Sleep 4 hours a night"], ok).ok).toBe(false);
    expect(experimentGate(["Eat 600 kcal a day"], ok).ok).toBe(false);
    expect(experimentGate(["Change my medication dose"], ok).ok).toBe(false);
    expect(experimentGate(["Eat less at dinner"], policyFor(["eating_disorder_risk"])).ok).toBe(
      false,
    );
  });
});
