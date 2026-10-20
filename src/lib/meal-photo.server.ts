// Photo meal estimation. The photo is analysed in memory and never stored; only the structured
// estimate is kept (meal_photo_estimates) until the member logs or cancels it. Logging goes only
// through the existing logFood path, with per-item idempotency keys.
import { normaliseEstimate, mealTotals, itemsToLog, type MealEstimate } from "./meal-photo";

export const MEAL_VISION_MODEL = "google/gemini-3.1-flash-lite";
const EST_IN = 2500;
const EST_OUT = 900;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "unclear_reason", "items", "questions", "summary"],
  properties: {
    status: { type: "string", enum: ["ok", "unclear"] },
    unclear_reason: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "preparation",
          "grams_low",
          "grams_high",
          "kcal_100g",
          "protein_100g",
          "carbs_100g",
          "fat_100g",
          "confidence",
        ],
        properties: {
          name: { type: "string" },
          preparation: { type: ["string", "null"] },
          grams_low: { type: "number" },
          grams_high: { type: "number" },
          kcal_100g: { type: "number" },
          protein_100g: { type: "number" },
          carbs_100g: { type: "number" },
          fat_100g: { type: "number" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "options"],
        properties: {
          text: { type: "string" },
          options: { type: "array", items: { type: "string" } },
        },
      },
    },
    summary: { type: "string" },
  },
};

const RULES = `You estimate a meal for a calorie counter. You give estimates, never exact measurements.
- List each visible food, sauce, topping, added fat and drink as its own item, with a plain generic name and likely preparation (e.g. "grilled", "fried").
- grams_low/grams_high: a realistic range for what is visible. Make the range wider when the angle, plate size or depth is unclear. Use equal low and high ONLY when the member stated the exact amount.
- Per-100 g values: typical values for that food as prepared (cooked weight). Use diet/zero values when the member says diet or zero drinks.
- Never invent hidden ingredients. If cooking oil or a sauce clearly matters but cannot be seen, add at most one question with short options, e.g. "How much oil was this cooked in?" with ["No added oil","1 teaspoon","1 tablespoon","More than 1 tablespoon"]. Ask at most 2 questions, and none if the estimate is already reasonable.
- If the photo is too dark, blurry, too far away, mostly obscured, not food, or impossible to identify reliably, return status "unclear" with a short unclear_reason and no items.
- summary: one short sentence of what you see. No health, medical or diet advice.`;

type Ctx = { supabase: any; userId: string };

async function vision(
  userId: string,
  content: unknown,
  feature: string,
  tier?: string,
): Promise<MealEstimate> {
  const key = (process.env["GEMINI_API_KEY"] || process.env["GEMINI_LIVE_API_KEY"]);
  if (!key)
    throw new Error("Photo estimates are not switched on. You can still log food by search.");
  const usage = await import("./usage.server");
  const res = await (
    await import("./metered-ai.server")
  ).meteredAiFetch(userId, feature, "https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MEAL_VISION_MODEL,
      messages: [
        { role: "system", content: RULES },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "meal_estimate", strict: true, schema: SCHEMA },
      },
    }),
  });
  if (!res.ok) {
    await usage.recordAiUsage(userId, feature, MEAL_VISION_MODEL, null, false);
    if (res.status === 429) throw new Error("Too many requests right now. Try again in a minute.");
    if (res.status === 402 || res.status === 403)
      throw new Error("Photo estimates are paused right now. You can still log food by search.");
    throw new Error("The photo couldn't be analysed. You can still log it by search or by hand.");
  }
  const j = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  await usage.recordAiUsage(userId, feature, MEAL_VISION_MODEL, j);
  await (
    await import("./ai-budget.server")
  ).settleAiUsage(userId, tier, EST_IN, EST_OUT, {
    input: j.usage?.prompt_tokens,
    output: j.usage?.completion_tokens,
  });
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
  } catch {
    parsed = { status: "unclear", unclear_reason: "The result couldn't be read." };
  }
  return Object.assign(normaliseEstimate(parsed), { __usage: j.usage ?? null });
}

async function gate(ctx: Ctx, photo: boolean) {
  // One photo counts as one AI food log; corrections to it don't use up the Free allowance.
  const tier = photo
    ? await (await import("./entitlements.server")).requireAiFoodAllowance(ctx.supabase, ctx.userId)
    : ((await ctx.supabase.from("profiles").select("tier").eq("id", ctx.userId).maybeSingle()).data
        ?.tier as string | undefined);
  const budget = await import("./ai-budget.server");
  if (!(await budget.reserveFreeAiBudget(ctx.userId, tier, EST_IN, EST_OUT)))
    throw new Error(budget.AI_BUDGET_MESSAGE);
  if (photo) {
    if (!(await (await import("./flags.server")).flagOn("food_photo")))
      throw new Error("Photo recognition is paused for now. Please log this food by search.");
    if (!(await (await import("./security.server")).rateLimit("food_photo", ctx.userId)))
      throw new Error("Too many photos this hour. Try again later.");
  }
  return tier;
}

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

function view(row: { id: string; status: string; estimate: unknown; corrections?: string[] }) {
  const estimate = normaliseEstimate(row.estimate);
  return {
    id: row.id,
    status: row.status,
    estimate,
    totals: mealTotals(estimate),
    corrections: row.corrections ?? [],
  };
}

export async function analyseMealPhoto(ctx: Ctx, image: string, note?: string | null) {
  const sec = await import("./security");
  if (!sec.imageMatchesType(image)) throw new Error("That file isn't a supported photo.");
  const tier = await gate(ctx, true);
  const est = await vision(
    ctx.userId,
    [
      {
        type: "text",
        text: `Estimate this meal.${note ? ` The member adds: ${note.slice(0, 300)}` : ""}`,
      },
      { type: "image_url", image_url: { url: image } },
    ],
    "food_photo",
    tier,
  );
  const { __usage: _u, ...estimate } = est as MealEstimate & { __usage?: unknown };
  const { data, error } = await (
    await admin()
  )
    .from("meal_photo_estimates")
    .insert({ user_id: ctx.userId, estimate: estimate as never })
    .select("id,status,estimate,corrections")
    .single();
  if (error || !data) throw new Error("The estimate couldn't be saved. Please try again.");
  return view(data);
}

async function own(id: string, userId: string) {
  const { data } = await (
    await admin()
  )
    .from("meal_photo_estimates")
    .select("id,status,estimate,corrections,user_id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("That meal estimate no longer exists.");
  return data;
}

/** Natural-language correction ("that was 250 g chicken", "no oil"). Recomputes the whole estimate. */
export async function correctMealEstimate(ctx: Ctx, id: string, correction: string) {
  const row = await own(id, ctx.userId);
  if (row.status !== "pending") return { ...view(row), already: row.status };
  const policy = await (
    await import("./safety.server")
  ).screenText(ctx.userId, "nutrition", correction);
  if (policy.stopOrdinaryCoaching)
    throw new Error(
      "I can't adjust this estimate. Please talk to someone you trust or a professional if you're struggling.",
    );
  const tier = await gate(ctx, false);
  const est = await vision(
    ctx.userId,
    `Current estimate (JSON): ${JSON.stringify(row.estimate)}\nThe member corrects it: "${correction.slice(0, 400)}"\nReturn the full updated estimate. Apply the correction exactly (stated grams become equal low and high; replaced foods change their per-100 g values; removed items are dropped). Keep everything else. Drop any question the correction answers.`,
    "food_photo_correction",
    tier,
  );
  const { __usage: _u, ...estimate } = est as MealEstimate & { __usage?: unknown };
  if (estimate.status === "unclear")
    return {
      ...view(row),
      note: 'I couldn\'t apply that. Try saying it another way, e.g. "the rice was 150 g".',
    };
  const { data } = await (
    await admin()
  )
    .from("meal_photo_estimates")
    .update({
      estimate: estimate as never,
      corrections: [...(row.corrections ?? []), correction.slice(0, 400)],
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id,status,estimate,corrections")
    .single();
  return view(data ?? row);
}

export async function cancelMealEstimate(ctx: Ctx, id: string) {
  const row = await own(id, ctx.userId);
  if (row.status === "logged") return { status: "logged" as const };
  await (
    await admin()
  )
    .from("meal_photo_estimates")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  return { status: "cancelled" as const };
}

/** Logs every item through logFood with a stable per-item key, so double taps, retries and repeats never duplicate. */
export async function logMealEstimate(ctx: Ctx, id: string, mealSlot: string, date: string) {
  const row = await own(id, ctx.userId);
  if (row.status === "logged") return { already_logged: true as const, ...view(row) };
  if (row.status === "cancelled")
    throw new Error("That estimate was cancelled. Take a new photo to log it.");
  const est = normaliseEstimate(row.estimate);
  if (est.status !== "ok" || !est.items.length)
    throw new Error("There's nothing to log from that photo.");
  const { logFood } = await import("./nutrition.functions");
  for (const [i, it] of itemsToLog(est).entries())
    await logFood({
      data: {
        ...it,
        meal_slot: mealSlot as never,
        date,
        method: "photo",
        clientOpId: `mealphoto:${id}:${i}`,
      },
    });
  await (
    await admin()
  )
    .from("meal_photo_estimates")
    .update({
      status: "logged",
      meal_slot: mealSlot,
      eaten_on: date,
      logged_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  return { already_logged: false as const, ...view({ ...row, status: "logged" }) };
}

export async function latestMealEstimate(ctx: Ctx) {
  const { data } = await (
    await admin()
  )
    .from("meal_photo_estimates")
    .select("id,status,estimate,corrections")
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? view(data) : null;
}
