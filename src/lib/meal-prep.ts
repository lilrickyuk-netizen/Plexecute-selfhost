// Inventory-based weekly meal prep (pure, deterministic). AI may only turn words/photos into
// inventory items; every plan, portion, total, shopping list and prep session is computed here.
// Nutrition values are generic per-100 g reference values (labelled estimates), or the member's
// confirmed food-database values when an inventory item carries them.
export const MEAL_PREP_POLICY = "meal-prep-1.0.0";

export type Role = "protein" | "carb" | "veg" | "fruit" | "dairy" | "fat" | "snack";
export type Per100 = { kcal: number; p: number; c: number; f: number };
export type CatalogueFood = {
  key: string;
  name: string;
  match: RegExp;
  role: Role;
  per100: Per100;
  unit: { label: string; grams: number }; // one countable piece
  pack?: { label: RegExp; grams: number }; // a typical bag/tub/tin
  allergens: string[];
  diet: "meat" | "fish" | "animal" | "plant";
  short?: string;
  min?: number;
  max?: number;
};

const F = (
  key: string,
  name: string,
  match: string,
  role: Role,
  per100: [number, number, number, number],
  unit: [string, number],
  extra: Partial<CatalogueFood> = {},
): CatalogueFood => ({
  key,
  name,
  match: new RegExp(`\\b(${match})\\b`, "i"),
  role,
  per100: { kcal: per100[0], p: per100[1], c: per100[2], f: per100[3] },
  unit: { label: unit[0], grams: unit[1] },
  allergens: [],
  diet: "plant",
  ...extra,
});

/** Generic reference values per 100 g as bought (raw / dry), from UK CoFID and USDA FoodData Central typical values. */
export const FOODS: CatalogueFood[] = [
  F(
    "chicken_breast",
    "Chicken breast",
    "chicken( breasts?| fillets?)?",
    "protein",
    [106, 24, 0, 1.1],
    ["breast", 170],
    { diet: "meat", short: "Chicken", min: 100, max: 260 },
  ),
  F(
    "chicken_thigh",
    "Chicken thighs",
    "chicken thighs?",
    "protein",
    [120, 19.6, 0, 4.7],
    ["thigh", 90],
    { diet: "meat", short: "Chicken thigh", min: 100, max: 260 },
  ),
  F(
    "turkey_mince",
    "Turkey mince",
    "turkey( mince)?",
    "protein",
    [120, 22, 0, 3.5],
    ["pack", 500],
    {
      diet: "meat",
      short: "Turkey",
      min: 100,
      max: 240,
      pack: { label: /pack|packet/i, grams: 500 },
    },
  ),
  F(
    "beef_mince",
    "Lean beef mince",
    "(lean )?(beef )?mince|minced beef",
    "protein",
    [137, 21.4, 0, 5.7],
    ["pack", 500],
    {
      diet: "meat",
      short: "Beef mince",
      min: 100,
      max: 220,
      pack: { label: /pack|packet/i, grams: 500 },
    },
  ),
  F("salmon", "Salmon fillet", "salmon( fillets?)?", "protein", [208, 20, 0, 13], ["fillet", 120], {
    diet: "fish",
    allergens: ["fish"],
    short: "Salmon",
    min: 100,
    max: 200,
  }),
  F(
    "cod",
    "White fish (cod)",
    "cod|white fish|haddock",
    "protein",
    [80, 18, 0, 0.7],
    ["fillet", 120],
    { diet: "fish", allergens: ["fish"], short: "Cod", min: 120, max: 260 },
  ),
  F("tuna", "Tinned tuna (drained)", "tuna", "protein", [109, 25, 0, 1], ["tin", 112], {
    diet: "fish",
    allergens: ["fish"],
    short: "Tuna",
    min: 80,
    max: 200,
    pack: { label: /tins?|cans?/i, grams: 112 },
  }),
  F("prawns", "Prawns", "prawns?|shrimps?", "protein", [70, 16, 0, 0.6], ["pack", 300], {
    diet: "fish",
    allergens: ["crustaceans"],
    short: "Prawn",
    min: 100,
    max: 250,
  }),
  F("eggs", "Eggs", "eggs?", "protein", [143, 12.6, 0.7, 9.5], ["egg", 50], {
    diet: "animal",
    allergens: ["egg"],
    short: "Egg",
    min: 100,
    max: 200,
  }),
  F("tofu", "Firm tofu", "tofu", "protein", [144, 15.6, 2.3, 8.7], ["block", 280], {
    allergens: ["soy"],
    short: "Tofu",
    min: 120,
    max: 280,
    pack: { label: /blocks?|packs?/i, grams: 280 },
  }),
  F(
    "chickpeas",
    "Chickpeas (tinned, drained)",
    "chick ?peas",
    "protein",
    [139, 7.2, 20, 2.6],
    ["tin", 240],
    { short: "Chickpea", min: 120, max: 240, pack: { label: /tins?|cans?/i, grams: 240 } },
  ),
  F(
    "beans",
    "Beans (tinned, drained)",
    "(black|kidney|pinto|mixed|butter|cannellini) beans|beans",
    "protein",
    [132, 8.9, 23.7, 0.5],
    ["tin", 240],
    { short: "Bean", min: 120, max: 240, pack: { label: /tins?|cans?/i, grams: 240 } },
  ),
  F("lentils", "Red lentils (dry)", "lentils?", "protein", [330, 24, 56, 1.3], ["bag", 500], {
    short: "Lentil",
    min: 50,
    max: 110,
    pack: { label: /bags?|packs?/i, grams: 500 },
  }),
  F(
    "greek_yoghurt",
    "Greek yoghurt (2%)",
    "greek (yoghurt|yogurt)|(yoghurt|yogurt)",
    "dairy",
    [73, 9.9, 3.9, 1.9],
    ["pot", 150],
    {
      diet: "animal",
      allergens: ["milk"],
      min: 100,
      max: 300,
      pack: { label: /tubs?|pots?/i, grams: 500 },
    },
  ),
  F(
    "cottage_cheese",
    "Cottage cheese",
    "cottage cheese",
    "dairy",
    [98, 11, 3.4, 4.3],
    ["tub", 300],
    {
      diet: "animal",
      allergens: ["milk"],
      min: 100,
      max: 250,
      pack: { label: /tubs?|pots?/i, grams: 300 },
    },
  ),
  F("milk", "Semi-skimmed milk", "milk", "dairy", [46, 3.4, 4.7, 1.7], ["litre", 1000], {
    diet: "animal",
    allergens: ["milk"],
    min: 150,
    max: 300,
    pack: { label: /pints?/i, grams: 568 },
  }),
  F("cheese", "Cheddar cheese", "cheddar|cheese", "fat", [416, 25, 0.1, 34.9], ["block", 200], {
    diet: "animal",
    allergens: ["milk"],
    min: 15,
    max: 40,
    pack: { label: /blocks?|packs?/i, grams: 200 },
  }),
  F(
    "rice",
    "White rice (dry)",
    "(white |basmati |jasmine |brown )?rice",
    "carb",
    [360, 7, 79, 0.6],
    ["bag", 1000],
    { short: "rice", min: 40, max: 130, pack: { label: /bags?|packs?|packets?/i, grams: 1000 } },
  ),
  F(
    "pasta",
    "Pasta (dry)",
    "pasta|spaghetti|penne|fusilli|noodles",
    "carb",
    [359, 12.5, 71, 1.5],
    ["bag", 500],
    {
      allergens: ["gluten"],
      short: "pasta",
      min: 50,
      max: 140,
      pack: { label: /bags?|packs?|packets?/i, grams: 500 },
    },
  ),
  F("potatoes", "Potatoes", "potato(es)?|spuds?", "carb", [77, 2, 17.5, 0.1], ["potato", 170], {
    short: "potatoes",
    min: 150,
    max: 450,
    pack: { label: /bags?/i, grams: 2000 },
  }),
  F(
    "sweet_potato",
    "Sweet potatoes",
    "sweet potato(es)?",
    "carb",
    [86, 1.6, 20, 0.1],
    ["potato", 200],
    { short: "sweet potato", min: 150, max: 400 },
  ),
  F("oats", "Porridge oats", "oats|porridge( oats)?", "carb", [375, 11, 60, 8], ["bag", 1000], {
    allergens: ["gluten"],
    min: 30,
    max: 100,
    pack: { label: /bags?|packs?|boxes?/i, grams: 1000 },
  }),
  F("bread", "Wholemeal bread", "bread|toast|loaf", "carb", [217, 9.4, 42, 2.5], ["slice", 40], {
    allergens: ["gluten"],
    short: "toast",
    min: 40,
    max: 120,
    pack: { label: /loa(f|ves)/i, grams: 800 },
  }),
  F("wraps", "Tortilla wraps", "wraps?|tortillas?", "carb", [306, 8.5, 51, 7.5], ["wrap", 60], {
    allergens: ["gluten"],
    short: "wraps",
    min: 60,
    max: 180,
    pack: { label: /packs?/i, grams: 480 },
  }),
  F("quinoa", "Quinoa (dry)", "quinoa", "carb", [368, 14, 64, 6], ["bag", 500], {
    short: "quinoa",
    min: 40,
    max: 120,
  }),
  F("couscous", "Couscous (dry)", "cous ?cous", "carb", [376, 12.8, 77, 0.6], ["bag", 500], {
    allergens: ["gluten"],
    short: "couscous",
    min: 40,
    max: 120,
  }),
  F(
    "peppers",
    "Peppers",
    "(bell |red |green |yellow )?peppers?",
    "veg",
    [26, 1, 6, 0.3],
    ["pepper", 160],
  ),
  F("broccoli", "Broccoli", "broccoli", "veg", [34, 2.8, 7, 0.4], ["head", 300]),
  F("spinach", "Spinach", "spinach", "veg", [23, 2.9, 3.6, 0.4], ["bag", 200]),
  F("onions", "Onions", "onions?", "veg", [40, 1.1, 9.3, 0.1], ["onion", 150]),
  F("carrots", "Carrots", "carrots?", "veg", [41, 0.9, 9.6, 0.2], ["carrot", 70]),
  F("tomatoes", "Tomatoes", "(cherry )?tomato(es)?", "veg", [18, 0.9, 3.9, 0.2], ["tomato", 100]),
  F(
    "tinned_tomatoes",
    "Tinned tomatoes",
    "(tinned|chopped|canned) tomato(es)?",
    "veg",
    [22, 1.1, 3.8, 0.2],
    ["tin", 400],
    { pack: { label: /tins?|cans?/i, grams: 400 } },
  ),
  F(
    "frozen_veg",
    "Frozen mixed vegetables",
    "(frozen |mixed )+(veg|vegetables)|frozen veg(etables)?|mixed veg(etables)?|stir[- ]fry veg(etables)?",
    "veg",
    [64, 3.3, 13, 0.5],
    ["bag", 1000],
    { pack: { label: /bags?/i, grams: 1000 } },
  ),
  F(
    "green_beans",
    "Green beans",
    "green beans|fine beans",
    "veg",
    [31, 1.8, 7, 0.2],
    ["pack", 200],
  ),
  F("mushrooms", "Mushrooms", "mushrooms?", "veg", [22, 3.1, 3.3, 0.3], ["pack", 250]),
  F(
    "courgette",
    "Courgettes",
    "courgettes?|zucchini",
    "veg",
    [17, 1.2, 3.1, 0.3],
    ["courgette", 200],
  ),
  F(
    "salad",
    "Salad leaves",
    "salad( leaves)?|lettuce|rocket",
    "veg",
    [15, 1.4, 2.9, 0.2],
    ["bag", 150],
  ),
  F("banana", "Bananas", "bananas?", "fruit", [89, 1.1, 23, 0.3], ["banana", 100]),
  F("apple", "Apples", "apples?", "fruit", [52, 0.3, 14, 0.2], ["apple", 150]),
  F(
    "berries",
    "Berries",
    "(frozen |mixed )?(berries|blueberries|raspberries|strawberries)",
    "fruit",
    [50, 1, 12, 0.3],
    ["bag", 500],
    { pack: { label: /bags?|punnets?/i, grams: 500 } },
  ),
  F(
    "olive_oil",
    "Olive oil",
    "(olive |vegetable |cooking )?oil",
    "fat",
    [884, 0, 0, 100],
    ["bottle", 500],
  ),
  F("butter", "Butter", "butter", "fat", [717, 0.9, 0.1, 81], ["block", 250], {
    diet: "animal",
    allergens: ["milk"],
  }),
  F("peanut_butter", "Peanut butter", "peanut butter", "snack", [588, 25, 20, 50], ["jar", 340], {
    allergens: ["peanuts"],
  }),
  F(
    "nuts",
    "Mixed nuts",
    "nuts|almonds|cashews|walnuts",
    "snack",
    [600, 20, 20, 52],
    ["bag", 200],
    { allergens: ["tree nuts"] },
  ),
  F("hummus", "Hummus", "hou?mm?[ou]s", "snack", [166, 7.9, 14, 9.6], ["tub", 200], {
    allergens: ["sesame"],
  }),
  F("avocado", "Avocados", "avocados?", "fat", [160, 2, 8.5, 14.7], ["avocado", 140]),
];
export const FOOD = Object.fromEntries(FOODS.map((f) => [f.key, f])) as Record<
  string,
  CatalogueFood
>;

/** Specific names first ("sweet potato" before "potato", "peanut butter" before "butter"). */
const ORDER = [...FOODS].sort((a, b) => b.match.source.length - a.match.source.length);
const PRIORITY = [
  "sweet_potato",
  "peanut_butter",
  "cottage_cheese",
  "greek_yoghurt",
  "chicken_thigh",
  "tinned_tomatoes",
  "frozen_veg",
  "green_beans",
  "turkey_mince",
  "beef_mince",
  "chickpeas",
];
export function matchFood(name: string): CatalogueFood | null {
  const n = name.toLowerCase();
  for (const k of PRIORITY) if (FOOD[k]!.match.test(n)) return FOOD[k]!;
  return ORDER.find((f) => f.match.test(n)) ?? null;
}

// ---------- Inventory ----------
export type QuantityStatus = "confirmed" | "estimated" | "unknown" | "as_needed";
export type InventoryItem = {
  id?: string;
  name: string;
  food_key: string | null;
  grams: number | null;
  count: number | null;
  unit: string;
  quantity_status: QuantityStatus;
  source: "photo" | "voice" | "text" | "manual" | "coach";
  per100?: Per100 | null;
  nutrition_source?: string;
  expires_on?: string | null;
  allergens?: string[];
};

const NUM: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  couple: 2,
  dozen: 12,
  half: 0.5,
};
const VAGUE = /\b(some|bit of|a few|few|loads of|lots of|plenty of|left ?over|bits of|leftover)\b/i;

/** Turns typed or spoken lists into inventory items. Never invents quantities: vague amounts stay "unknown". */
export function parseInventoryText(
  text: string,
  source: InventoryItem["source"] = "text",
): InventoryItem[] {
  const parts = text
    .replace(
      /\b(i'?ve got|i have got|i have|we have|we've got|there'?s|plus|also|and then)\b/gi,
      ",",
    )
    .replace(/\b(plan my meals|plan my week|plan meals).*$/i, "")
    .split(/[,;\n•]+|\band\b|\s\+\s/i)
    .map((s) => s.trim().replace(/^[-*]\s*/, ""))
    .filter((s) => s.length > 1);
  const out = new Map<string, InventoryItem>();
  for (const raw of parts) {
    const food = matchFood(raw);
    const name =
      food?.name ??
      raw
        .replace(/^(a|an|some|the)\s+/i, "")
        .replace(/\d[\d.,]*\s*(kg|g|grams?|kilos?|ml|l|litres?)\b/gi, "")
        .trim();
    if (!name || name.length > 60) continue;
    if (!food && !/[a-z]{3}/i.test(name)) continue;
    let grams: number | null = null;
    let count: number | null = null;
    let status: QuantityStatus = "unknown";
    let unit = food?.unit.label ?? "item";
    const t = raw.toLowerCase();
    const mass = t.match(
      /(\d+(?:[.,]\d+)?)\s*(kg|kilos?|kilograms?|g\b|grams?|ml|l\b|litres?|liters?)/,
    );
    const kiloWord = t.match(/\b(a|one|half a|two|three) (kilo|kg|litre|liter)\b/);
    const lead0 = t.match(/^(\d+(?:[.,]\d+)?|a dozen|half a dozen|[a-z]+)\s+/);
    const lead =
      lead0 && (/^\d/.test(lead0[1]!) || lead0[1]! in NUM || /dozen/.test(lead0[1]!))
        ? lead0
        : t.match(/\s(\d+(?:[.,]\d+)?)(?=\s|$)/);
    const packed = food?.pack && food.pack.label.test(t);
    if (mass) {
      const v = Number(mass[1]!.replace(",", "."));
      grams = /kg|kilo/.test(mass[2]!) ? v * 1000 : /^l|litre|liter/.test(mass[2]!) ? v * 1000 : v;
      status = "confirmed";
      unit = "g";
    } else if (kiloWord) {
      const m = { a: 1, one: 1, "half a": 0.5, two: 2, three: 3 }[kiloWord[1]!] ?? 1;
      grams = m * 1000;
      status = "confirmed";
      unit = "g";
    } else if (VAGUE.test(t)) {
      status = "unknown";
    } else if (lead) {
      const w = lead[1]!;
      const n = /^\d/.test(w)
        ? Number(w.replace(",", "."))
        : w === "a dozen"
          ? 12
          : w === "half a dozen"
            ? 6
            : NUM[w];
      if (n && food) {
        count = n;
        const per = packed ? food.pack!.grams : food.unit.grams;
        unit = packed ? (t.match(food.pack!.label)?.[0] ?? food.unit.label) : food.unit.label;
        grams = Math.round(n * per);
        // A counted piece (eggs, breasts) is a fair estimate; a pack size is only typical.
        status = "estimated";
      }
    }
    const it: InventoryItem = {
      name,
      food_key: food?.key ?? null,
      grams,
      count,
      unit,
      quantity_status: status,
      source,
      allergens: food?.allergens ?? [],
    };
    const k = it.food_key ?? name.toLowerCase();
    const prev = out.get(k);
    if (prev && prev.grams != null && it.grams != null) prev.grams += it.grams;
    else if (!prev) out.set(k, it);
  }
  return [...out.values()];
}

/** Items the planner cannot use reliably until the member gives an amount or says "use as needed". */
export function needsQuantity(items: InventoryItem[]) {
  return items.filter(
    (i) => i.quantity_status === "unknown" && (FOOD[i.food_key ?? ""]?.role ?? "protein") !== "fat",
  );
}

// ---------- Plan ----------
export type Slot = "breakfast" | "lunch" | "dinner" | "snack";
export const SHARE: Record<Slot, number> = {
  breakfast: 0.25,
  lunch: 0.32,
  dinner: 0.33,
  snack: 0.1,
};
export type Ingredient = {
  key: string;
  name: string;
  grams: number;
  count?: number;
  per100: Per100;
  have: boolean;
};
export type MealState = "planned" | "prepared" | "eaten" | "skipped" | "swapped";
export type Meal = {
  slot: Slot;
  name: string;
  ingredients: Ingredient[];
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  minutes: number;
  batch: "A" | "B" | null;
  steps: string;
  state: MealState;
  tags: string[];
  actual?: { kcal: number; protein_g: number; carbs_g: number; fat_g: number } | null;
};
export type Day = { date: string; label: string; notes: string[]; meals: Meal[]; totals: Totals };
export type Totals = { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
export type PrepContext = {
  startDate: string;
  days: number;
  targets: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
  targetsSource: "your daily targets" | "plan targets you asked for" | "default";
  slots: Slot[];
  allergies: string[];
  diet?: string | null | undefined;
  dislikes: string[];
  onlyExisting: boolean;
  allowStaples: boolean;
  prepDay: string; // YYYY-MM-DD of the main prep session
  secondPrep: boolean;
  quickBreakfastDates: string[];
  busyEveningDates: string[];
  trainingDates: string[];
};
export type PrepPlan = {
  policy: string;
  kind: "inventory";
  context: PrepContext;
  days: Day[];
  notes: string[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const dayLabel = (date: string) => DOW[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
export function addDays(key: string, n: number) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function mealTotals(ings: Ingredient[]): Totals {
  const t = ings.reduce(
    (a, i) => ({
      kcal: a.kcal + (i.per100.kcal * i.grams) / 100,
      protein_g: a.protein_g + (i.per100.p * i.grams) / 100,
      carbs_g: a.carbs_g + (i.per100.c * i.grams) / 100,
      fat_g: a.fat_g + (i.per100.f * i.grams) / 100,
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
  return {
    kcal: Math.round(t.kcal),
    protein_g: r1(t.protein_g),
    carbs_g: r1(t.carbs_g),
    fat_g: r1(t.fat_g),
  };
}
export function dayTotals(meals: Meal[]): Totals {
  return meals.reduce(
    (a, m) => ({
      kcal: a.kcal + m.kcal,
      protein_g: r1(a.protein_g + m.protein_g),
      carbs_g: r1(a.carbs_g + m.carbs_g),
      fat_g: r1(a.fat_g + m.fat_g),
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
}

const ANIMAL_DIET: Record<string, CatalogueFood["diet"][]> = {
  vegetarian: ["meat", "fish"],
  vegan: ["meat", "fish", "animal"],
  pescatarian: ["meat"],
};
export function usable(
  f: CatalogueFood,
  ctx: Pick<PrepContext, "allergies" | "diet" | "dislikes">,
  avoid: string[] = [],
) {
  const al = ctx.allergies.map((a) => a.toLowerCase());
  if (f.allergens.some((a) => al.includes(a) || al.some((x) => a.includes(x) || x.includes(a))))
    return false;
  if ((ANIMAL_DIET[ctx.diet ?? ""] ?? []).includes(f.diet)) return false;
  const words = [...ctx.dislikes, ...avoid].map((w) => w.toLowerCase().trim()).filter(Boolean);
  return !words.some((w) => f.key === w || f.match.test(w) || f.name.toLowerCase().includes(w));
}

type Stock = Map<string, { left: number; expires: string | null; per100: Per100; name: string }>;
export function stockOf(inv: InventoryItem[]): Stock {
  const s: Stock = new Map();
  for (const i of inv) {
    if (!i.food_key || !FOOD[i.food_key]) continue;
    const left = i.quantity_status === "as_needed" ? Infinity : (i.grams ?? 0);
    const cur = s.get(i.food_key);
    s.set(i.food_key, {
      left: (cur?.left ?? 0) + left,
      expires: [cur?.expires, i.expires_on].filter(Boolean).sort()[0] ?? null,
      per100: i.per100 ?? FOOD[i.food_key]!.per100,
      name: FOOD[i.food_key]!.name,
    });
  }
  return s;
}

function ing(key: string, grams: number, stock: Stock): Ingredient {
  const f = FOOD[key]!;
  const st = stock.get(key);
  const g =
    key === "eggs"
      ? Math.max(1, Math.round(grams / 50)) * 50
      : Math.max(5, Math.round(grams / 5) * 5);
  return {
    key,
    name: f.name,
    grams: g,
    ...(key === "eggs" ? { count: g / 50 } : {}),
    per100: st?.per100 ?? f.per100,
    have: !!st,
  };
}

/** Picks a food by role: in stock first (soonest expiry, most left), then any usable catalogue food if shopping is allowed. */
function pick(
  role: Role[],
  ctx: PrepContext,
  stock: Stock,
  opts: {
    avoid?: string[] | undefined;
    prefer?: string[] | undefined;
    exclude?: string[];
    need?: number;
    rotate?: number;
  } = {},
) {
  const ok = (f: CatalogueFood) =>
    role.includes(f.role) && usable(f, ctx, opts.avoid) && !(opts.exclude ?? []).includes(f.key);
  const prefer = (opts.prefer ?? []).map((p) => matchFood(p)?.key).filter(Boolean) as string[];
  const pref = prefer.map((k) => FOOD[k]!).filter(ok);
  if (pref.length) return pref[0]!;
  const inStock = FOODS.filter(
    (f) => ok(f) && (stock.get(f.key)?.left ?? 0) >= (opts.need ?? f.min ?? 1),
  ).sort((a, b) => {
    const ea = stock.get(a.key)!.expires ?? "9999",
      eb = stock.get(b.key)!.expires ?? "9999";
    return ea.localeCompare(eb) || stock.get(b.key)!.left - stock.get(a.key)!.left;
  });
  if (inStock.length) return inStock[(opts.rotate ?? 0) % inStock.length]!;
  if (ctx.onlyExisting) return null;
  const DEFAULTS: Record<Role, string[]> = {
    protein: ["chicken_breast", "eggs", "tofu", "chickpeas", "salmon"],
    carb: ["rice", "potatoes", "pasta", "oats"],
    veg: ["frozen_veg", "broccoli", "peppers"],
    fruit: ["banana", "berries"],
    dairy: ["greek_yoghurt", "milk"],
    fat: ["olive_oil"],
    snack: ["nuts"],
  };
  const any = role
    .flatMap((r) => DEFAULTS[r])
    .map((k) => FOOD[k]!)
    .filter(ok);
  return any.length ? any[(opts.rotate ?? 0) % any.length]! : null;
}

function take(stock: Stock, ings: Ingredient[]) {
  for (const i of ings) {
    const s = stock.get(i.key);
    if (s && s.left !== Infinity) s.left = Math.max(0, s.left - i.grams);
  }
}

/** Solves portions so protein then calories land on the slot target, within each food's sensible range. */
function portion(
  protein: CatalogueFood | null,
  carb: CatalogueFood | null,
  fixed: { key: string; grams: number }[],
  kcal: number,
  prot: number,
  stock: Stock,
) {
  const fixedIngs = fixed.map((x) => ing(x.key, x.grams, stock));
  const ft = mealTotals(fixedIngs);
  const out = [...fixedIngs];
  let pk = 0;
  if (protein) {
    const pp = stock.get(protein.key)?.per100 ?? protein.per100;
    const g = Math.min(
      protein.max ?? 250,
      Math.max(protein.min ?? 80, ((prot - ft.protein_g) * 100) / Math.max(1, pp.p)),
    );
    const i = ing(protein.key, g, stock);
    out.push(i);
    pk = mealTotals([i]).kcal;
  }
  if (carb) {
    const cp = stock.get(carb.key)?.per100 ?? carb.per100;
    const g = Math.min(
      carb.max ?? 150,
      Math.max(carb.min ?? 30, ((kcal - ft.kcal - pk) * 100) / Math.max(1, cp.kcal)),
    );
    out.push(ing(carb.key, g, stock));
  }
  return out;
}

const STEPS: Record<string, string> = {
  overnight_oats:
    "Night before: stir oats into yoghurt (add a splash of milk or water), top with fruit, chill covered.",
  porridge: "Simmer oats in milk for 4–5 minutes, stirring; top with fruit.",
  eggs_toast: "Scramble eggs in a non-stick pan over a low heat; serve on toast.",
  omelette: "Soften the veg, pour over beaten eggs, cook until set.",
  yoghurt_bowl: "Spoon yoghurt into a bowl, top with oats and fruit.",
  bowl: "Cook the protein through (no pink in poultry), cook the carb, add steamed or roasted veg.",
  hash: "Par-boil diced potatoes, fry with peppers until golden, add eggs and cook until set.",
};

function breakfast(
  d: number,
  ctx: PrepContext,
  stock: Stock,
  avoid: string[],
  quick: boolean,
  prefer: string[] = [],
): Meal | null {
  return (
    breakfastPass(d, ctx, stock, avoid, quick, prefer, false) ??
    (ctx.onlyExisting ? null : breakfastPass(d, ctx, stock, avoid, quick, prefer, true))
  );
}

function breakfastPass(
  d: number,
  ctx: PrepContext,
  stock: Stock,
  avoid: string[],
  quick: boolean,
  prefer: string[],
  shop: boolean,
): Meal | null {
  const kcal = ctx.targets.kcal * SHARE.breakfast,
    prot = ctx.targets.protein_g * SHARE.breakfast;
  const has = (k: string) =>
    usable(FOOD[k]!, ctx, avoid) && ((stock.get(k)?.left ?? 0) > 0 || shop);
  const fr = pick(["fruit"], ctx, stock, { avoid, rotate: d });
  const fruit = fr && has(fr.key) ? fr : null;
  const options: (() => Meal | null)[] = [];
  const wantsEggs = prefer.some((p) => /egg/i.test(p));
  if (has("oats") && has("greek_yoghurt"))
    options.push(() =>
      mk(
        "breakfast",
        `Overnight oats with Greek yoghurt${fruit ? ` and ${FOOD[fruit.key]!.name.toLowerCase()}` : ""}`,
        portion(
          FOOD["greek_yoghurt"]!,
          FOOD["oats"]!,
          fruit ? [{ key: fruit.key, grams: 80 }] : [],
          kcal,
          prot,
          stock,
        ),
        5,
        STEPS["overnight_oats"]!,
        ["make-ahead", "quick"],
      ),
    );
  if (has("eggs") && has("bread") && !quick)
    options.push(() =>
      mk(
        "breakfast",
        "Scrambled eggs on toast",
        portion(FOOD["eggs"]!, FOOD["bread"]!, [], kcal, prot, stock),
        10,
        STEPS["eggs_toast"]!,
        [],
      ),
    );
  if (has("eggs") && !quick) {
    const v = pick(["veg"], ctx, stock, {
      avoid,
      rotate: d,
      exclude: ["frozen_veg", "tinned_tomatoes"],
    });
    const carb = has("bread") ? FOOD["bread"]! : has("potatoes") ? FOOD["potatoes"]! : null;
    options.push(() =>
      mk(
        "breakfast",
        `${v ? FOOD[v.key]!.name.replace(/s$/, "") + " omelette" : "Omelette"}${carb ? ` with ${carb.short}` : ""}`,
        portion(FOOD["eggs"]!, carb, v ? [{ key: v.key, grams: 80 }] : [], kcal, prot, stock),
        12,
        STEPS["omelette"]!,
        [],
      ),
    );
  }
  if (has("oats") && has("milk"))
    options.push(() =>
      mk(
        "breakfast",
        `Porridge${fruit ? ` with ${FOOD[fruit.key]!.name.toLowerCase()}` : ""}`,
        portion(
          null,
          FOOD["oats"]!,
          [{ key: "milk", grams: 250 }, ...(fruit ? [{ key: fruit.key, grams: 80 }] : [])],
          kcal,
          prot,
          stock,
        ),
        8,
        STEPS["porridge"]!,
        ["quick"],
      ),
    );
  if (has("greek_yoghurt"))
    options.push(() =>
      mk(
        "breakfast",
        `Greek yoghurt bowl${has("oats") ? " with oats" : ""}${fruit ? ` and ${FOOD[fruit.key]!.name.toLowerCase()}` : ""}`,
        portion(
          FOOD["greek_yoghurt"]!,
          has("oats") ? FOOD["oats"]! : null,
          fruit ? [{ key: fruit.key, grams: 100 }] : [],
          kcal,
          prot,
          stock,
        ),
        3,
        STEPS["yoghurt_bowl"]!,
        ["quick"],
      ),
    );
  if (!options.length) return null;
  const built = options.map((o) => o()).filter((m): m is Meal => !!m);
  const pool = built.filter(
    (m) => !avoid.some((a) => m.ingredients.some((i) => i.key === a || FOOD[i.key]!.match.test(a))),
  );
  const list = pool.length ? pool : built;
  if (wantsEggs) return list.find((m) => m.ingredients.some((i) => i.key === "eggs")) ?? null;
  return list[d % list.length] ?? null;
}

function main(
  slot: "lunch" | "dinner",
  d: number,
  ctx: PrepContext,
  stock: Stock,
  opts: {
    avoid?: string[] | undefined;
    prefer?: string[] | undefined;
    protein?: CatalogueFood | null;
    carb?: CatalogueFood | null;
    veg?: CatalogueFood | null;
    quick?: boolean | undefined;
    boost?: number;
    rotate?: number;
  },
): Meal | null {
  const share = SHARE[slot];
  const kcal = ctx.targets.kcal * share;
  const prot = ctx.targets.protein_g * share * (opts.boost ?? 1);
  const protein =
    opts.protein ??
    pick(["protein"], ctx, stock, {
      avoid: opts.avoid,
      prefer: opts.prefer,
      need: 100,
      rotate: opts.rotate ?? d,
    });
  if (!protein) return null;
  const carb =
    opts.carb ??
    pick(["carb"], ctx, stock, {
      avoid: opts.avoid,
      prefer: opts.prefer,
      exclude: ["oats", "bread"],
      rotate: opts.rotate ?? d,
    });
  const veg =
    opts.veg ??
    pick(["veg"], ctx, stock, {
      avoid: opts.avoid,
      rotate: (opts.rotate ?? d) + (slot === "dinner" ? 1 : 0),
    });
  const oil =
    ctx.allowStaples || (stock.get("olive_oil")?.left ?? 0) > 0
      ? [{ key: "olive_oil", grams: 7 }]
      : [];
  const ings = portion(
    protein,
    carb,
    [...(veg ? [{ key: veg.key, grams: 130 }] : []), ...oil],
    kcal,
    prot,
    stock,
  );
  const pv = protein.short ?? protein.name;
  const vn = veg ? FOOD[veg.key]!.name.toLowerCase() : "";
  let name: string;
  if (protein.key === "eggs" && carb?.key === "potatoes")
    name = `Egg and potato hash${veg ? ` with ${vn}` : ""}`;
  else if (carb?.key === "rice" || carb?.key === "quinoa" || carb?.key === "couscous")
    name = `${pv} ${carb.short} bowl${veg ? ` with ${vn}` : ""}`;
  else if (carb?.key === "pasta") name = `${pv} pasta${veg ? ` with ${vn}` : ""}`;
  else if (carb?.key === "wraps") name = `${pv} wraps${veg ? ` with ${vn}` : ""}`;
  else if (carb)
    name = `${protein.name.split(" (")[0]} with ${carb.short}${veg ? ` and ${vn}` : ""}`;
  else name = `${protein.name.split(" (")[0]}${veg ? ` with ${vn}` : ""}`;
  const minutes =
    protein.key === "eggs" || protein.key === "tuna"
      ? 15
      : carb?.key === "potatoes" || carb?.key === "sweet_potato"
        ? 35
        : 25;
  return mk(
    slot,
    name,
    ings,
    opts.quick ? Math.min(minutes, 15) : minutes,
    protein.key === "eggs" && carb?.key === "potatoes" ? STEPS["hash"]! : STEPS["bowl"]!,
    [],
  );
}

function snack(d: number, ctx: PrepContext, stock: Stock, avoid: string[]): Meal | null {
  return (
    snackPass(d, ctx, stock, avoid, false) ??
    (ctx.onlyExisting ? null : snackPass(d, ctx, stock, avoid, true))
  );
}
function snackPass(
  d: number,
  ctx: PrepContext,
  stock: Stock,
  avoid: string[],
  shop: boolean,
): Meal | null {
  const kcal = ctx.targets.kcal * SHARE.snack;
  const cands: { name: string; build: () => Ingredient[] }[] = [];
  const has = (k: string) =>
    usable(FOOD[k]!, ctx, avoid) && ((stock.get(k)?.left ?? 0) > 0 || shop);
  if (has("greek_yoghurt"))
    cands.push({
      name: "Greek yoghurt",
      build: () => [ing("greek_yoghurt", Math.min(300, (kcal * 100) / 73), stock)],
    });
  if (has("eggs")) cands.push({ name: "Boiled eggs", build: () => [ing("eggs", 100, stock)] });
  const fruit = pick(["fruit"], ctx, stock, { avoid, rotate: d });
  if (fruit && (stock.get(fruit.key)?.left ?? 0) > 0)
    cands.push({
      name: FOOD[fruit.key]!.name.replace(/s$/, ""),
      build: () => [
        ing(
          fruit.key,
          FOOD[fruit.key]!.unit.grams > 200 ? 150 : FOOD[fruit.key]!.unit.grams * 1.5,
          stock,
        ),
      ],
    });
  if (has("hummus") && has("carrots"))
    cands.push({
      name: "Hummus and carrot sticks",
      build: () => [ing("hummus", 50, stock), ing("carrots", 100, stock)],
    });
  if (has("nuts")) cands.push({ name: "Handful of nuts", build: () => [ing("nuts", 25, stock)] });
  if (has("cottage_cheese"))
    cands.push({ name: "Cottage cheese", build: () => [ing("cottage_cheese", 150, stock)] });
  if (!cands.length) return null;
  const c = cands[d % cands.length]!;
  return mk(
    "snack",
    c.name,
    c.build(),
    c.name === "Boiled eggs" ? 10 : 2,
    c.name === "Boiled eggs"
      ? "Boil for 8–9 minutes, cool in cold water, keep in the fridge in their shells."
      : "Ready to eat.",
    ["quick"],
  );
}

function mk(
  slot: Slot,
  name: string,
  ingredients: Ingredient[],
  minutes: number,
  steps: string,
  tags: string[],
): Meal {
  return {
    slot,
    name,
    ingredients,
    ...mealTotals(ingredients),
    minutes,
    batch: null,
    steps,
    state: "planned",
    tags,
  };
}

/** Builds the whole plan. Lunches (and busy-evening dinners) are batch-cooked per prep block. */
export function buildPrepPlan(ctx: PrepContext, inventory: InventoryItem[]): PrepPlan {
  const stock = stockOf(inventory);
  const notes: string[] = [];
  const days: Day[] = [];
  const blockOf = (d: number): "A" | "B" => (d <= 2 ? "A" : "B");
  const batchMeal: Partial<Record<"A" | "B", Meal>> = {};
  const notUsable = inventory.filter(
    (i) => i.food_key && FOOD[i.food_key] && !usable(FOOD[i.food_key]!, ctx),
  );
  if (notUsable.length)
    notes.push(
      `Not used because of your allergies, diet or dislikes: ${notUsable.map((i) => i.name).join(", ")}.`,
    );
  for (let d = 0; d < ctx.days; d++) {
    const date = addDays(ctx.startDate, d);
    const dayNotes: string[] = [];
    const meals: Meal[] = [];
    const training = ctx.trainingDates.includes(date);
    if (training) dayNotes.push("Training day: dinner carries a little more protein.");
    for (const slot of ctx.slots) {
      let m: Meal | null = null;
      if (slot === "breakfast") {
        const quick = ctx.quickBreakfastDates.includes(date);
        m = breakfast(d, ctx, stock, [], quick);
        if (quick) dayNotes.push("Early start: a make-ahead or 5-minute breakfast.");
      } else if (slot === "lunch") {
        const b = blockOf(d);
        const base = batchMeal[b];
        m = base ? clone(base) : main("lunch", d, ctx, stock, { rotate: b === "A" ? 0 : 1 });
        if (m) {
          m.batch = b;
          if (!base) batchMeal[b] = clone(m);
        }
      } else if (slot === "dinner") {
        const busy = ctx.busyEveningDates.includes(date);
        const lunchProtein = meals
          .find((x) => x.slot === "lunch")
          ?.ingredients.find((i) => FOOD[i.key]?.role === "protein")?.key;
        const avoid = lunchProtein ? [lunchProtein] : [];
        m = main("dinner", d, ctx, stock, {
          avoid,
          rotate: d + 2,
          quick: busy,
          boost: training ? 1.15 : 1,
        });
        if (!m && avoid.length)
          m = main("dinner", d, ctx, stock, {
            rotate: d + 2,
            quick: busy,
            boost: training ? 1.15 : 1,
          });
        if (m && busy) {
          m.batch = blockOf(d);
          m.tags.push("from prep");
          dayNotes.push("Long day: dinner is a prepared portion.");
        }
      } else m = snack(d, ctx, stock, []);
      if (m) {
        take(stock, m.ingredients);
        meals.push(m);
      } else
        notes.push(
          `${dayLabel(date)} ${slot}: not enough ${ctx.onlyExisting ? "of your own food" : "suitable food"} to make this meal.`,
        );
    }
    rebalance(meals, ctx.targets.kcal);
    days.push({ date, label: dayLabel(date), notes: dayNotes, meals, totals: dayTotals(meals) });
  }
  const plan: PrepPlan = { policy: MEAL_PREP_POLICY, kind: "inventory", context: ctx, days, notes };
  const avg = days.length ? days.reduce((a, d) => a + d.totals.kcal, 0) / days.length : 0;
  if (ctx.onlyExisting && avg < ctx.targets.kcal * 0.85)
    notes.push(
      `Using only your food, days average ${Math.round(avg)} kcal against ${ctx.targets.kcal}. Add more food or allow a shopping list to reach your target.`,
    );
  return plan;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Nudges carb portions, then whole portions, so every day lands within about 3% of the calorie target. */
function rebalance(meals: Meal[], target: number) {
  for (let pass = 0; pass < 4; pass++) {
    const diff = target - dayTotals(meals).kcal;
    if (Math.abs(diff) < target * 0.03) return;
    const adjustable = meals
      .filter((m) => m.batch == null || pass > 0)
      .flatMap((m) =>
        m.ingredients.filter((i) => FOOD[i.key]?.role === "carb").map((i) => ({ m, i })),
      );
    if (!adjustable.length) break;
    for (const { m, i } of adjustable) {
      const f = FOOD[i.key]!;
      const delta = ((diff / adjustable.length) * 100) / Math.max(1, i.per100.kcal);
      // Higher-calorie days (weight gain) may need bigger carb portions than an everyday serving.
      const cap = (f.max ?? 150) * (diff > 0 ? 1.8 : 1.2);
      i.grams = Math.max(f.min ?? 20, Math.min(cap, Math.round((i.grams + delta) / 5) * 5));
      Object.assign(m, mealTotals(m.ingredients));
    }
  }
  // Still outside the band (carbs capped): scale every portion of the day evenly, within ±40%.
  const total = dayTotals(meals).kcal;
  if (total > 0 && Math.abs(target - total) >= target * 0.03) {
    const k = Math.max(0.6, Math.min(1.4, target / total));
    for (const m of meals) {
      for (const i of m.ingredients) i.grams = Math.max(5, Math.round((i.grams * k) / 5) * 5);
      Object.assign(m, mealTotals(m.ingredients));
    }
  }
}

// ---------- Derived views: shopping, prep, usage ----------
export function usage(plan: PrepPlan) {
  const used = new Map<string, number>();
  for (const d of plan.days)
    for (const m of d.meals)
      if (m.state !== "skipped")
        for (const i of m.ingredients) used.set(i.key, (used.get(i.key) ?? 0) + i.grams);
  return used;
}

const STAPLES = new Set(["olive_oil"]);
export function shoppingList(plan: PrepPlan, inventory: InventoryItem[]) {
  const stock = stockOf(inventory);
  const have: { name: string; grams: number | null; using: number }[] = [];
  const buy: { name: string; grams: number; label: string }[] = [];
  for (const [key, need] of usage(plan)) {
    const f = FOOD[key]!;
    const s = stock.get(key);
    if (s)
      have.push({
        name: f.name,
        grams: s.left === Infinity ? null : s.left,
        using: Math.round(need),
      });
    const short = s ? (s.left === Infinity ? 0 : need - s.left) : need;
    if (short > 0 && !(STAPLES.has(key) && plan.context.allowStaples)) {
      const g = Math.ceil(short / 10) * 10;
      const pieces = f.pack ? Math.ceil(g / f.pack.grams) : null;
      const label =
        key === "eggs"
          ? `${Math.ceil(g / 50)} eggs`
          : f.unit.grams <= 200 && f.role !== "veg"
            ? `${g} g (about ${Math.ceil(g / f.unit.grams)} × ${f.unit.label})`
            : pieces && pieces > 0 && f.pack
              ? `${g} g (${pieces} × ${f.pack.grams} g pack)`
              : `${g} g`;
      buy.push({ name: f.name, grams: g, label });
    }
  }
  const leftovers = [...stock.entries()]
    .filter(([k, s]) => s.left !== Infinity && s.left - (usage(plan).get(k) ?? 0) > 0)
    .map(([k, s]) => ({
      name: FOOD[k]!.name,
      grams: Math.round(s.left - (usage(plan).get(k) ?? 0)),
      expires: s.expires,
    }));
  const unmatched = inventory.filter((i) => !i.food_key || !FOOD[i.food_key]).map((i) => i.name);
  return {
    have,
    buy: buy.sort((a, b) => a.name.localeCompare(b.name)),
    leftovers,
    unmatched,
    staples: plan.context.allowStaples ? ["cooking oil", "salt, pepper, herbs and spices"] : [],
  };
}

/** Food-safety storage per UK FSA/NHS guidance: cooked leftovers within 2 days, cooked rice within 1 day, otherwise freeze. */
export function storageFor(mealDate: string, prepDate: string, ings: Ingredient[]) {
  const daysAfter = Math.round(
    (Date.parse(`${mealDate}T12:00:00Z`) - Date.parse(`${prepDate}T12:00:00Z`)) / 864e5,
  );
  const rice = ings.some((i) => i.key === "rice");
  const fridgeDays = rice ? 1 : 2;
  return daysAfter <= fridgeDays ? "fridge" : "freezer";
}

export function prepSessions(plan: PrepPlan) {
  const ctx = plan.context;
  const sessions: {
    date: string;
    label: string;
    cook: { name: string; grams: number }[];
    creates: string[];
    minutes: number;
    storage: string[];
  }[] = [];
  const blocks: ("A" | "B")[] = ["A", "B"];
  for (const b of blocks) {
    const date = b === "A" || !ctx.secondPrep ? ctx.prepDay : addDays(ctx.startDate, 2);
    const meals = plan.days.flatMap((d) =>
      d.meals.filter((m) => m.batch === b && m.state !== "skipped").map((m) => ({ d, m })),
    );
    const breakfasts =
      b === "A"
        ? plan.days
            .slice(0, 3)
            .flatMap((d) =>
              d.meals.filter((m) => m.tags.includes("make-ahead")).map((m) => ({ d, m })),
            )
        : [];
    const eggs = plan.days
      .filter((_, i) => (b === "A" ? i <= 2 : i > 2))
      .flatMap((d) => d.meals.filter((m) => m.name === "Boiled eggs").map((m) => ({ d, m })));
    const all = [...meals, ...breakfasts, ...eggs];
    if (!all.length) continue;
    const cook = new Map<string, number>();
    for (const { m } of all)
      for (const i of m.ingredients)
        if (!STAPLES.has(i.key)) cook.set(i.key, (cook.get(i.key) ?? 0) + i.grams);
    const creates = new Map<string, number>();
    for (const { m } of all) creates.set(m.name, (creates.get(m.name) ?? 0) + 1);
    const storage = all.map(
      ({ d, m }) => `${d.label} ${m.slot}: ${storageFor(d.date, date, m.ingredients)}`,
    );
    const frozen = storage.filter((s) => s.endsWith("freezer")).length;
    const s = sessions.find((x) => x.date === date);
    const entry = {
      date,
      label: dayLabel(date),
      cook: [...cook.entries()].map(([k, g]) => ({ name: FOOD[k]!.name, grams: Math.round(g) })),
      creates: [...creates.entries()].map(([n, c]) => `${c} × ${n}`),
      minutes: Math.min(150, 25 + 15 * new Set(all.map((x) => x.m.name)).size + (frozen ? 10 : 0)),
      storage: [
        ...storage,
        "Cool cooked food quickly (rice within an hour), keep it covered in the fridge, reheat only once until steaming hot.",
        ...(frozen
          ? [
              "Freeze the portions marked freezer on the day you cook; defrost in the fridge the night before.",
            ]
          : []),
      ],
    };
    if (s) {
      s.cook.push(...entry.cook);
      s.creates.push(...entry.creates);
      s.storage.push(...entry.storage.slice(0, -2));
      s.minutes = Math.min(180, s.minutes + entry.minutes - 15);
    } else sessions.push(entry);
  }
  return sessions;
}

// ---------- Edits (only the affected meals change) ----------
export type PlanEdit =
  | { type: "swap"; a: { date: string; slot: Slot }; b: { date: string; slot: Slot } }
  | {
      type: "replace";
      date: string;
      slot: Slot;
      avoid?: string[];
      prefer?: string[];
      vegetarian?: boolean;
      quick?: boolean;
    }
  | { type: "adjust_kcal"; date: string; kcal: number }
  | { type: "more_protein"; date: string; grams: number }
  | { type: "remove"; date: string; slot: Slot }
  | { type: "replace_days"; from: string; avoid?: string[]; prefer?: string[]; slot?: Slot };

export function applyEdit(
  plan: PrepPlan,
  inventory: InventoryItem[],
  e: PlanEdit,
): { plan: PrepPlan; changed: string[] } {
  const p = clone(plan);
  const changed: string[] = [];
  const find = (date: string, slot: Slot) => {
    const d = p.days.find((x) => x.date === date);
    return { d, i: d ? d.meals.findIndex((m) => m.slot === slot) : -1 };
  };
  // Stock left for this edit = inventory minus everything else still planned.
  const stockExcept = (skip: Meal[]) => {
    const s = stockOf(inventory);
    for (const d of p.days) for (const m of d.meals) if (!skip.includes(m)) take(s, m.ingredients);
    return s;
  };
  const locked = (m?: Meal) => m && (m.state === "eaten" || m.state === "skipped");
  if (e.type === "swap") {
    const A = find(e.a.date, e.a.slot),
      B = find(e.b.date, e.b.slot);
    if (!A.d || !B.d || A.i < 0 || B.i < 0) throw new Error("Meal not found in the plan.");
    if (locked(A.d.meals[A.i]) || locked(B.d.meals[B.i]))
      throw new Error("A meal already eaten or skipped can't be swapped.");
    const ma = A.d.meals[A.i]!,
      mb = B.d.meals[B.i]!;
    A.d.meals[A.i] = { ...mb, slot: ma.slot, state: "swapped" };
    B.d.meals[B.i] = { ...ma, slot: mb.slot, state: "swapped" };
    changed.push(`${A.d.label} ${e.a.slot}`, `${B.d.label} ${e.b.slot}`);
  } else if (e.type === "replace" || e.type === "replace_days") {
    const targets =
      e.type === "replace"
        ? [{ date: e.date, slot: e.slot }]
        : p.days
            .filter((d) => d.date >= e.from)
            .flatMap((d) =>
              d.meals
                .filter((m) => !locked(m) && (!e.slot || m.slot === e.slot))
                .map((m) => ({ date: d.date, slot: m.slot })),
            );
    for (const t of targets) {
      const { d, i } = find(t.date, t.slot);
      if (!d) throw new Error("That day isn't in the plan.");
      const old = i >= 0 ? d.meals[i]! : undefined;
      if (locked(old)) throw new Error("That meal is already eaten or skipped.");
      const ctx: PrepContext = {
        ...p.context,
        diet: e.type === "replace" && e.vegetarian ? "vegetarian" : p.context.diet,
      };
      const stock = stockExcept(old ? [old] : []);
      const idx = p.days.indexOf(d);
      const avoid = [
        ...(e.avoid ?? []),
        ...(old &&
        e.type === "replace" &&
        !e.prefer?.length &&
        !e.avoid?.length &&
        !(e.type === "replace" && (e.vegetarian || e.quick))
          ? old.ingredients.filter((x) => FOOD[x.key]?.role === "protein").map((x) => x.key)
          : []),
      ];
      let m: Meal | null;
      if (t.slot === "breakfast")
        m = breakfast(
          idx + 1,
          ctx,
          stock,
          avoid,
          e.type === "replace" ? !!e.quick : false,
          e.prefer,
        );
      else if (t.slot === "snack") m = snack(idx + 1, ctx, stock, avoid);
      else
        m = main(t.slot, idx, ctx, stock, {
          avoid,
          prefer: e.prefer,
          quick: e.type === "replace" ? e.quick : false,
          rotate: idx + 3,
        });
      if (!m)
        throw new Error(
          `No suitable ${t.slot} for ${d.label} with ${p.context.onlyExisting ? "only your food" : "those limits"}.`,
        );
      m.state = old ? "swapped" : "planned";
      if (i >= 0) d.meals[i] = m;
      else d.meals.push(m);
      changed.push(`${d.label} ${t.slot}`);
    }
  } else if (e.type === "adjust_kcal" || e.type === "more_protein") {
    const d = p.days.find((x) => x.date === e.date);
    if (!d) throw new Error("That day isn't in the plan.");
    const open = d.meals.filter((m) => !locked(m));
    for (const m of open) {
      if (e.type === "adjust_kcal") {
        const carbs = m.ingredients.filter(
          (i) => FOOD[i.key]?.role === "carb" || FOOD[i.key]?.role === "fat",
        );
        for (const i of carbs)
          i.grams = Math.max(
            10,
            Math.round(
              (i.grams +
                ((e.kcal / open.length / carbs.length) * 100) / Math.max(1, i.per100.kcal)) /
                5,
            ) * 5,
          );
      } else if (m.slot === "lunch" || m.slot === "dinner") {
        const pi = m.ingredients.find((i) => FOOD[i.key]?.role === "protein");
        if (pi)
          pi.grams =
            Math.round((pi.grams + ((e.grams / 2) * 100) / Math.max(1, pi.per100.p)) / 5) * 5;
      }
      Object.assign(m, mealTotals(m.ingredients));
      m.batch = null; // changed portions no longer match the batch
    }
    changed.push(`${d.label} (${open.length} meals)`);
  } else if (e.type === "remove") {
    const { d, i } = find(e.date, e.slot);
    if (!d || i < 0) throw new Error("Meal not found in the plan.");
    if (locked(d.meals[i])) throw new Error("That meal is already eaten or skipped.");
    d.meals.splice(i, 1);
    changed.push(`${d.label} ${e.slot}`);
  }
  for (const d of p.days) d.totals = dayTotals(d.meals);
  return { plan: p, changed };
}

/** The member's real day: consumed comes only from logged food entries; planned meals are listed separately. */
export function dayStatus(
  entries: { kcal: number; protein_g: number; carbs_g: number; fat_g: number }[],
  target: Totals | null,
  plannedDay: Day | undefined,
) {
  const eaten = entries.reduce(
    (a, x) => ({
      kcal: a.kcal + Number(x.kcal),
      protein_g: a.protein_g + Number(x.protein_g),
      carbs_g: a.carbs_g + Number(x.carbs_g),
      fat_g: a.fat_g + Number(x.fat_g),
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
  const round = (t: Totals) => ({
    kcal: Math.round(t.kcal),
    protein_g: Math.round(t.protein_g),
    carbs_g: Math.round(t.carbs_g),
    fat_g: Math.round(t.fat_g),
  });
  const upcoming = (plannedDay?.meals ?? []).filter(
    (m) => m.state === "planned" || m.state === "prepared" || m.state === "swapped",
  );
  return {
    consumed: round(eaten),
    target: target ? round(target) : null,
    remaining: target
      ? round({
          kcal: target.kcal - eaten.kcal,
          protein_g: target.protein_g - eaten.protein_g,
          carbs_g: target.carbs_g - eaten.carbs_g,
          fat_g: target.fat_g - eaten.fat_g,
        })
      : null,
    upcoming: upcoming.map((m) => ({
      slot: m.slot,
      name: m.name,
      kcal: m.kcal,
      protein_g: m.protein_g,
    })),
    upcomingKcal: upcoming.reduce((a, m) => a + m.kcal, 0),
  };
}
