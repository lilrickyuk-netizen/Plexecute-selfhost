// Deterministic nutrition targets (Mifflin-St Jeor BMR × activity, goal adjustment, macro split).
const ACTIVITY: Record<string, number> = { low: 1.2, light: 1.375, moderate: 1.55, high: 1.725 };
const GOAL_ADJ: Record<string, number> = { lose: -0.15, maintain: 0, gain: 0.1 };

export function age(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
}

export function targets(
  p: {
    sex: string | null;
    height_cm: number | null;
    date_of_birth: string | null;
    activity_level: string;
    nutrition_goal: string;
  },
  weightKg: number | null,
) {
  const a = age(p.date_of_birth);
  if (!p.sex || !p.height_cm || !weightKg || a == null) return null;
  const bmr = 10 * weightKg + 6.25 * Number(p.height_cm) - 5 * a + (p.sex === "male" ? 5 : -161);
  const tdee = bmr * (ACTIVITY[p.activity_level] ?? 1.55);
  const kcal = Math.round((tdee * (1 + (GOAL_ADJ[p.nutrition_goal] ?? 0))) / 10) * 10;
  const protein = Math.round(weightKg * (p.nutrition_goal === "maintain" ? 1.6 : 2.0));
  const fat = Math.round((kcal * 0.27) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, fat, carbs, bmr: Math.round(bmr), tdee: Math.round(tdee) };
}

// Epley estimated 1-rep max.
export function e1rm(weight: number, reps: number) {
  return reps <= 1 ? weight : Math.round(weight * (1 + reps / 30) * 10) / 10;
}

// Deterministic progression: if last top set hit RPE ≤ 8 (or unknown) and ≥ target reps, add load.
export function nextLoad(lastWeight: number, lastReps: number, rpe: number | null, targetReps = 8) {
  if (lastReps >= targetReps && (rpe == null || rpe <= 8))
    return {
      weight: Math.round((lastWeight * 1.025) / 1.25) * 1.25,
      reps: targetReps,
      why: "Hit target reps with reps in reserve — add ~2.5%.",
    };
  if (rpe != null && rpe >= 9.5)
    return {
      weight: Math.round((lastWeight * 0.95) / 1.25) * 1.25,
      reps: targetReps,
      why: "Last set was near max effort — back off ~5%.",
    };
  return { weight: lastWeight, reps: targetReps, why: "Repeat the load and aim for target reps." };
}
