import { describe, expect, it } from "vitest";
import { normaliseEstimate, mealTotals } from "../src/lib/meal-photo";

describe("meal photo estimate", () => {
  it("totals are ranges computed from portions, never the model's own sums", () => {
    const e = normaliseEstimate({
      status: "ok",
      items: [
        {
          name: "rice",
          grams_low: 150,
          grams_high: 200,
          kcal_100g: 130,
          protein_100g: 2.7,
          carbs_100g: 28,
          fat_100g: 0.3,
          confidence: "medium",
        },
      ],
    });
    const t = mealTotals(e);
    expect(t.kcal.low).toBeLessThan(t.kcal.high);
    expect(Math.round(t.kcal.high)).toBe(260);
  });
  it("unclear photos carry no items", () => {
    const e = normaliseEstimate({
      status: "unclear",
      unclear_reason: "dark",
      items: [{ name: "x" }],
    });
    expect(e.items).toHaveLength(0);
  });
});
