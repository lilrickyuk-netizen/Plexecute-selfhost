import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { OUTCOME_TYPES } from "./outcomes";

/** Detects and appends new outcomes for the signed-in user. Clients can never write the ledger directly. */
export const refreshMyOutcomes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { refreshOutcomes } = await import("./outcomes.server");
    return { added: await refreshOutcomes(supabaseAdmin, context.userId) };
  });

/** Read path for Progress and downstream systems; RLS limits rows to the caller. */
export const getOutcomeHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        type: z.enum(OUTCOME_TYPES).optional(),
        goalId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(200).default(100),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("outcome_ledger")
      .select(
        "id,outcome_type,domain,metric,value,text_value,unit,evidence_class,source,source_ref,goal_id,block_id,plan_version_id,observation_refs,metadata,observed_at,created_at",
      )
      .neq("outcome_type", "observation")
      .order("observed_at", { ascending: false })
      .limit(data.limit);
    if (data.type) q = q.eq("outcome_type", data.type);
    if (data.goalId) q = q.eq("goal_id", data.goalId);
    const { data: rows, error } = await q;
    if (error) throw new Error("Couldn't load your outcomes.");
    return rows ?? [];
  });
