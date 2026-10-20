import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEMO_SPECS } from "./exercise-demo";

/** Optional demonstration for one prescribed exercise. Watching never changes the workout. */
export const getExerciseDemo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ exerciseKey: z.string().refine((k) => k in DEMO_SPECS) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    const { findExerciseDemo } = await import("./exercise-demo.server");
    return findExerciseDemo(db, context.userId, data.exerciseKey);
  });
