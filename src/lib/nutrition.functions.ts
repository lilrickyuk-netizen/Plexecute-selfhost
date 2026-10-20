import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  adaptiveTdee,
  ageFrom,
  capTargetChange,
  computeTargets,
  NUTRITION_POLICY_VERSION,
  portion,
} from "./nutrition-engine";

const foodSchema = z.object({
  source: z.enum(["fatsecret", "usda_fdc", "manual", "ai_estimate"]),
  source_ref: z.string().max(80).nullable(),
  name: z.string().trim().min(1).max(160),
  brand: z.string().max(120).nullable(),
  barcode: z.string().max(20).nullable(),
  kcal_100g: z.number().min(0).max(950),
  protein_100g: z.number().min(0).max(100),
  carbs_100g: z.number().min(0).max(100),
  fat_100g: z.number().min(0).max(100),
  fibre_100g: z.number().min(0).max(100).nullable(),
  serving_g: z.number().min(0).max(5000).nullable(),
  serving_label: z.string().max(120).nullable(),
  allergens: z.array(z.string().max(40)).max(20),
});
const slot = z.enum(["breakfast", "lunch", "dinner", "snack"]);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

export const foodProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { providerStatus } = await import("./food-provider.server");
    return providerStatus();
  });

export const searchFood = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ q: z.string().trim().min(2).max(100) }).parse(i))
  .handler(async ({ data, context }) => {
    if (!(await (await import("./security.server")).rateLimit("food_search", context.userId)))
      throw new Error("Too many searches. Wait a minute and try again.");
    const { searchFoods } = await import("./food-provider.server");
    try {
      return await searchFoods(data.q);
    } catch (e) {
      console.error(e);
      return {
        foods: [],
        provider: "none",
        degraded: true,
        error: "Food search is temporarily unavailable. You can still add food manually.",
      };
    }
  });

export const lookupBarcode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ code: z.string().regex(/^\d{6,14}$/) }).parse(i))
  .handler(async ({ data }) => {
    const { barcodeLookup, providerStatus } = await import("./food-provider.server");
    try {
      return {
        food: await barcodeLookup(data.code),
        provider: providerStatus().fatsecret ? "fatsecret" : "usda_fdc",
      };
    } catch (e) {
      console.error(e);
      return { food: null, provider: "none", error: "Barcode lookup is temporarily unavailable." };
    }
  });

/** Deterministic nutrient calculation from a confirmed food + grams. */
export const logFood = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        food: foodSchema,
        grams: z.number().min(1).max(5000),
        meal_slot: slot,
        date: isoDate,
        method: z.enum(["search", "barcode", "recent", "manual", "text", "photo", "meal"]),
        clientOpId: z.string().min(8).max(80).optional(),
        clientRecordedAt: z.string().datetime().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.clientOpId) {
      const { data: prior } = await supabase
        .from("food_entries")
        .select("kcal,protein_g,carbs_g,fat_g,fibre_g")
        .eq("client_op_id", data.clientOpId)
        .maybeSingle();
      if (prior) return { ok: true, ...prior, duplicate: true };
    }
    const f = data.food;
    const ref = f.source_ref ?? `${f.source}:${f.name.toLowerCase()}:${f.brand ?? ""}`;
    const { data: food, error } = await supabase
      .from("user_foods")
      .upsert(
        { ...f, source_ref: ref, user_id: userId, last_used_at: new Date().toISOString() },
        { onConflict: "user_id,source,source_ref" },
      )
      .select("id")
      .single();
    if (error || !food) throw new Error("The food could not be saved.");
    const n = portion(f, data.grams);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: e2 } = await supabaseAdmin.from("food_entries").insert({
      user_id: userId,
      eaten_on: data.date,
      name: f.brand ? `${f.name} (${f.brand})` : f.name,
      grams: data.grams,
      meal_slot: data.meal_slot,
      kcal: n.kcal,
      protein_g: n.protein_g,
      carbs_g: n.carbs_g,
      fat_g: n.fat_g,
      fibre_g: n.fibre_g,
      source: `${f.source}:${data.method}`,
      food_id: food.id,
      estimated: f.source === "ai_estimate",
      client_op_id: data.clientOpId ?? null,
      client_recorded_at: data.clientRecordedAt ?? null,
    });
    if (e2?.code === "23505" && data.clientOpId) return { ok: true, ...n, duplicate: true };
    if (e2) throw new Error("The entry could not be saved.");
    return { ok: true, ...n };
  });

/** Copies logged entries from one day (optionally one meal) to another; nutrients are copied as computed, never re-estimated. */
export const copyFoodEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ from: isoDate, to: isoDate, meal_slot: slot.nullable() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("food_entries")
      .select("name,grams,meal_slot,kcal,protein_g,carbs_g,fat_g,fibre_g,source,food_id,estimated")
      .eq("eaten_on", data.from);
    if (data.meal_slot) q = q.eq("meal_slot", data.meal_slot);
    const { data: rows } = await q;
    if (!rows?.length) return { copied: 0 };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("food_entries").insert(
      rows.map((r) => ({
        ...r,
        user_id: userId,
        eaten_on: data.to,
        source: r.source.includes(":copy") ? r.source : `${r.source}:copy`,
      })),
    );
    if (error) throw new Error("The entries could not be copied.");
    return { copied: rows.length };
  });

export const logSavedMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        mealId: z.string().uuid(),
        servings: z.number().min(0.25).max(20),
        meal_slot: slot,
        date: isoDate,
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: meal } = await supabase
      .from("saved_meals")
      .select("*")
      .eq("id", data.mealId)
      .maybeSingle();
    if (!meal) throw new Error("Meal not found.");
    const items = z
      .array(z.object({ food_id: z.string().uuid(), grams: z.number().positive() }))
      .parse(meal.items);
    const { data: foods } = await supabase
      .from("user_foods")
      .select("*")
      .in(
        "id",
        items.map((x) => x.food_id),
      );
    const scale = data.servings / Number(meal.servings || 1);
    const rows = items.flatMap((it) => {
      const f = foods?.find((x) => x.id === it.food_id);
      if (!f) return [];
      const g = Math.round(it.grams * scale);
      const n = portion(
        {
          kcal_100g: Number(f.kcal_100g),
          protein_100g: Number(f.protein_100g),
          carbs_100g: Number(f.carbs_100g),
          fat_100g: Number(f.fat_100g),
          fibre_100g: f.fibre_100g == null ? null : Number(f.fibre_100g),
        },
        g,
      );
      return [
        {
          user_id: userId,
          eaten_on: data.date,
          name: `${f.name} · ${meal.name}`,
          grams: g,
          meal_slot: data.meal_slot,
          kcal: n.kcal,
          protein_g: n.protein_g,
          carbs_g: n.carbs_g,
          fat_g: n.fat_g,
          fibre_g: n.fibre_g,
          source: `${f.source}:meal`,
          food_id: f.id,
          estimated: f.source === "ai_estimate",
        },
      ];
    });
    if (!rows.length) throw new Error("This meal has no foods.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("food_entries").insert(rows);
    if (error) throw new Error("The meal could not be logged.");
    return { ok: true, items: rows.length };
  });

// ---------- AI-assisted logging (Pro/Execute). AI proposes; the user confirms; nutrients are calculated deterministically. ----------
const AI_MODEL = "openai/gpt-6-luna";

/** Free: one AI food log per local day, inside the Free AI token budget (§5.2). Paid: unrestricted by Free caps. */
async function requirePaid(supabase: { from: (t: "profiles") => any }, userId: string) {
  const tier = await (
    await import("./entitlements.server")
  ).requireAiFoodAllowance(supabase, userId);
  const budget = await import("./ai-budget.server");
  if (!(await budget.reserveFreeAiBudget(userId, tier, 3000, 600)))
    throw new Error(budget.AI_BUDGET_MESSAGE);
}

async function aiCandidates(
  content: unknown,
  uid: string | null = null,
  feature = "food_text",
): Promise<{ name: string; grams: number }[]> {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new Error("AI logging is not switched on.");
  const res = await (
    await import("./metered-ai.server")
  ).meteredAiFetch(uid, feature, "https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You identify foods and estimate portion weights for a nutrition logger. Return JSON {"items":[{"name":string,"grams":number}]} with at most 8 items. Use plain generic food names suitable for a food database search. Do not give nutrition values, advice or commentary. If the input is not food, return {"items":[]}.',
        },
        { role: "user", content },
      ],
    }),
  });
  if (res.status === 429) throw new Error("Too many requests right now. Try again in a minute.");
  if (res.status === 402) throw new Error("AI logging is temporarily unavailable.");
  if (!res.ok) {
    await (await import("./usage.server")).recordAiUsage(uid, feature, AI_MODEL, null, false);
    throw new Error("AI logging failed. You can still search manually.");
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  await (await import("./usage.server")).recordAiUsage(uid, feature, AI_MODEL, j);
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
  } catch {
    parsed = {};
  }
  const items = (parsed as { items?: unknown }).items;
  return Array.isArray(items)
    ? items
        .flatMap((x) => {
          const n = String((x as { name?: unknown }).name ?? "")
            .trim()
            .slice(0, 80);
          const g = Number((x as { grams?: unknown }).grams);
          return n && g > 0 ? [{ name: n, grams: Math.min(2000, Math.round(g)) }] : [];
        })
        .slice(0, 8)
    : [];
}

async function mapCandidates(cands: { name: string; grams: number }[]) {
  const { searchFoods } = await import("./food-provider.server");
  return Promise.all(
    cands.map(async (c) => {
      let options: Awaited<ReturnType<typeof searchFoods>>["foods"] = [];
      try {
        options = (await searchFoods(c.name)).foods.slice(0, 5);
      } catch {
        options = [];
      }
      return { query: c.name, grams_estimate: c.grams, options };
    }),
  );
}

/** Coach: parse what the member said they ate into provider foods (best match first). */
export async function parseFoodTextCore(text: string, userId: string) {
  return mapCandidates(await aiCandidates(text, userId, "food_text"));
}

export const parseFoodText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ text: z.string().trim().min(2).max(500) }).parse(i))
  .handler(async ({ data, context }) => {
    await requirePaid(context.supabase, context.userId);
    return {
      drafts: await mapCandidates(await aiCandidates(data.text, context.userId, "food_text")),
      estimated: true,
    };
  });

export const parseFoodPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        image: z
          .string()
          .regex(/^data:image\/(jpeg|png|webp);base64,/)
          .max(6_000_000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await requirePaid(context.supabase, context.userId);
    const sec = await import("./security");
    if (!sec.imageMatchesType(data.image)) throw new Error("That file isn't a supported photo.");
    if (!(await (await import("./flags.server")).flagOn("food_photo")))
      throw new Error("Photo recognition is paused for now. Please log this food by search.");
    if (!(await (await import("./security.server")).rateLimit("food_photo", context.userId)))
      throw new Error("Too many photos this hour. Try again later.");
    // Photo is processed in memory and never stored.
    const cands = await aiCandidates(
      [
        { type: "text", text: "List the visible foods and estimate each portion in grams." },
        { type: "image_url", image_url: { url: data.image } },
      ],
      context.userId,
      "food_photo",
    );
    return { drafts: await mapCandidates(cands), estimated: true };
  });

// ---------- Targets (initial + adaptive) ----------
export const refreshTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
    const [{ data: p }, { data: w }, { data: food }, { data: last }, { data: prog }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("sex,height_cm,date_of_birth,activity_level,nutrition_goal")
          .eq("id", userId)
          .single(),
        supabase
          .from("daily_logs")
          .select("log_date,value")
          .eq("kind", "weight")
          .gte("log_date", since)
          .order("log_date"),
        supabase.from("food_entries").select("eaten_on,kcal").gte("eaten_on", since),
        supabase
          .from("nutrition_targets")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("training_programmes")
          .select("goal")
          .eq("status", "active")
          .limit(1)
          .maybeSingle(),
      ]);
    if (!p) throw new Error("Profile not found.");
    const weights = (w ?? []).map((x) => ({ date: x.log_date, kg: Number(x.value) }));
    const byDay = new Map<string, number>();
    for (const f of food ?? [])
      byDay.set(f.eaten_on, (byDay.get(f.eaten_on) ?? 0) + Number(f.kcal));
    const intake = [...byDay.entries()].map(([date, kcal]) => ({ date, kcal }));
    const applied = (last ?? []).find((t) => t.status === "applied");
    const prevAdaptive = (last ?? []).find(
      (t) => t.method === "adaptive" && t.status === "applied",
    );
    // §62.3/§62.4: a safety note blocks calorie-deficit targets; maintenance is used instead.
    const deficitBlocked = (await (await import("./safety.server")).currentPolicy(userId))
      .blockCalorieDeficit;
    const adaptive = adaptiveTdee(intake, weights, prevAdaptive?.tdee ?? null);
    const t = computeTargets({
      sex: p.sex,
      height_cm: p.height_cm == null ? null : Number(p.height_cm),
      age: ageFrom(p.date_of_birth),
      weight_kg: weights.at(-1)?.kg ?? null,
      activity: p.activity_level,
      goal: deficitBlocked && p.nutrition_goal === "lose" ? "maintain" : p.nutrition_goal,
      training_focus: prog && prog.goal !== "general" ? "strength" : "general",
      tdee_override: adaptive.eligible ? adaptive.tdee : null,
    });
    const history = (last ?? []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      kcal: r.kcal,
      tdee: r.tdee,
      method: r.method,
      status: r.status,
      version: (r.inputs as { policy?: string } | null)?.policy ?? NUTRITION_POLICY_VERSION,
    }));
    const pending = (last ?? []).find((x) => x.status === "proposed") ?? null;
    if (t.status === "missing" || t.status === "blocked")
      return { targets: t, adaptive, current: applied ?? null, pending, history };
    const same =
      applied &&
      applied.kcal === t.kcal &&
      applied.protein_g === t.protein_g &&
      applied.fat_g === t.fat_g;
    if (same) return { targets: t, adaptive, current: applied, pending, history };
    // Adaptive re-estimates change targets at most once a week (V3 §48).
    const weekAgo = Date.now() - 7 * 864e5;
    if (
      adaptive.eligible &&
      applied &&
      applied.method === "adaptive" &&
      new Date(applied.created_at).getTime() > weekAgo
    ) {
      return {
        targets: t,
        adaptive,
        current: applied,
        pending,
        nextReviewAt: new Date(new Date(applied.created_at).getTime() + 7 * 864e5).toISOString(),
        history,
      };
    }
    const { data: permRows } = await supabase
      .from("auto_adapt_permissions")
      .select("permission,enabled");
    const { toMap } = await import("./auto-adapt");
    const autoOk = toMap(permRows).ADJUST_NUTRITION_TARGET_WITHIN_150_KCAL_WEEKLY;
    const needsApproval =
      !!applied &&
      adaptive.eligible &&
      (capTargetChange(applied.kcal, t.kcal).needsApproval || !autoOk);
    if (
      needsApproval &&
      pending &&
      pending.kcal === t.kcal &&
      pending.protein_g === t.protein_g &&
      pending.fat_g === t.fat_g
    )
      return { targets: t, adaptive, current: applied, pending, history };
    const db = await admin();
    if (needsApproval)
      await db
        .from("nutrition_targets")
        .update({ status: "superseded" })
        .eq("user_id", userId)
        .eq("status", "proposed");
    else
      await db
        .from("nutrition_targets")
        .update({ status: "superseded" })
        .eq("user_id", userId)
        .in("status", ["applied", "proposed"]);
    const { data: row } = await db
      .from("nutrition_targets")
      .insert({
        user_id: userId,
        kcal: t.kcal,
        protein_g: t.protein_g,
        carbs_g: t.carbs_g,
        fat_g: t.fat_g,
        tdee: t.tdee,
        method: adaptive.eligible ? "adaptive" : "initial_estimate",
        confidence: adaptive.eligible
          ? adaptive.confidence
          : t.status === "wide_estimate"
            ? "low"
            : "medium",
        status: needsApproval ? "proposed" : "applied",
        explanation: t.notes.join(" "),
        inputs: {
          policy: NUTRITION_POLICY_VERSION,
          weekly_change_pct: t.weekly_change_pct,
          trend_kg_per_week: adaptive.trend_kg_per_week,
          kcal_range: t.kcal_range ?? null,
          previous_kcal: applied?.kcal ?? null,
        },
      })
      .select("*")
      .single();
    if (!row) {
      // A concurrent refresh already saved this result (one applied and one proposed target per member); return what is stored.
      const { data: now } = await supabase
        .from("nutrition_targets")
        .select("*")
        .in("status", ["applied", "proposed"]);
      return {
        targets: t,
        adaptive,
        current: now?.find((x) => x.status === "applied") ?? applied ?? null,
        pending: now?.find((x) => x.status === "proposed") ?? null,
        history,
      };
    }
    if (row && !needsApproval) {
      const { recordTwinObservation } = await import("@/lib/twin.server");
      await recordTwinObservation(db, userId, {
        domain: "nutrition",
        fact_key: "estimated_tdee",
        value: t.tdee,
        source: "DERIVED",
        confidence: adaptive.eligible ? 0.85 : 0.6,
        source_ref: `nutrition_targets:${row.id}`,
      });
    }
    return {
      targets: t,
      adaptive,
      current: needsApproval ? applied : row,
      pending: needsApproval ? row : null,
      history,
    };
  });

export const approveTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), approve: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("nutrition_targets")
      .select("id,status")
      .eq("id", data.id)
      .maybeSingle();
    if (!row || row.status !== "proposed") throw new Error("This change is no longer pending.");
    const db = await admin();
    if (data.approve)
      await db
        .from("nutrition_targets")
        .update({ status: "superseded" })
        .eq("user_id", context.userId)
        .eq("status", "applied");
    await db
      .from("nutrition_targets")
      .update({ status: data.approve ? "applied" : "rejected" })
      .eq("id", row.id);
    await db.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "user",
      action: data.approve ? "nutrition.target_approved" : "nutrition.target_rejected",
      resource_type: "nutrition_target",
      resource_id: row.id,
      outcome: "succeeded",
      metadata: {},
    });
    return { ok: true };
  });
