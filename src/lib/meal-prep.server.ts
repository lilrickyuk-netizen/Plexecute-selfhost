// One meal-prep service for the Nutrition screen and the Coach. Inventory, plan building, edits,
// acceptance and planned-meal logging all live here; the calorie counter (food_entries) stays the
// only record of what was eaten.
import {
  MEAL_PREP_POLICY,
  FOOD,
  addDays,
  applyEdit,
  buildPrepPlan,
  dayStatus,
  matchFood,
  needsQuantity,
  parseInventoryText,
  prepSessions,
  shoppingList,
  mealTotals,
  type InventoryItem,
  type PlanEdit,
  type PrepContext,
  type PrepPlan,
  type Slot,
} from "./meal-prep";
import { localDayKey, weekKeyOf } from "./tz";

export type Ctx = { supabase: any; userId: string };
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

async function audit(
  ctx: Ctx,
  action: string,
  id: string | null,
  metadata: Record<string, unknown>,
  actor: "user" | "coach" = "user",
) {
  await (await admin()).from("audit_events").insert({
    user_id: ctx.userId,
    actor_type: actor === "coach" ? "assistant" : "user",
    action,
    resource_type: "meal_plan",
    resource_id: id,
    outcome: "succeeded",
    metadata: metadata as never,
  });
}

type Row = {
  id: string;
  name: string;
  food_key: string | null;
  grams: number | null;
  item_count: number | null;
  unit: string;
  quantity_status: string;
  source: string;
  per100: unknown;
  nutrition_source: string;
  expires_on: string | null;
  allergens: string[];
  confirmed_at: string | null;
};
export const toItem = (
  r: Row,
): InventoryItem & { id: string; confirmed: boolean; nutrition_source: string } => ({
  id: r.id,
  name: r.name,
  food_key: r.food_key,
  grams: r.grams == null ? null : Number(r.grams),
  count: r.item_count == null ? null : Number(r.item_count),
  unit: r.unit,
  quantity_status: r.quantity_status as never,
  source: r.source as never,
  per100: (r.per100 as never) ?? null,
  nutrition_source: r.nutrition_source,
  expires_on: r.expires_on,
  allergens: r.allergens ?? [],
  confirmed: !!r.confirmed_at,
});

export async function listInventory(ctx: Ctx) {
  const { data } = await (
    await admin()
  )
    .from("food_inventory")
    .select("*")
    .eq("user_id", ctx.userId)
    .eq("status", "active")
    .order("created_at");
  const items = ((data ?? []) as Row[]).map(toItem);
  return {
    items,
    needsQuantity: needsQuantity(items).map((i) => ({
      id: (i as { id: string }).id,
      name: i.name,
    })),
    confirmed: items.length > 0 && items.every((i) => i.confirmed),
  };
}

/** Adds parsed items to the one inventory. Same import key = same import (double taps, retries, Coach replays). */
export async function addInventory(ctx: Ctx, items: InventoryItem[], importKey: string) {
  const db = await admin();
  const { data: prior } = await db
    .from("food_inventory")
    .select("id")
    .eq("user_id", ctx.userId)
    .eq("import_key", importKey)
    .limit(1);
  if (prior?.length) return { duplicate: true, ...(await listInventory(ctx)) };
  const { items: current } = await listInventory(ctx);
  for (const it of items.slice(0, 40)) {
    const same = it.food_key
      ? current.find((c) => c.food_key === it.food_key)
      : current.find((c) => c.name.toLowerCase() === it.name.toLowerCase());
    if (same) {
      // Adding more of something already listed tops it up instead of creating a duplicate row.
      const grams =
        same.grams != null && it.grams != null ? same.grams + it.grams : (it.grams ?? same.grams);
      const status =
        it.grams != null
          ? same.quantity_status === "confirmed" && it.quantity_status === "confirmed"
            ? "confirmed"
            : it.quantity_status
          : same.quantity_status;
      await db
        .from("food_inventory")
        .update({
          grams,
          quantity_status: status,
          confirmed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", same.id);
      continue;
    }
    let per100 = it.per100 ?? null;
    let nutrition_source = "generic reference values (estimate)";
    if (!it.food_key) {
      try {
        const f = (await (await import("./food-provider.server")).searchFoods(it.name)).foods[0];
        if (f) {
          per100 = { kcal: f.kcal_100g, p: f.protein_100g, c: f.carbs_100g, f: f.fat_100g };
          nutrition_source = f.attribution;
        }
      } catch {
        /* provider not switched on: item stays without nutrition and is listed, not planned */
      }
    }
    await db.from("food_inventory").insert({
      user_id: ctx.userId,
      name: it.name.slice(0, 80),
      food_key: it.food_key,
      grams: it.grams,
      item_count: it.count,
      unit: it.unit,
      quantity_status: it.quantity_status,
      source: it.source,
      per100: per100 as never,
      nutrition_source,
      expires_on: it.expires_on ?? null,
      allergens: it.allergens ?? FOOD[it.food_key ?? ""]?.allergens ?? [],
      import_key: importKey,
    });
  }
  return { duplicate: false, ...(await listInventory(ctx)) };
}

export async function addInventoryText(
  ctx: Ctx,
  text: string,
  source: InventoryItem["source"],
  importKey: string,
) {
  const items = parseInventoryText(text, source);
  if (!items.length)
    throw new Error(
      "No foods found in that. Try a list like “6 chicken breasts, 1 kg rice, 12 eggs”.",
    );
  return { parsed: items.map((i) => i.name), ...(await addInventory(ctx, items, importKey)) };
}

export async function updateInventoryItem(
  ctx: Ctx,
  id: string,
  patch: {
    name?: string;
    grams?: number | null;
    as_needed?: boolean;
    expires_on?: string | null;
    remove?: boolean;
  },
) {
  const db = await admin();
  const { data: row } = await db
    .from("food_inventory")
    .select("id")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!row) throw new Error("That food isn't in your list.");
  const upd: Record<string, never> = {
    updated_at: new Date().toISOString() as never,
    confirmed_at: null as never,
  };
  if (patch.remove) upd["status"] = "removed" as never;
  if (patch.name) {
    const f = matchFood(patch.name);
    upd["name"] = (f?.name ?? patch.name.slice(0, 80)) as never;
    upd["food_key"] = (f?.key ?? null) as never;
    upd["allergens"] = (f?.allergens ?? []) as never;
  }
  if (patch.grams !== undefined) {
    upd["grams"] = patch.grams as never;
    upd["quantity_status"] = (patch.grams == null ? "unknown" : "confirmed") as never;
    upd["unit"] = "g" as never;
  }
  if (patch.as_needed) upd["quantity_status"] = "as_needed" as never;
  if (patch.expires_on !== undefined) upd["expires_on"] = patch.expires_on as never;
  await db.from("food_inventory").update(upd).eq("id", id);
  return listInventory(ctx);
}

/** Member confirms the list. Unknown amounts must be filled in or explicitly marked "use as needed". */
export async function confirmInventory(ctx: Ctx, unknown: "as_needed" | "block" = "block") {
  const db = await admin();
  const inv = await listInventory(ctx);
  if (!inv.items.length) throw new Error("Add the food you have first.");
  if (inv.needsQuantity.length && unknown === "block")
    return {
      confirmed: false,
      needsQuantity: inv.needsQuantity,
      message: `How much ${inv.needsQuantity.map((n) => n.name.toLowerCase()).join(", ")} do you have? Or say “use as needed”.`,
    };
  if (unknown === "as_needed")
    await db
      .from("food_inventory")
      .update({ quantity_status: "as_needed" })
      .eq("user_id", ctx.userId)
      .eq("status", "active")
      .eq("quantity_status", "unknown");
  await db
    .from("food_inventory")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("user_id", ctx.userId)
    .eq("status", "active");
  return { ...(await listInventory(ctx)), confirmed: true };
}

export async function clearInventory(ctx: Ctx) {
  await (
    await admin()
  )
    .from("food_inventory")
    .update({ status: "removed" })
    .eq("user_id", ctx.userId)
    .eq("status", "active");
  return listInventory(ctx);
}

// ---------- Photo of groceries ----------
const GROCERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "note"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "count", "grams", "quantity_basis"],
        properties: {
          name: { type: "string" },
          count: { type: ["number", "null"] },
          grams: { type: ["number", "null"] },
          quantity_basis: { type: "string", enum: ["label", "counted", "not_visible"] },
        },
      },
    },
    note: { type: "string" },
  },
};
const GROCERY_RULES = `You list groceries visible in a photo of shopping, a fridge or a cupboard for a meal planner.
- One item per distinct food, plain generic names (e.g. "chicken breasts", "Greek yoghurt", "basmati rice").
- count: only when individual items can be clearly counted (eggs in an open box, loose peppers); otherwise null.
- grams: only when a pack label with the weight is readable; otherwise null. Never guess weights.
- quantity_basis: "label", "counted" or "not_visible".
- Do not list items you cannot identify. note: one short sentence naming what you could not tell (e.g. the amount of rice).`;

export async function addInventoryPhoto(ctx: Ctx, image: string, importKey: string) {
  const sec = await import("./security");
  if (!sec.imageMatchesType(image)) throw new Error("That file isn't a supported photo.");
  const tier = await (
    await import("./entitlements.server")
  ).requireAiFoodAllowance(ctx.supabase, ctx.userId);
  if (!(await (await import("./flags.server")).flagOn("food_photo")))
    throw new Error("Photo recognition is paused for now. Type or say your foods instead.");
  if (!(await (await import("./security.server")).rateLimit("food_photo", ctx.userId)))
    throw new Error("Too many photos this hour. Try again later.");
  const budget = await import("./ai-budget.server");
  if (!(await budget.reserveFreeAiBudget(ctx.userId, tier, 2500, 700)))
    throw new Error(budget.AI_BUDGET_MESSAGE);
  const key = (process.env["GEMINI_API_KEY"] || process.env["GEMINI_LIVE_API_KEY"]);
  if (!key)
    throw new Error("Photo recognition is not switched on. Type or say your foods instead.");
  const { MEAL_VISION_MODEL } = await import("./meal-photo.server");
  const usage = await import("./usage.server");
  // The photo is analysed in memory and never stored.
  const res = await (
    await import("./metered-ai.server")
  ).meteredAiFetch(ctx.userId, "food_photo", "https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MEAL_VISION_MODEL,
      messages: [
        { role: "system", content: GROCERY_RULES },
        {
          role: "user",
          content: [
            { type: "text", text: "List the foods in this photo." },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "grocery_list", strict: true, schema: GROCERY_SCHEMA },
      },
    }),
  });
  if (!res.ok) {
    await usage.recordAiUsage(ctx.userId, "food_inventory_photo", MEAL_VISION_MODEL, null, false);
    if (res.status === 429) throw new Error("Too many requests right now. Try again in a minute.");
    throw new Error("The photo couldn't be read. Type or say your foods instead.");
  }
  const j = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  await usage.recordAiUsage(ctx.userId, "food_photo", MEAL_VISION_MODEL, j);
  await budget.settleAiUsage(ctx.userId, tier, 2500, 700, {
    input: j.usage?.prompt_tokens,
    output: j.usage?.completion_tokens,
  });
  let parsed: {
    items?: { name: string; count: number | null; grams: number | null; quantity_basis: string }[];
    note?: string;
  } = {};
  try {
    parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
  } catch {
    parsed = {};
  }
  const items: InventoryItem[] = (parsed.items ?? []).slice(0, 25).flatMap((x) => {
    const name = String(x.name ?? "")
      .trim()
      .slice(0, 60);
    if (!name) return [];
    const f = matchFood(name);
    const grams =
      x.quantity_basis === "label" && x.grams && x.grams > 0
        ? Math.round(x.grams)
        : x.quantity_basis === "counted" && x.count && f
          ? Math.round(x.count * f.unit.grams)
          : null;
    return [
      {
        name: f?.name ?? name,
        food_key: f?.key ?? null,
        grams,
        count: x.quantity_basis === "counted" ? x.count : null,
        unit: f?.unit.label ?? "item",
        quantity_status: grams == null ? "unknown" : "estimated",
        source: "photo",
        allergens: f?.allergens ?? [],
      } as InventoryItem,
    ];
  });
  if (!items.length)
    throw new Error(
      parsed.note ||
        "No foods could be identified in that photo. Try a clearer photo, or type them.",
    );
  return {
    seen: items.map((i) => i.name),
    note: parsed.note ?? "",
    ...(await addInventory(ctx, items, importKey)),
  };
}

// ---------- Plans ----------
export type BuildOpts = {
  start?: string | null;
  days?: number;
  onlyExisting?: boolean;
  allowStaples?: boolean;
  kcal?: number | null;
  protein_g?: number | null;
  prepWeekday?: number | null;
  secondPrep?: boolean | null;
  slots?: Slot[] | null;
  actor?: "user" | "coach";
};

async function targetsFor(ctx: Ctx) {
  const { data } = await ctx.supabase
    .from("nutrition_targets")
    .select("kcal,protein_g,carbs_g,fat_g")
    .eq("status", "applied")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { kcal: number; protein_g: number; carbs_g: number; fat_g: number } | null;
}

export async function buildPlan(ctx: Ctx, o: BuildOpts) {
  const inv = await listInventory(ctx);
  // Empty inventory: plan from everyday staples; everything goes on the shopping list.
  if (inv.items.length && !inv.confirmed) {
    const c = await confirmInventory(ctx, "block");
    if (!c.confirmed) return { needsQuantity: c.needsQuantity, message: c.message };
  }
  if (!inv.items.length && o.onlyExisting)
    throw new Error("Tell Plexecute what food you have first (photo, typing or voice).");
  const { data: prof } = await ctx.supabase
    .from("profiles")
    .select("timezone,allergies,diet_type,work_days,work_start,work_end")
    .maybeSingle();
  const tz = prof?.timezone ?? "UTC";
  const today = localDayKey(new Date(), tz);
  const start =
    o.start && /^\d{4}-\d{2}-\d{2}$/.test(o.start)
      ? o.start
      : addDays(weekKeyOf(new Date(), tz), 7);
  if (start < today) throw new Error("Plans start today or later.");
  const days = Math.max(1, Math.min(7, Math.round(o.days ?? 7)));
  const { data: pref } = await (
    await admin()
  )
    .from("meal_prep_preferences")
    .select("*")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  const saved = await targetsFor(ctx);
  let targets = saved ?? { kcal: 2000, protein_g: 100, carbs_g: 250, fat_g: 70 };
  let targetsSource: PrepContext["targetsSource"] = saved ? "your daily targets" : "default";
  if (o.kcal || o.protein_g) {
    const kcal = o.kcal ?? targets.kcal;
    if (kcal < 1200)
      throw new Error(
        "Plexecute doesn't plan meals below 1,200 kcal a day. Please speak to a GP or dietitian about very low-calorie eating.",
      );
    if (kcal < targets.kcal) {
      const stop = await (
        await import("./safety.server")
      ).guardMutation(ctx.userId, "calorie_deficit");
      if (stop) throw new Error(stop);
    }
    targets = { ...targets, kcal, protein_g: o.protein_g ?? targets.protein_g };
    targetsSource = "plan targets you asked for";
  }
  const prepWeekday = o.prepWeekday ?? pref?.prep_weekday ?? 0;
  // Main prep: the chosen weekday on or before the first day (never in the past).
  let prepDay = start;
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, -i);
    if (new Date(`${d}T12:00:00Z`).getUTCDay() === prepWeekday) {
      prepDay = d;
      break;
    }
  }
  if (prepDay < today) prepDay = today;
  const dates = Array.from({ length: days }, (_, i) => addDays(start, i));
  const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
  const work = (prof?.work_days ?? []) as number[];
  const isWork = (d: string) => work.includes(dow(d)) || work.includes(dow(d) === 0 ? 7 : dow(d));
  const quick = dates.filter(
    (d) =>
      isWork(d) && (pref?.quick_breakfasts || (prof?.work_start && prof.work_start <= "07:30")),
  );
  const busy = dates.filter((d) => isWork(d) && prof?.work_end && prof.work_end >= "18:30");
  const { data: wb } = await ctx.supabase
    .from("plan_blocks")
    .select("starts_at")
    .eq("occurrence_kind", "workout")
    .gte("starts_at", `${start}T00:00:00Z`)
    .lte("starts_at", `${dates.at(-1)}T23:59:59Z`)
    .neq("status", "skipped");
  const training = [
    ...new Set((wb ?? []).map((b: { starts_at: string }) => localDayKey(b.starts_at, tz))),
  ] as string[];
  const ctxP: PrepContext = {
    startDate: start,
    days,
    targets,
    targetsSource,
    slots: o.slots?.length
      ? o.slots
      : ((pref?.meals_per_day as Slot[] | undefined) ?? ["breakfast", "lunch", "dinner", "snack"]),
    allergies: prof?.allergies ?? [],
    diet: prof?.diet_type ?? null,
    dislikes: pref?.dislikes ?? [],
    onlyExisting: !!o.onlyExisting,
    allowStaples: o.allowStaples ?? true,
    prepDay,
    secondPrep: o.secondPrep ?? pref?.second_prep ?? true,
    quickBreakfastDates: quick,
    busyEveningDates: busy,
    trainingDates: training,
  };
  const plan = buildPrepPlan(ctxP, inv.items);
  const db = await admin();
  // Double taps / retries: an identical proposal from the last 30 s is returned instead of a new one.
  const { data: recent } = await db
    .from("meal_plans")
    .select("*")
    .eq("user_id", ctx.userId)
    .eq("policy_version", MEAL_PREP_POLICY)
    .eq("status", "proposed")
    .eq("week_start", start)
    .gte("created_at", new Date(Date.now() - 30_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (recent?.[0] && JSON.stringify((recent[0].plan as PrepPlan).context) === JSON.stringify(ctxP))
    return view(recent[0], inv.items);
  await db
    .from("meal_plans")
    .update({ status: "superseded" })
    .eq("user_id", ctx.userId)
    .eq("policy_version", MEAL_PREP_POLICY)
    .eq("status", "proposed");
  const sessions = prepSessions(plan);
  const { data: row, error } = await db
    .from("meal_plans")
    .insert({
      user_id: ctx.userId,
      week_start: start,
      household: 1,
      prep_minutes: sessions.reduce((a, s) => a + s.minutes, 0),
      plan: plan as never,
      policy_version: MEAL_PREP_POLICY,
      status: "proposed",
    })
    .select("*")
    .single();
  if (error || !row) throw new Error("The meal plan couldn't be saved.");
  await audit(
    ctx,
    "meal_prep.proposed",
    row.id,
    { start, days, onlyExisting: ctxP.onlyExisting, targetsSource },
    o.actor,
  );
  return view(row, inv.items);
}

type PlanRow = {
  id: string;
  status: string;
  plan: unknown;
  week_start: string;
  prep_minutes: number;
  created_at?: string;
};
function view(row: PlanRow, inventory: InventoryItem[]) {
  const plan = row.plan as PrepPlan;
  return {
    id: row.id,
    status: row.status,
    plan,
    shopping: shoppingList(plan, inventory),
    prep: prepSessions(plan),
  };
}

/** The accepted plan covering a date, else the newest proposal. */
export async function currentPlan(ctx: Ctx, date?: string) {
  const db = await admin();
  const { data } = await db
    .from("meal_plans")
    .select("id,status,plan,week_start,prep_minutes,created_at")
    .eq("user_id", ctx.userId)
    .eq("policy_version", MEAL_PREP_POLICY)
    .in("status", ["proposed", "approved"])
    .order("created_at", { ascending: false })
    .limit(10);
  const rows = (data ?? []) as PlanRow[];
  const covers = (r: PlanRow) => !date || (r.plan as PrepPlan).days.some((d) => d.date === date);
  const pick =
    rows.find((r) => r.status === "approved" && covers(r)) ??
    rows.find((r) => r.status === "proposed") ??
    rows.find((r) => r.status === "approved");
  if (!pick) return null;
  return view(pick, (await listInventory(ctx)).items);
}

async function ownPlan(ctx: Ctx, id: string) {
  const { data } = await (
    await admin()
  )
    .from("meal_plans")
    .select("id,status,plan,week_start,prep_minutes")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .eq("policy_version", MEAL_PREP_POLICY)
    .maybeSingle();
  if (!data || !["proposed", "approved"].includes(data.status))
    throw new Error("That meal plan isn't active any more.");
  return data as PlanRow;
}

export async function editPlan(
  ctx: Ctx,
  id: string,
  edit: PlanEdit,
  actor: "user" | "coach" = "user",
) {
  const row = await ownPlan(ctx, id);
  const inv = (await listInventory(ctx)).items;
  const { plan, changed } = applyEdit(row.plan as PrepPlan, inv, edit);
  await (
    await admin()
  )
    .from("meal_plans")
    .update({
      plan: plan as never,
      prep_minutes: prepSessions(plan).reduce((a, s) => a + s.minutes, 0),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  await audit(ctx, "meal_prep.edited", id, { edit, changed }, actor);
  return { changed, ...view({ ...row, plan }, inv) };
}

export async function acceptPlan(
  ctx: Ctx,
  id: string,
  actor: "user" | "coach" = "user",
  opts: { prepSessions?: boolean } = {},
) {
  const row = await ownPlan(ctx, id);
  if (row.status === "approved")
    return { already: true, ...view(row, (await listInventory(ctx)).items) };
  const db = await admin();
  const plan = row.plan as PrepPlan;
  const dates = plan.days.map((d) => d.date);
  const { data: others } = await db
    .from("meal_plans")
    .select("id,plan")
    .eq("user_id", ctx.userId)
    .eq("policy_version", MEAL_PREP_POLICY)
    .eq("status", "approved");
  // A newer accepted plan replaces older ones for overlapping days ("redo from Wednesday").
  for (const o of others ?? [])
    if ((o.plan as PrepPlan).days.some((d) => dates.includes(d.date)))
      await db.from("meal_plans").update({ status: "superseded" }).eq("id", o.id);
  await db.from("meal_plans").update({ status: "approved" }).eq("id", id);
  // Batch prep becomes a planner goal so the whole-life scheduler places it (same as the saved-meal planner).
  const minutes = prepSessions(plan).reduce((a, s) => a + s.minutes, 0);
  // Coach only adds batch-prep sessions when the member asked for them; an existing prep goal is still kept up to date.
  const wantPrep = opts.prepSessions !== false;
  const goal = {
    title: "Weekly meal prep",
    domain: "meal_prep",
    weekly_minutes: minutes,
    minimum_weekly_minutes: minutes,
    session_minutes: Math.max(30, Math.round(minutes / Math.max(1, prepSessions(plan).length))),
    preferred_time: "evening",
    status: minutes > 0 ? "active" : "paused",
  };
  const { data: g } = await ctx.supabase
    .from("goals")
    .select("id")
    .eq("domain", "meal_prep")
    .eq("title", "Weekly meal prep")
    .maybeSingle();
  if (g) await ctx.supabase.from("goals").update(goal).eq("id", g.id);
  else if (minutes > 0 && wantPrep)
    await ctx.supabase.from("goals").insert({
      ...goal,
      user_id: ctx.userId,
      priority: 3,
      why: "Batch cooking from your weekly meal plan.",
    });
  await audit(ctx, "meal_prep.accepted", id, { dates: [dates[0], dates.at(-1)] }, actor);
  return {
    already: false,
    ...view({ ...row, status: "approved" }, (await listInventory(ctx)).items),
  };
}

/** Planned → eaten through the calorie counter. One tap logs it as planned; a factor or photo records the real amount. */
export async function logPlannedMeal(
  ctx: Ctx,
  id: string,
  date: string,
  slot: Slot,
  o: { factor?: number; photoEstimateId?: string | null; actor?: "user" | "coach" } = {},
) {
  const row = await ownPlan(ctx, id);
  if (row.status !== "approved")
    throw new Error("Accept the plan first; then meals can be logged from it.");
  const plan = row.plan as PrepPlan;
  const day = plan.days.find((d) => d.date === date);
  const meal = day?.meals.find((m) => m.slot === slot);
  if (!day || !meal) throw new Error("That meal isn't in your plan.");
  if (meal.state === "eaten") return { already_logged: true, actual: meal.actual };
  let actual;
  if (o.photoEstimateId) {
    const mp = await import("./meal-photo.server");
    const r = await mp.logMealEstimate(ctx, o.photoEstimateId, slot, date);
    actual = {
      kcal: Math.round(r.totals.kcal.best ?? 0),
      protein_g: Math.round(r.totals.protein_g?.best ?? 0),
      carbs_g: Math.round(r.totals.carbs_g?.best ?? 0),
      fat_g: Math.round(r.totals.fat_g?.best ?? 0),
    };
  } else {
    const factor = Math.max(0.25, Math.min(3, o.factor ?? 1));
    const ings = meal.ingredients.map((i) => ({ ...i, grams: Math.round(i.grams * factor) }));
    const rows = ings.map((i, n) => {
      const t = mealTotals([i]);
      return {
        user_id: ctx.userId,
        eaten_on: date,
        name: `${i.name} · ${meal.name}`,
        grams: i.grams,
        meal_slot: slot,
        kcal: t.kcal,
        protein_g: t.protein_g,
        carbs_g: t.carbs_g,
        fat_g: t.fat_g,
        fibre_g: null,
        source: "mealprep:meal",
        estimated: true,
        client_op_id: `mealprep:${id}:${date}:${slot}:${n}`,
      };
    });
    const db = await admin();
    for (const r of rows) {
      const { error } = await db.from("food_entries").insert(r);
      if (error && error.code !== "23505") throw new Error("The meal couldn't be logged.");
    }
    actual = mealTotals(ings);
  }
  meal.state = "eaten";
  meal.actual = actual;
  await (
    await admin()
  )
    .from("meal_plans")
    .update({ plan: plan as never })
    .eq("id", id);
  await audit(
    ctx,
    "meal_prep.meal_logged",
    id,
    { date, slot, actual, photo: !!o.photoEstimateId },
    o.actor,
  );
  return { already_logged: false, actual };
}

export async function skipPlannedMeal(ctx: Ctx, id: string, date: string, slot: Slot) {
  const row = await ownPlan(ctx, id);
  const plan = row.plan as PrepPlan;
  const meal = plan.days.find((d) => d.date === date)?.meals.find((m) => m.slot === slot);
  if (!meal) throw new Error("That meal isn't in your plan.");
  if (meal.state === "eaten") throw new Error("That meal is already logged as eaten.");
  meal.state = "skipped";
  await (
    await admin()
  )
    .from("meal_plans")
    .update({ plan: plan as never })
    .eq("id", id);
  return { ok: true };
}

/** Consumed (calorie counter), target, remaining and what's still planned for a day. */
export async function nutritionStatus(ctx: Ctx, date?: string) {
  const { data: prof } = await ctx.supabase.from("profiles").select("timezone").maybeSingle();
  const day = date ?? localDayKey(new Date(), prof?.timezone ?? "UTC");
  const [{ data: entries }, target, plan] = await Promise.all([
    ctx.supabase.from("food_entries").select("kcal,protein_g,carbs_g,fat_g").eq("eaten_on", day),
    targetsFor(ctx),
    currentPlan(ctx, day),
  ]);
  const plannedDay =
    plan?.status === "approved" ? plan.plan.days.find((d) => d.date === day) : undefined;
  return {
    date: day,
    ...dayStatus(entries ?? [], target, plannedDay),
    planId: plan?.status === "approved" ? plan.id : null,
    plannedDay: plannedDay ?? null,
  };
}

export async function setPreferences(
  ctx: Ctx,
  p: {
    dislikes?: string[];
    prep_weekday?: number;
    second_prep?: boolean;
    quick_breakfasts?: boolean;
    meals_per_day?: Slot[];
  },
) {
  const db = await admin();
  const { data: cur } = await db
    .from("meal_prep_preferences")
    .select("*")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  const next = {
    user_id: ctx.userId,
    dislikes: p.dislikes ?? cur?.dislikes ?? [],
    prep_weekday: p.prep_weekday ?? cur?.prep_weekday ?? 0,
    second_prep: p.second_prep ?? cur?.second_prep ?? true,
    quick_breakfasts: p.quick_breakfasts ?? cur?.quick_breakfasts ?? false,
    meals_per_day: p.meals_per_day ??
      cur?.meals_per_day ?? ["breakfast", "lunch", "dinner", "snack"],
    updated_at: new Date().toISOString(),
  };
  await db.from("meal_prep_preferences").upsert(next);
  return next;
}

/** Full recipe for a planned meal, cooked only from the ingredients the plan already chose. Not stored. */
export async function mealRecipe(
  ctx: Ctx,
  meal: {
    name: string;
    ingredients: { name: string; grams: number; count?: number | null | undefined }[];
    minutes: number;
    kcal: number;
  },
) {
  const { data: prof } = await ctx.supabase
    .from("profiles")
    .select("tier,allergies,diet_type")
    .maybeSingle();
  if (!(await (await import("./flags.server")).flagOn("ai_assist")))
    throw new Error((await import("./flags")).PAUSED_AI);
  if (!(await (await import("./security.server")).rateLimit("meal_recipe", ctx.userId)))
    throw new Error("Too many recipes this hour. Try again later.");
  const budget = await import("./ai-budget.server");
  if (!(await budget.reserveFreeAiBudget(ctx.userId, prof?.tier, 1200, 900)))
    throw new Error(budget.AI_BUDGET_MESSAGE);
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new Error("Recipes are not switched on.");
  const model = "openai/gpt-6-luna";
  const usage = await import("./usage.server");
  const res = await (
    await import("./metered-ai.server")
  ).meteredAiFetch(
    ctx.userId,
    "meal_recipe",
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "recipe",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["steps", "tips"],
              properties: {
                steps: { type: "array", items: { type: "string" } },
                tips: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
        messages: [
          {
            role: "system",
            content:
              "You write clear home-cooking recipes in UK English. Use ONLY the listed ingredients and amounts, plus water, salt, pepper and cooking oil. Never add other foods. Give 4-10 numbered-style steps (no numbers in the text), each one short sentence with times and heat levels; include safe cooking guidance for meat, fish and eggs (cook until piping hot). Tips: up to 3 short tips on batch storage or swaps that keep to the same ingredients. Respect the allergies and diet given.",
          },
          {
            role: "user",
            content: `Meal: ${meal.name}\nAbout ${meal.minutes} minutes, ${meal.kcal} kcal.\nIngredients:\n${meal.ingredients.map((i) => `- ${i.name}: ${i.count ? `${i.count} (${i.grams} g)` : `${i.grams} g`}`).join("\n")}\nAllergies: ${(prof?.allergies ?? []).join(", ") || "none"}\nDiet: ${prof?.diet_type ?? "none"}`,
          },
        ],
      }),
    },
  );
  if (!res.ok) {
    await usage.recordAiUsage(ctx.userId, "meal_recipe", model, null, false);
    if (res.status === 429) throw new Error("Too many requests right now. Try again in a minute.");
    throw new Error("The recipe couldn't be written right now. Try again shortly.");
  }
  const j = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  await usage.recordAiUsage(ctx.userId, "meal_recipe", model, j);
  await budget.settleAiUsage(ctx.userId, prof?.tier, 1200, 900, {
    input: j.usage?.prompt_tokens,
    output: j.usage?.completion_tokens,
  });
  let p: { steps?: string[]; tips?: string[] } = {};
  try {
    p = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
  } catch {
    p = {};
  }
  const steps = (p.steps ?? []).map((s) => String(s).slice(0, 300)).slice(0, 12);
  if (!steps.length)
    throw new Error("The recipe couldn't be written right now. Try again shortly.");
  return { steps, tips: (p.tips ?? []).map((s) => String(s).slice(0, 240)).slice(0, 3) };
}
