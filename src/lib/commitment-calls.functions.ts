// Accountability call linked to a commitment, booked from the Commitments screen.
// Uses the same scheduled_calls model and dedupe keys as the Coach, so allowances,
// consent and Free's no-calls rule all still apply.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { requireCapability } from "@/lib/entitlements.server";
import { addDaysKey, isoDowOfKey, localDayKey, validZone, zonedInstant } from "@/lib/tz";

type Ctx = { supabase: SupabaseClient<Database>; userId: string };
const WEEKS_AHEAD = 4;

export const scheduleCommitmentCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ commitment_id: z.string().uuid(), lead_minutes: z.number().int().min(0).max(1440) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireCapability(ctx.supabase, ctx.userId, "calls");
    const { data: c } = await ctx.supabase
      .from("commitments")
      .select("id,title,recurrence,days,on_date,start_time,active")
      .eq("id", data.commitment_id)
      .maybeSingle();
    if (!c || !c.active) throw new Error("That commitment isn't active.");
    const { data: prof } = await ctx.supabase
      .from("profiles")
      .select("timezone")
      .eq("id", ctx.userId)
      .maybeSingle();
    const tz = validZone(prof?.timezone);
    const [h, m] = c.start_time.split(":").map(Number);
    const callMin = (h ?? 0) * 60 + (m ?? 0) - data.lead_minutes;

    const today = localDayKey(new Date(), tz);
    const days: string[] = [];
    if (c.recurrence === "once") {
      if (c.on_date) days.push(c.on_date);
    } else {
      for (let i = 0; i < WEEKS_AHEAD * 7; i++) {
        const k = addDaysKey(today, i);
        if ((c.days as number[]).includes(isoDowOfKey(k))) days.push(k);
      }
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = Date.now();
    const rows = days
      .map((d) => zonedInstant(d, callMin, tz))
      .filter((at) => at.getTime() > now)
      .map((at) => ({
        user_id: ctx.userId,
        commitment_id: c.id,
        call_at: at.toISOString(),
        purpose: `Before ${c.title}`.slice(0, 200),
        source: "commitment",
        source_ref: c.id,
        dedupe_key: `commitment:${c.id}:call:${at.toISOString()}`,
        status: "scheduled",
      }));
    if (!rows.length) throw new Error("That call time has already passed.");
    // Replace any earlier still-waiting calls for this commitment so changing the lead time doesn't double up.
    await supabaseAdmin
      .from("scheduled_calls")
      .update({ status: "cancelled", status_reason: "replaced" })
      .eq("user_id", ctx.userId)
      .eq("commitment_id", c.id)
      .eq("status", "scheduled")
      .not("dedupe_key", "in", `(${rows.map((r) => `"${r.dedupe_key}"`).join(",")})`);
    const { error } = await supabaseAdmin
      .from("scheduled_calls")
      .upsert(rows, { onConflict: "user_id,dedupe_key" });
    if (error) throw new Error("Couldn't book the call. Try again.");
    await supabaseAdmin.from("audit_events").insert({
      user_id: ctx.userId,
      actor_type: "user",
      action: "commitment.call_scheduled",
      resource_type: "commitment",
      resource_id: c.id,
      outcome: "succeeded",
      metadata: {
        lead_minutes: data.lead_minutes,
        calls: rows.length,
        source_screen: "commitments",
      },
    } as never);
    const { callReadiness } = await import("@/lib/calling.server");
    return { calls: rows.length, first_at: rows[0]?.call_at, ...(await callReadiness(ctx.userId)) };
  });

export const cancelCommitmentCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ commitment_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("scheduled_calls")
      .update({ status: "cancelled", status_reason: "member_cancelled" })
      .eq("user_id", ctx.userId)
      .eq("commitment_id", data.commitment_id)
      .eq("status", "scheduled");
    return { ok: true };
  });
