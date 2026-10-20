// Photo meal estimates. The vision model only identifies foods and gives gram ranges and per-100 g
// values; totals and ranges are computed here deterministically. Nothing here logs food.

export type MealItem = {
  name: string;
  preparation: string | null;
  grams_low: number;
  grams_high: number;
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  confidence: "high" | "medium" | "low";
};
export type MealQuestion = { text: string; options: string[] };
export type MealEstimate = {
  status: "ok" | "unclear";
  unclear_reason: string | null;
  items: MealItem[];
  questions: MealQuestion[];
  summary: string;
};
export type Range = { low: number; high: number; best: number };
export type MealTotals = { kcal: Range; protein_g: Range; carbs_g: Range; fat_g: Range };

const num = (v: unknown, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};

export const UNCLEAR_MESSAGE =
  "I can't estimate this reliably from that photo. Try another photo from above in good light, or tell me the main foods and rough portions. You can always log it by search or by hand instead.";

/** Clamp model output into a safe estimate; anything unusable becomes "unclear", never a guess. */
export function normaliseEstimate(raw: unknown): MealEstimate {
  const r = (raw ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(r["items"]) ? r["items"] : [])
    .map((x: Record<string, unknown>) => {
      const a = Math.round(num(x["grams_low"], 1, 2000));
      const b = Math.round(num(x["grams_high"], 1, 2000));
      return {
        name: String(x["name"] ?? "")
          .trim()
          .slice(0, 80),
        preparation:
          typeof x["preparation"] === "string" && x["preparation"].trim()
            ? x["preparation"].trim().slice(0, 80)
            : null,
        grams_low: Math.min(a, b),
        grams_high: Math.max(a, b),
        kcal_100g: num(x["kcal_100g"], 0, 900),
        protein_100g: num(x["protein_100g"], 0, 100),
        carbs_100g: num(x["carbs_100g"], 0, 100),
        fat_100g: num(x["fat_100g"], 0, 100),
        confidence:
          (["high", "medium", "low"] as const).find((c) => c === x["confidence"]) ?? "low",
      };
    })
    .filter((i) => i.name)
    .slice(0, 12);
  const questions = (Array.isArray(r["questions"]) ? r["questions"] : [])
    .map((q: Record<string, unknown>) => ({
      text: String(q["text"] ?? "")
        .trim()
        .slice(0, 200),
      options: (Array.isArray(q["options"]) ? q["options"] : [])
        .map((o) => String(o).slice(0, 60))
        .filter(Boolean)
        .slice(0, 5),
    }))
    .filter((q) => q.text)
    .slice(0, 2);
  const unclear = r["status"] === "unclear" || items.length === 0;
  return {
    status: unclear ? "unclear" : "ok",
    unclear_reason: unclear
      ? String(r["unclear_reason"] ?? "").slice(0, 200) ||
        "The meal isn't clear enough to identify."
      : null,
    items: unclear ? [] : items,
    questions: unclear ? [] : questions,
    summary: String(r["summary"] ?? "").slice(0, 400),
  };
}

const bestGrams = (i: MealItem) => Math.round((i.grams_low + i.grams_high) / 2);

/** Ranges from the gram ranges; "best" uses the midpoint and is what gets logged. */
export function mealTotals(e: MealEstimate): MealTotals {
  const r = (
    k: "kcal_100g" | "protein_100g" | "carbs_100g" | "fat_100g",
    round: (n: number) => number,
  ): Range => ({
    low: round(e.items.reduce((s, i) => s + (i.grams_low * i[k]) / 100, 0)),
    high: round(e.items.reduce((s, i) => s + (i.grams_high * i[k]) / 100, 0)),
    best: round(e.items.reduce((s, i) => s + (bestGrams(i) * i[k]) / 100, 0)),
  });
  const kc = (n: number) => Math.round(n / 10) * 10;
  return {
    kcal: r("kcal_100g", kc),
    protein_g: r("protein_100g", Math.round),
    carbs_g: r("carbs_100g", Math.round),
    fat_g: r("fat_100g", Math.round),
  };
}

export const fmtRange = (x: Range, unit: string) =>
  x.low === x.high ? `${x.low}${unit}` : `${x.low}–${x.high}${unit}`;

/** The rows that go through the normal food logger, one per item, at the best-estimate weight. */
export function itemsToLog(e: MealEstimate) {
  return e.items.map((i) => ({
    food: {
      source: "ai_estimate" as const,
      source_ref: null,
      name: i.preparation ? `${i.name} (${i.preparation})` : i.name,
      brand: null,
      barcode: null,
      kcal_100g: Math.round(i.kcal_100g),
      protein_100g: Math.round(i.protein_100g * 10) / 10,
      carbs_100g: Math.round(i.carbs_100g * 10) / 10,
      fat_100g: Math.round(i.fat_100g * 10) / 10,
      fibre_100g: null,
      serving_g: null,
      serving_label: null,
      allergens: [] as string[],
    },
    grams: bestGrams(i),
  }));
}

/** Plain-language estimate for the Coach and the screen. */
export function describeEstimate(e: MealEstimate): string {
  if (e.status === "unclear") return `${UNCLEAR_MESSAGE} (${e.unclear_reason})`;
  const t = mealTotals(e);
  return [
    `Looks like: ${e.items.map((i) => `${i.name} ~${i.grams_low === i.grams_high ? i.grams_low : `${i.grams_low}-${i.grams_high}`} g`).join(", ")}.`,
    `Estimated ${fmtRange(t.kcal, " kcal")}; protein ${fmtRange(t.protein_g, " g")}, carbs ${fmtRange(t.carbs_g, " g")}, fat ${fmtRange(t.fat_g, " g")}.`,
    "This is an estimate: oil, sauces, hidden ingredients and exact portions can't be known from a photo.",
    ...e.questions.map(
      (q) => `Question: ${q.text}${q.options.length ? ` (${q.options.join(" / ")})` : ""}`,
    ),
  ].join(" ");
}
