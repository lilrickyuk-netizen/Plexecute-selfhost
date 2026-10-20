import { describe, expect, it } from "vitest";
import { buildMealPlan, type PlanMeal } from "../src/lib/meal-planner";

const ing = (name: string, grams: number, kcal: number, allergens: string[] = []) => ({
  food_id: name,
  name,
  grams,
  kcal_100g: kcal,
  protein_100g: 10,
  carbs_100g: 10,
  fat_100g: 5,
  allergens,
});
const meals: PlanMeal[] = [
  {
    id: "a",
    name: "Oats",
    kind: "meal",
    servings: 1,
    ingredients: [ing("oats", 80, 380, ["gluten"])],
  },
  {
    id: "b",
    name: "Chilli",
    kind: "recipe",
    servings: 4,
    ingredients: [ing("beef", 500, 250), ing("beans", 400, 120)],
  },
  {
    id: "c",
    name: "Mushroom risotto",
    kind: "recipe",
    servings: 2,
    ingredients: [ing("rice", 200, 350), ing("mushroom", 200, 22)],
  },
];

describe("meal planner", () => {
  it("excludes allergens and exclusion words", () => {
    const p = buildMealPlan({
      weekStart: "2026-10-05",
      meals,
      targets: { kcal: 2000, protein_g: 120 },
      allergies: ["gluten"],
      exclusions: ["mushroom"],
      household: 1,
      prepMinutes: 120,
    });
    expect(p.days.flatMap((d) => d.meals.map((m) => m.mealId))).toEqual(
      expect.arrayContaining(["b"]),
    );
    expect(p.days.some((d) => d.meals.some((m) => m.mealId !== "b"))).toBe(false);
  });
  it("is deterministic, scales shopping by household and creates batch prep", () => {
    const inp = {
      weekStart: "2026-10-05",
      meals,
      targets: { kcal: 2200, protein_g: 140 },
      allergies: [],
      exclusions: [],
      household: 2,
      prepMinutes: 120,
    };
    const a = buildMealPlan(inp),
      b = buildMealPlan(inp);
    expect(a).toEqual(b);
    expect(a.prep.length).toBeGreaterThan(0);
    const one = buildMealPlan({ ...inp, household: 1 });
    const beef2 = a.shopping.find((s) => s.name === "beef")!.grams,
      beef1 = one.shopping.find((s) => s.name === "beef")!.grams;
    expect(beef2).toBeGreaterThanOrEqual(beef1 * 2 - 10);
  });
});
