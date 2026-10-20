import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const svc = () => import("./meal-prep.server");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const slot = z.enum(["breakfast", "lunch", "dinner", "snack"]);
const key = z.string().min(8).max(80);

export const getMealPrep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ date: date.optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const s = await svc();
    const [inventory, plan, status] = await Promise.all([
      s.listInventory(context),
      s.currentPlan(context),
      s.nutritionStatus(context, data.date),
    ]);
    return { inventory, plan, status };
  });

export const addInventoryText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        text: z.string().trim().min(2).max(1500),
        source: z.enum(["text", "voice", "manual"]),
        importKey: key,
      })
      .parse(i),
  )
  .handler(async ({ data, context }) =>
    (await svc()).addInventoryText(context, data.text, data.source, data.importKey),
  );

export const addInventoryPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        image: z
          .string()
          .regex(/^data:image\/(jpeg|png|webp);base64,/)
          .max(6_000_000),
        importKey: key,
      })
      .parse(i),
  )
  .handler(async ({ data, context }) =>
    (await svc()).addInventoryPhoto(context, data.image, data.importKey),
  );

export const updateInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(80).optional(),
        grams: z.number().min(0).max(100000).nullable().optional(),
        as_needed: z.boolean().optional(),
        expires_on: date.nullable().optional(),
        remove: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    return (await svc()).updateInventoryItem(context, id, patch as never);
  });

export const confirmInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ unknown: z.enum(["as_needed", "block"]) }).parse(i))
  .handler(async ({ data, context }) => (await svc()).confirmInventory(context, data.unknown));

export const clearInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await svc()).clearInventory(context));

export const buildMealPrep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        start: date.nullable(),
        days: z.number().int().min(1).max(7),
        onlyExisting: z.boolean(),
        allowStaples: z.boolean().default(true),
        kcal: z.number().int().min(800).max(6000).nullable().default(null),
        protein_g: z.number().int().min(20).max(400).nullable().default(null),
        prepWeekday: z.number().int().min(0).max(6).nullable().default(null),
        secondPrep: z.boolean().nullable().default(null),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => (await svc()).buildPlan(context, data));

const edit = z.discriminatedUnion("type", [
  z.object({ type: z.literal("swap"), a: z.object({ date, slot }), b: z.object({ date, slot }) }),
  z.object({
    type: z.literal("replace"),
    date,
    slot,
    avoid: z.array(z.string().max(40)).max(10).optional(),
    prefer: z.array(z.string().max(40)).max(5).optional(),
    vegetarian: z.boolean().optional(),
    quick: z.boolean().optional(),
  }),
  z.object({ type: z.literal("adjust_kcal"), date, kcal: z.number().int().min(-800).max(800) }),
  z.object({ type: z.literal("more_protein"), date, grams: z.number().int().min(5).max(80) }),
  z.object({ type: z.literal("remove"), date, slot }),
  z.object({
    type: z.literal("replace_days"),
    from: date,
    avoid: z.array(z.string().max(40)).max(10).optional(),
    prefer: z.array(z.string().max(40)).max(5).optional(),
    slot: slot.optional(),
  }),
]);
export const editMealPrep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), edit }).parse(i))
  .handler(async ({ data, context }) =>
    (await svc()).editPlan(context, data.id, data.edit as never),
  );

export const acceptMealPrep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => (await svc()).acceptPlan(context, data.id));

export const logPlannedMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        date,
        slot,
        factor: z.number().min(0.25).max(3).optional(),
        photoEstimateId: z.string().uuid().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) =>
    (await svc()).logPlannedMeal(context, data.id, data.date, data.slot, {
      factor: data.factor ?? 1,
      photoEstimateId: data.photoEstimateId ?? null,
    }),
  );

export const skipPlannedMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), date, slot }).parse(i))
  .handler(async ({ data, context }) =>
    (await svc()).skipPlannedMeal(context, data.id, data.date, data.slot),
  );

export const setMealPrepPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        dislikes: z.array(z.string().trim().max(40)).max(30).optional(),
        prep_weekday: z.number().int().min(0).max(6).optional(),
        second_prep: z.boolean().optional(),
        quick_breakfasts: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => (await svc()).setPreferences(context, data as never));

export const getMealRecipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        name: z.string().min(1).max(120),
        minutes: z.number().min(0).max(600),
        kcal: z.number().min(0).max(5000),
        ingredients: z
          .array(
            z.object({
              name: z.string().min(1).max(80),
              grams: z.number().min(0).max(5000),
              count: z.number().nullable().optional(),
            }),
          )
          .min(1)
          .max(20),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => (await svc()).mealRecipe(context, data));
