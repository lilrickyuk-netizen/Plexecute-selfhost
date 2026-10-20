import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const id = z.string().uuid();
const ctxOf = (c: { supabase: unknown; userId: string }) => ({
  supabase: c.supabase,
  userId: c.userId,
});

export const estimateMealPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        image: z
          .string()
          .regex(/^data:image\/(jpeg|png|webp);base64,/)
          .max(6_000_000),
        note: z.string().max(300).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) =>
    (await import("./meal-photo.server")).analyseMealPhoto(
      ctxOf(context),
      data.image,
      data.note ?? null,
    ),
  );

export const correctMealPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id, correction: z.string().trim().min(2).max(400) }).parse(i),
  )
  .handler(async ({ data, context }) =>
    (await import("./meal-photo.server")).correctMealEstimate(
      ctxOf(context),
      data.id,
      data.correction,
    ),
  );

export const logMealPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id,
        meal_slot: z.enum(["breakfast", "lunch", "dinner", "snack"]),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) =>
    (await import("./meal-photo.server")).logMealEstimate(
      ctxOf(context),
      data.id,
      data.meal_slot,
      data.date,
    ),
  );

export const cancelMealPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id }).parse(i))
  .handler(async ({ data, context }) =>
    (await import("./meal-photo.server")).cancelMealEstimate(ctxOf(context), data.id),
  );
