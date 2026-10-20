import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildMealPlan, MEAL_PLAN_POLICY, type PlanMeal } from "./meal-planner";
import { localDayKey, weekKeyOf, addDaysKey } from "./tz";

const PREP_GOAL = "Weekly meal prep";

export const getMealPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("timezone").maybeSingle();
    const wk = weekKeyOf(new Date(), prof?.timezone ?? "UTC");
    const { data } = await context.supabase
      .from("meal_plans")
      .select("*")
      .eq("week_start", wk)
      .neq("policy_version", "meal-prep-1.0.0")
      .in("status", ["proposed", "approved"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { weekStart: wk, plan: data };
  });

export const generateMealPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        household: z.number().int().min(1).max(12),
        prepMinutes: z.number().int().min(0).max(600),
        exclusions: z.array(z.string().trim().max(40)).max(20),
        nextWeek: z.boolean().default(false),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles")
      .select("timezone,allergies,diet_type")
      .maybeSingle();
    const tz = prof?.timezone ?? "UTC";
    const thisWeek = weekKeyOf(new Date(), tz);
    const weekStart = data.nextWeek ? addDaysKey(thisWeek, 7) : thisWeek;
    const since = addDaysKey(localDayKey(new Date(), tz), -14);
    const [{ data: meals }, { data: target }, { data: eaten }] = await Promise.all([
      supabase.from("saved_meals").select("id,name,kind,servings,items"),
      supabase
        .from("nutrition_targets")
        .select("kcal,protein_g,carbs_g,fat_g")
        .eq("status", "applied")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("food_entries").select("name").gte("eaten_on", since).like("source", "%:meal"),
    ]);
    const items = (meals ?? []).flatMap(
      (m) =>
        z
          .array(z.object({ food_id: z.string().uuid(), grams: z.number().positive() }))
          .safeParse(m.items).data ?? [],
    );
    const { data: foods } = items.length
      ? await supabase
          .from("user_foods")
          .select("id,name,kcal_100g,protein_100g,carbs_100g,fat_100g,allergens,favourite")
          .in("id", [...new Set(items.map((i) => i.food_id))])
      : { data: [] };
    // Adapt from actual behaviour: count how often each saved meal was really logged in the last 14 days.
    const planMeals: PlanMeal[] = (meals ?? []).map((m) => {
      const its =
        z.array(z.object({ food_id: z.string(), grams: z.number() })).safeParse(m.items).data ?? [];
      const ingredients = its.flatMap((it) => {
        const f = foods?.find((x) => x.id === it.food_id);
        return f
          ? [
              {
                food_id: f.id,
                name: f.name,
                grams: it.grams,
                kcal_100g: Number(f.kcal_100g),
                protein_100g: Number(f.protein_100g),
                carbs_100g: Number(f.carbs_100g),
                fat_100g: Number(f.fat_100g),
                allergens: f.allergens ?? [],
              },
            ]
          : [];
      });
      return {
        id: m.id,
        name: m.name,
        kind: m.kind as "meal" | "recipe",
        servings: Number(m.servings),
        ingredients,
        favourite: ingredients.some((i) => foods?.find((f) => f.id === i.food_id)?.favourite),
        timesLogged14d:
          (eaten ?? []).filter((e) => e.name.endsWith(` · ${m.name}`)).length /
          Math.max(1, ingredients.length),
      };
    });
    const plan = buildMealPlan({
      weekStart,
      meals: planMeals,
      targets: target
        ? {
            kcal: target.kcal,
            protein_g: target.protein_g,
            carbs_g: target.carbs_g,
            fat_g: target.fat_g,
          }
        : null,
      dietType: prof?.diet_type,
      allergies: prof?.allergies ?? [],
      exclusions: data.exclusions,
      household: data.household,
      prepMinutes: data.prepMinutes,
    });
    await supabase
      .from("meal_plans")
      .update({ status: "superseded" })
      .eq("week_start", weekStart)
      .neq("policy_version", "meal-prep-1.0.0")
      .eq("status", "proposed");
    const { data: row, error } = await supabase
      .from("meal_plans")
      .insert({
        user_id: userId,
        week_start: weekStart,
        household: data.household,
        prep_minutes: plan.prepMinutes,
        plan: { ...plan, exclusions: data.exclusions },
        policy_version: MEAL_PLAN_POLICY,
      })
      .select("*")
      .single();
    if (error) throw new Error("The meal plan could not be saved.");
    return { plan: row };
  });

/** Material change: a plan only drives scheduling once the user approves it (V3 §18.1 inspect/edit/reject/approve). */
export const decideMealPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ id: z.string().uuid(), approve: z.boolean(), note: z.string().max(300).nullable() })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("meal_plans")
      .select("id,week_start,status,prep_minutes")
      .eq("id", data.id)
      .maybeSingle();
    if (!row || row.status !== "proposed")
      throw new Error("This plan is no longer waiting for a decision.");
    if (data.approve)
      await supabase
        .from("meal_plans")
        .update({ status: "superseded" })
        .eq("week_start", row.week_start)
        .neq("policy_version", "meal-prep-1.0.0")
        .eq("status", "approved");
    await supabase
      .from("meal_plans")
      .update({ status: data.approve ? "approved" : "rejected", decision_note: data.note })
      .eq("id", row.id);
    const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    await db.from("audit_events").insert({
      user_id: userId,
      actor_type: "user",
      action: data.approve ? "meal_plan.approved" : "meal_plan.rejected",
      resource_type: "meal_plan",
      resource_id: row.id,
      outcome: "succeeded",
      metadata: { note: data.note },
    });
    if (!data.approve) return { ok: true };
    const plan = { prepMinutes: row.prep_minutes };
    // Batch prep becomes a planner goal so the whole-life optimiser schedules it as a meal_prep occurrence with reminders.
    const goal = {
      title: PREP_GOAL,
      domain: "meal_prep",
      weekly_minutes: plan.prepMinutes,
      minimum_weekly_minutes: plan.prepMinutes,
      session_minutes: Math.max(30, plan.prepMinutes),
      preferred_time: "evening",
      status: plan.prepMinutes > 0 ? "active" : "paused",
    };
    const { data: existing } = await supabase
      .from("goals")
      .select("id")
      .eq("domain", "meal_prep")
      .eq("title", PREP_GOAL)
      .maybeSingle();
    if (existing) await supabase.from("goals").update(goal).eq("id", existing.id);
    else if (plan.prepMinutes > 0)
      await supabase.from("goals").insert({
        ...goal,
        user_id: userId,
        priority: 3,
        why: "Batch cooking from your weekly meal plan.",
      });
    return { ok: true };
  });

/** User edit: remove one planned meal from a proposed plan before approving. */
export const removePlannedMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        slot: z.enum(["breakfast", "lunch", "dinner", "snack"]),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row } = await supabase
      .from("meal_plans")
      .select("id,status,plan")
      .eq("id", data.id)
      .maybeSingle();
    if (!row || row.status !== "proposed")
      throw new Error("Only a plan waiting for approval can be edited.");
    const plan = row.plan as {
      days: { date: string; meals: { slot: string; mealId: string }[] }[];
      excluded?: string[];
    };
    const day = plan.days.find((d) => d.date === data.date);
    const m = day?.meals.find((x) => x.slot === data.slot);
    if (!day || !m) throw new Error("Meal not found.");
    day.meals = day.meals.filter((x) => x !== m);
    await supabase
      .from("meal_plans")
      .update({ plan: plan as never })
      .eq("id", row.id);
    return { ok: true };
  });
