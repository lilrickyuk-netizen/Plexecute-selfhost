import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PENDING_TTL_MS = 24 * 3600 * 1000;

/** Confirms or cancels a Coach pending action. Runs it once (atomic claim) with the member's own client. */
export const decideCoachAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), decision: z.enum(["confirm", "cancel"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("coach_pending_actions")
      .select("id,kind,payload,status,created_at")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("That request could not be found.");
    if (row.status !== "pending") return { status: row.status, duplicate: true };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { guardCoachDb } = await import("./coach-tools.server");
    const admin = guardCoachDb(supabaseAdmin);
    const expired = Date.now() - new Date(row.created_at).getTime() > PENDING_TTL_MS;
    const next = data.decision === "cancel" ? "cancelled" : expired ? "expired" : "confirmed";
    const { data: claimed } = await supabaseAdmin
      .from("coach_pending_actions")
      .update({ status: next, decided_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) return { status: "already_decided", duplicate: true };
    if (next !== "confirmed") {
      await supabaseAdmin.from("audit_events").insert({
        user_id: userId,
        actor_type: "user",
        action: `coach.action_${next}`,
        resource_type: "coach_action",
        resource_id: row.id,
        outcome: "succeeded",
        metadata: { kind: row.kind },
      });
      if (expired) throw new Error("This request is more than a day old. Ask the Coach again.");
      return { status: next };
    }
    try {
      const { runPending } = await import("./coach-actions.server");
      const result = await runPending(supabase as never, admin as never, userId, {
        id: row.id,
        kind: row.kind,
        payload: (row.payload ?? {}) as Record<string, unknown>,
      });
      await supabaseAdmin
        .from("coach_pending_actions")
        .update({ result: result as never })
        .eq("id", row.id);
      return {
        status: "confirmed",
        result: JSON.parse(JSON.stringify(result)) as Record<
          string,
          string | number | boolean | null
        >,
      };
    } catch (e) {
      await supabaseAdmin
        .from("coach_pending_actions")
        .update({ status: "failed", result: { error: (e as Error).message } as never })
        .eq("id", row.id);
      throw new Error((e as Error).message || "That change could not be made.");
    }
  });
