// Deterministic weekly meal planner (completion item 23). Never AI: picks from the user's own saved meals/recipes,
// scales portions to target shares, aggregates a shopping list and batch-prep tasks.
export const MEAL_PLAN_POLICY = "meal-plan-1.0.0";

export type PlanSlot = "breakfast" | "lunch" | "dinner" | "snack";
export const SLOT_SHARE: Record<PlanSlot, number> = {
  breakfast: 0.25,
  lunch: 0.32,
  dinner: 0.33,
  snack: 0.1,
};

export type PlanIngredient = {
  food_id: string;
  name: string;
  grams: number;
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  allergens: string[];
};
export type PlanMeal = {
  id: string;
  name: string;
  kind: "meal" | "recipe";
  servings: number;
  ingredients: PlanIngredient[];
  favourite?: boolean;
  timesLogged14d?: number;
  prepMinutes?: number;
  slots?: PlanSlot[];
};
export type MealPlanInput = {
  weekStart: string; // YYYY-MM-DD (Monday)
  meals: PlanMeal[];
  targets: { kcal: number; protein_g: number; carbs_g?: number; fat_g?: number } | null;
  allergies: string[];
  exclusions: string[];
  household: number;
  prepMinutes: number;
  dietType?: string | undefined;
  slots?: PlanSlot[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function perServing(m: PlanMeal) {
  const t = m.ingredients.reduce(
    (a, i) => ({
      kcal: a.kcal + (i.kcal_100g * i.grams) / 100,
      protein_g: a.protein_g + (i.protein_100g * i.grams) / 100,
      carbs_g: a.carbs_g + (i.carbs_100g * i.grams) / 100,
      fat_g: a.fat_g + (i.fat_100g * i.grams) / 100,
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
  const s = Math.max(1, m.servings);
  return {
    kcal: t.kcal / s,
    protein_g: t.protein_g / s,
    carbs_g: t.carbs_g / s,
    fat_g: t.fat_g / s,
  };
}

/** Excludes a meal if any ingredient carries a user allergen or its name matches an exclusion word. */
const MEAT = [
  "beef",
  "pork",
  "chicken",
  "lamb",
  "turkey",
  "bacon",
  "ham",
  "sausage",
  "mince",
  "duck",
  "veal",
];
const FISH = ["fish", "salmon", "tuna", "cod", "prawn", "shrimp", "mackerel", "sardine", "anchov"];
const ANIMAL = ["milk", "cheese", "yogurt", "yoghurt", "butter", "egg", "cream", "honey", "whey"];
/** Diet preference expressed as name exclusions (the food record has no diet attribute). */
export function dietExclusions(diet: string | undefined) {
  if (diet === "vegetarian") return [...MEAT, ...FISH];
  if (diet === "vegan") return [...MEAT, ...FISH, ...ANIMAL];
  if (diet === "pescatarian") return MEAT;
  return [];
}

export function allowed(m: PlanMeal, allergies: string[], exclusions: string[]) {
  const al = allergies.map((a) => a.toLowerCase());
  const ex = exclusions.map((e) => e.toLowerCase().trim()).filter(Boolean);
  return (
    !m.ingredients.some(
      (i) =>
        i.allergens.some((a) => al.includes(a.toLowerCase())) ||
        ex.some((e) => i.name.toLowerCase().includes(e)),
    ) && !ex.some((e) => m.name.toLowerCase().includes(e))
  );
}

/** Behaviour-adapted score: favourites and meals actually eaten recently rank higher. Ties break by name. */
const score = (m: PlanMeal) => (m.favourite ? 3 : 0) + Math.min(5, m.timesLogged14d ?? 0);

function addDays(key: string, n: number) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function buildMealPlan(inp: MealPlanInput) {
  const slots = inp.slots ?? (["breakfast", "lunch", "dinner", "snack"] as PlanSlot[]);
  const pool = inp.meals
    .filter(
      (m) =>
        m.ingredients.length &&
        perServing(m).kcal > 0 &&
        allowed(m, inp.allergies, [...inp.exclusions, ...dietExclusions(inp.dietType)]),
    )
    .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  const excludedCount = inp.meals.length - pool.length;
  const notes: string[] = [];
  if (!inp.targets) notes.push("No calorie target yet, so portions are one serving each.");
  if (excludedCount)
    notes.push(`${excludedCount} saved meal(s) left out for allergies or exclusions.`);
  const days: {
    date: string;
    meals: {
      slot: PlanSlot;
      mealId: string;
      name: string;
      servings: number;
      kcal: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
    }[];
    totals: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
  }[] = [];
  const used = new Map<string, number>();
  for (let d = 0; d < 7; d++) {
    const date = addDays(inp.weekStart, d);
    const dayMeals: (typeof days)[number]["meals"] = [];
    for (const [si, slot] of slots.entries()) {
      const cands = pool.filter((m) => !m.slots?.length || m.slots.includes(slot));
      if (!cands.length) continue;
      // Rotate deterministically so the same meal is not served twice in a day where avoidable; recipes repeat for batch cooking.
      const pick = cands[(d * slots.length + si) % cands.length]!;
      const ps = perServing(pick);
      const want = inp.targets ? inp.targets.kcal * SLOT_SHARE[slot] : ps.kcal;
      const servings = Math.min(3, Math.max(0.5, Math.round((want / ps.kcal) * 4) / 4));
      used.set(pick.id, (used.get(pick.id) ?? 0) + servings);
      dayMeals.push({
        slot,
        mealId: pick.id,
        name: pick.name,
        servings,
        kcal: Math.round(ps.kcal * servings),
        protein_g: r1(ps.protein_g * servings),
        carbs_g: r1(ps.carbs_g * servings),
        fat_g: r1(ps.fat_g * servings),
      });
    }
    days.push({
      date,
      meals: dayMeals,
      totals: {
        kcal: dayMeals.reduce((a, m) => a + m.kcal, 0),
        protein_g: r1(dayMeals.reduce((a, m) => a + m.protein_g, 0)),
        carbs_g: r1(dayMeals.reduce((a, m) => a + m.carbs_g, 0)),
        fat_g: r1(dayMeals.reduce((a, m) => a + m.fat_g, 0)),
      },
    });
  }
  // Shopping list: grams per food for the whole household.
  const shop = new Map<string, { name: string; grams: number }>();
  for (const [id, servings] of used) {
    const m = pool.find((x) => x.id === id)!;
    for (const i of m.ingredients) {
      const g = (i.grams / Math.max(1, m.servings)) * servings * inp.household;
      const cur = shop.get(i.food_id) ?? { name: i.name, grams: 0 };
      cur.grams += g;
      shop.set(i.food_id, cur);
    }
  }
  const shopping = [...shop.values()]
    .map((s) => ({ name: s.name, grams: Math.ceil(s.grams / 10) * 10 }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // Batch prep: meals used on 2+ days are cooked once; storage note by how far ahead they are eaten.
  const prep = [...used.entries()]
    .filter(([id]) => days.filter((d) => d.meals.some((m) => m.mealId === id)).length >= 2)
    .map(([id, servings]) => {
      const m = pool.find((x) => x.id === id)!;
      const lastDay = Math.max(
        ...days.map((d, i) => (d.meals.some((x) => x.mealId === id) ? i : -1)),
      );
      return {
        mealId: id,
        name: m.name,
        portions: Math.ceil(servings * inp.household),
        minutes: m.prepMinutes ?? 30,
        storage:
          lastDay > 2
            ? "Freeze portions eaten later in the week; check the food's own storage guidance."
            : "Store in sealed portions; check the food's own storage guidance.",
      };
    });
  const prepMinutes = Math.min(inp.prepMinutes, prep.reduce((a, p) => a + p.minutes, 0) + 15);
  if (!pool.length)
    notes.push(
      "Save some meals or recipes first; the plan is built only from food you already eat.",
    );
  const avg = days.length
    ? Math.round(days.reduce((a, d) => a + d.totals.kcal, 0) / days.length)
    : 0;
  const t = inp.targets;
  const vsTarget = t
    ? {
        kcal: avg - t.kcal,
        protein_g: r1(days.reduce((a, d) => a + d.totals.protein_g, 0) / 7 - t.protein_g),
      }
    : null;
  if (vsTarget && vsTarget.protein_g < -10)
    notes.push(
      `About ${Math.abs(Math.round(vsTarget.protein_g))} g a day under your protein target with these meals; save a higher-protein meal to close the gap.`,
    );
  return {
    policy: MEAL_PLAN_POLICY,
    vsTarget,
    days,
    shopping,
    prep,
    prepMinutes: prep.length ? Math.max(30, prepMinutes) : 0,
    avgKcal: avg,
    notes,
  };
}
