// Plexecute Nutrition / Metabolic Engine (V3 §47). Deterministic; adult wellness, not clinical dietetics.
export const NUTRITION_POLICY_VERSION = "nutrition-policy-1.0.0";

export const ACTIVITY: Record<string, { mult: number; label: string }> = {
  low: { mult: 1.2, label: "Sedentary" },
  light: { mult: 1.375, label: "Light" },
  moderate: { mult: 1.55, label: "Moderate" },
  high: { mult: 1.725, label: "Very active" },
  exceptional: { mult: 1.9, label: "Exceptional" },
};

export function ageFrom(dob: string | null, now = new Date()): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  let a = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
}

export type TargetInput = {
  sex: string | null;
  height_cm: number | null;
  age: number | null;
  weight_kg: number | null;
  activity: string;
  goal: string;
  training_focus: "strength" | "general";
  tdee_override?: number | null;
};
export type Targets = {
  status: "ok" | "wide_estimate" | "blocked" | "missing";
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  tdee: number;
  bmr: number | null;
  kcal_range?: [number, number] | undefined;
  weekly_change_pct: number | null;
  notes: string[];
};

const r10 = (n: number) => Math.round(n / 10) * 10;

export function computeTargets(i: TargetInput): Targets {
  const notes: string[] = [];
  const empty = (status: Targets["status"], note: string): Targets => ({
    status,
    kcal: 0,
    protein_g: 0,
    fat_g: 0,
    carbs_g: 0,
    tdee: 0,
    bmr: null,
    weekly_change_pct: null,
    notes: [note],
  });
  if (!i.weight_kg || !i.height_cm || i.age == null)
    return empty(
      "missing",
      "Add your height, date of birth and a weight log to calculate targets.",
    );
  const W = i.weight_kg,
    H = i.height_cm,
    A = i.age;
  const bmi = W / (H / 100) ** 2;
  const mult = ACTIVITY[i.activity]?.mult ?? 1.55;
  let bmr: number | null = null;
  let tdee: number;
  let range: [number, number] | undefined;
  if (i.sex === "male" || i.sex === "female") {
    bmr = 10 * W + 6.25 * H - 5 * A + (i.sex === "male" ? 5 : -161);
    tdee = bmr * mult;
  } else {
    // Sex not given: do not invent it. Return the span of both equations (wider estimate).
    const lo = (10 * W + 6.25 * H - 5 * A - 161) * mult;
    const hi = (10 * W + 6.25 * H - 5 * A + 5) * mult;
    tdee = (lo + hi) / 2;
    range = [r10(lo), r10(hi)];
    notes.push("Sex wasn't given, so this is a wider estimate. The standard equation needs it.");
  }
  if (i.tdee_override) {
    tdee = i.tdee_override;
    notes.push(
      "Maintenance comes from your own logged intake and weight trend (adaptive estimate).",
    );
  } else
    notes.push(
      `Starting estimate: Mifflin-St Jeor × ${mult} activity. It will adapt once you have enough logs.`,
    );

  let kcal = tdee;
  let weekly: number | null = 0;
  if (i.goal === "lose") {
    if (bmi < 18.5)
      return {
        ...empty(
          "blocked",
          "Your BMI screening result is in the underweight range, so Plexecute won't set a weight-loss target. BMI is only a screening measure; please speak to your GP or a registered dietitian.",
        ),
        tdee: Math.round(tdee),
        bmr: bmr && Math.round(bmr),
      };
    kcal = tdee * 0.85;
    kcal = Math.max(kcal, tdee * 0.75);
    // Weekly loss: deficit*7/7700 kg; cap 1.0%/wk, aim 0.25–0.75%.
    let lossKg = ((tdee - kcal) * 7) / 7700;
    const maxKg = W * 0.0075;
    if (lossKg > maxKg) {
      kcal = tdee - (maxKg * 7700) / 7;
      lossKg = maxKg;
      notes.push("Deficit reduced to keep loss within 0.75% of bodyweight a week.");
    }
    if (kcal < 1200) {
      kcal = 1200;
      lossKg = Math.max(0, ((tdee - kcal) * 7) / 7700);
      notes.push(
        "Plexecute never sets fewer than 1,200 kcal a day. The timeline is extended instead.",
      );
    }
    if (tdee <= 1200)
      return {
        ...empty(
          "blocked",
          "A safe deficit isn't possible from your estimated maintenance. Please speak to a registered dietitian.",
        ),
        tdee: Math.round(tdee),
        bmr: bmr && Math.round(bmr),
      };
    weekly = -Math.round((lossKg / W) * 1000) / 10;
  } else if (i.goal === "gain") {
    kcal = Math.min(tdee * 1.1, tdee + 500);
    weekly = Math.round((((kcal - tdee) * 7) / 7700 / W) * 1000) / 10;
  }
  kcal = r10(kcal);
  const protein = Math.round(W * (i.training_focus === "strength" ? 1.6 : 1.4));
  const fat = Math.round((kcal * 0.3) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return {
    status: range ? "wide_estimate" : "ok",
    kcal,
    protein_g: protein,
    fat_g: fat,
    carbs_g: carbs,
    tdee: Math.round(tdee),
    bmr: bmr && Math.round(bmr),
    kcal_range: range,
    weekly_change_pct: weekly,
    notes,
  };
}

// ---------- Adaptive expenditure (V3 §47.5) ----------
export type DayIntake = { date: string; kcal: number };
export type WeightObs = { date: string; kg: number };
export type AdaptiveResult = {
  eligible: boolean;
  reasons: string[];
  tdee: number | null;
  trend_kg_per_week: number | null;
  confidence: "low" | "medium" | "high";
};

function median(a: number[]) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Theil–Sen slope (robust trend), kg/day. */
function robustSlope(pts: { t: number; y: number }[]) {
  const slopes: number[] = [];
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      if (pts[j]!.t !== pts[i]!.t) slopes.push((pts[j]!.y - pts[i]!.y) / (pts[j]!.t - pts[i]!.t));
  return slopes.length ? median(slopes) : 0;
}

export function adaptiveTdee(
  intake: DayIntake[],
  weights: WeightObs[],
  prevEstimate: number | null,
  now = new Date(),
): AdaptiveResult {
  const day = 864e5;
  const windowStart = now.getTime() - 21 * day;
  const all = [...intake.map((x) => x.date), ...weights.map((x) => x.date)].sort();
  const elapsed = all.length
    ? (now.getTime() - new Date(all[0]! + "T00:00:00").getTime()) / day
    : 0;
  const usable = intake.filter(
    (x) =>
      new Date(x.date + "T00:00:00").getTime() >= windowStart && x.kcal >= 800 && x.kcal <= 6000,
  );
  const ws = weights.filter((x) => new Date(x.date + "T00:00:00").getTime() >= windowStart);
  const reasons: string[] = [];
  if (elapsed < 21)
    reasons.push(`${Math.max(0, 21 - Math.floor(elapsed))} more days of history needed`);
  if (usable.length < 14)
    reasons.push(`${14 - usable.length} more days of food logs needed (last 21 days)`);
  if (ws.length < 10) reasons.push(`${10 - ws.length} more weigh-ins needed (last 21 days)`);
  if (reasons.length)
    return { eligible: false, reasons, tdee: null, trend_kg_per_week: null, confidence: "low" };
  const slope = robustSlope(
    ws.map((w) => ({ t: new Date(w.date + "T00:00:00").getTime() / day, y: w.kg })),
  );
  const meanIntake = usable.reduce((s, x) => s + x.kcal, 0) / usable.length;
  const inferred = meanIntake - slope * 7700;
  if (inferred < 1000 || inferred > 6000 || Math.abs(slope * 7) > 1.5)
    return {
      eligible: false,
      reasons: ["This 21-day window looks implausible (possible missed logs), so it was rejected."],
      tdee: null,
      trend_kg_per_week: Math.round(slope * 7 * 100) / 100,
      confidence: "low",
    };
  const smoothed = prevEstimate ? 0.3 * inferred + 0.7 * prevEstimate : inferred;
  const confidence = usable.length >= 19 && ws.length >= 15 ? "high" : "medium";
  return {
    eligible: true,
    reasons: [],
    tdee: Math.round(smoothed),
    trend_kg_per_week: Math.round(slope * 7 * 100) / 100,
    confidence,
  };
}

/** Automatic change capped at 150 kcal/week; larger needs approval. */
export function capTargetChange(current: number, proposed: number) {
  const diff = proposed - current;
  if (Math.abs(diff) <= 150) return { kcal: proposed, needsApproval: false };
  return { kcal: proposed, needsApproval: true };
}

// ---------- Portions ----------
export type Per100 = {
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  fibre_100g?: number | null;
};
export function portion(f: Per100, grams: number) {
  const k = grams / 100;
  const r = (n: number) => Math.round(n * k * 10) / 10;
  return {
    kcal: Math.round(f.kcal_100g * k),
    protein_g: r(f.protein_100g),
    carbs_g: r(f.carbs_100g),
    fat_g: r(f.fat_100g),
    fibre_g: f.fibre_100g == null ? null : r(f.fibre_100g),
  };
}

export function weightTrend(weights: WeightObs[]) {
  // 7-day EWMA trend line.
  let ew: number | null = null;
  return weights.map((w) => {
    ew = ew == null ? w.kg : 0.25 * w.kg + 0.75 * ew;
    return { date: w.date, kg: w.kg, trend: Math.round(ew * 10) / 10 };
  });
}

export const ALLERGENS = [
  "gluten",
  "milk",
  "egg",
  "peanuts",
  "tree nuts",
  "soy",
  "fish",
  "crustaceans",
  "molluscs",
  "sesame",
  "celery",
  "mustard",
  "lupin",
  "sulphites",
] as const;

export type ProviderFood = {
  source: "fatsecret" | "usda_fdc";
  source_ref: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  kcal_100g: number;
  protein_100g: number;
  carbs_100g: number;
  fat_100g: number;
  fibre_100g: number | null;
  serving_g: number | null;
  serving_label: string | null;
  allergens: string[];
  attribution: string;
};
