import { describe, it, expect } from "vitest";
import {
  parseInventoryText,
  needsQuantity,
  buildPrepPlan,
  shoppingList,
  prepSessions,
  applyEdit,
  dayStatus,
  storageFor,
  type PrepContext,
} from "../src/lib/meal-prep";

const ctx = (o: Partial<PrepContext> = {}): PrepContext => ({
  startDate: "2026-10-19",
  days: 7,
  targets: { kcal: 2200, protein_g: 160, carbs_g: 240, fat_g: 70 },
  targetsSource: "your daily targets",
  slots: ["breakfast", "lunch", "dinner", "snack"],
  allergies: [],
  diet: null,
  dislikes: [],
  onlyExisting: false,
  allowStaples: true,
  prepDay: "2026-10-18",
  secondPrep: true,
  quickBreakfastDates: [],
  busyEveningDates: [],
  trainingDates: [],
  ...o,
});
const voice =
  "I've got six chicken breasts, twelve eggs, a bag of rice, potatoes, peppers, broccoli, oats and Greek yoghurt. Plan my meals Monday to Sunday";

describe("meal prep inventory", () => {
  it("structures spoken lists and flags unknown amounts without inventing them", () => {
    const inv = parseInventoryText(voice, "voice");
    const by = Object.fromEntries(inv.map((i) => [i.food_key, i]));
    expect(by["chicken_breast"]!.grams).toBe(1020);
    expect(by["eggs"]!.count).toBe(12);
    expect(by["rice"]!.quantity_status).toBe("estimated");
    expect(
      needsQuantity(inv)
        .map((i) => i.food_key)
        .sort(),
    ).toEqual(["broccoli", "greek_yoghurt", "oats", "peppers", "potatoes"]);
    const typed = parseInventoryText(
      "Chicken 1.2kg\nRice 1kg\nEggs 12\nPotatoes 2kg\nOats 1 bag\nGreek yoghurt 2 tubs",
    );
    expect(Object.fromEntries(typed.map((i) => [i.food_key, i.grams]))).toMatchObject({
      chicken_breast: 1200,
      rice: 1000,
      potatoes: 2000,
      oats: 1000,
      greek_yoghurt: 1000,
    });
  });
});

describe("meal prep plan", () => {
  const inv = parseInventoryText(voice).map((i) =>
    i.quantity_status === "unknown" ? { ...i, quantity_status: "as_needed" as const } : i,
  );
  const plan = buildPrepPlan(ctx(), inv);
  it("plans 7 full days near the targets, using owned food first", () => {
    expect(plan.days).toHaveLength(7);
    for (const d of plan.days) {
      expect(d.meals).toHaveLength(4);
      expect(Math.abs(d.totals.kcal - 2200)).toBeLessThan(2200 * 0.1);
      for (const m of d.meals) expect(m.kcal).toBeGreaterThan(0);
    }
    const owned = plan.days
      .flatMap((d) => d.meals.flatMap((m) => m.ingredients))
      .filter((i) => i.have).length;
    const all = plan.days.flatMap((d) => d.meals.flatMap((m) => m.ingredients)).length;
    expect(owned / all).toBeGreaterThan(0.6);
  });
  it("shopping list buys only what is short; prep follows food-safety storage", () => {
    const sh = shoppingList(plan, inv);
    expect(sh.buy.find((b) => b.name === "Potatoes")).toBeUndefined(); // "as needed"
    expect(sh.have.map((h) => h.name)).toContain("Chicken breast");
    const s = prepSessions(plan);
    expect(s.length).toBeGreaterThanOrEqual(1);
    expect(s[0]!.creates.join(" ")).toMatch(/×/);
    expect(
      storageFor("2026-10-20", "2026-10-18", [
        { key: "rice", name: "", grams: 1, per100: { kcal: 0, p: 0, c: 0, f: 0 }, have: true },
      ]),
    ).toBe("freezer");
  });
  it("edits only the affected meal and recalculates the day", () => {
    const tue = plan.days[1]!;
    const { plan: p2, changed } = applyEdit(plan, inv, {
      type: "replace",
      date: tue.date,
      slot: "dinner",
      avoid: ["chicken"],
    });
    expect(changed).toEqual(["Tue dinner"]);
    const d = p2.days[1]!.meals.find((m) => m.slot === "dinner")!;
    expect(d.ingredients.some((i) => i.key === "chicken_breast")).toBe(false);
    expect(p2.days[1]!.totals.kcal).toBe(p2.days[1]!.meals.reduce((a, m) => a + m.kcal, 0));
    expect(JSON.stringify(p2.days[3])).toBe(JSON.stringify(plan.days[3]));
  });
  it("respects allergies and only-existing mode", () => {
    const p = buildPrepPlan(ctx({ allergies: ["egg"] }), inv);
    expect(
      p.days.flatMap((d) => d.meals.flatMap((m) => m.ingredients)).some((i) => i.key === "eggs"),
    ).toBe(false);
    const small = parseInventoryText("2 chicken breasts, 500g rice");
    const only = buildPrepPlan(ctx({ onlyExisting: true }), small);
    expect(
      only.days
        .flatMap((d) => d.meals.flatMap((m) => m.ingredients))
        .every((i) => i.have || i.key === "olive_oil"),
    ).toBe(true);
    expect(only.notes.join(" ")).toMatch(/not enough|Add more food/);
  });
  it("planned meals never count as eaten", () => {
    const s = dayStatus(
      [{ kcal: 500, protein_g: 30, carbs_g: 50, fat_g: 10 }],
      { kcal: 2200, protein_g: 160, carbs_g: 240, fat_g: 70 },
      plan.days[0],
    );
    expect(s.consumed.kcal).toBe(500);
    expect(s.remaining!.kcal).toBe(1700);
    expect(s.upcoming.length).toBe(4);
  });
});
