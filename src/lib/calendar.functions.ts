import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CALENDAR_MODES } from "./calendar";

const origin = () => {
  try {
    return new URL(getRequest().url).origin;
  } catch {
    return "";
  }
};

async function owned(supabase: any, id: string) {
  const { data } = await supabase
    .from("calendar_connections")
    .select("id,provider,status")
    .eq("id", id)
    .maybeSingle();
  if (!data) throw new Error("That calendar connection wasn't found.");
  return data as { id: string; provider: string; status: string };
}

/** Connections, configuration, conflicts with the current plan and external edits waiting for a decision. */
export const getCalendarState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { providerConfig } = await import("./calendar.server");
    const { conflicts, isStale } = await import("./calendar");
    const db = context.supabase,
      now = new Date();
    const [{ data: conns }, { data: busy }, { data: blocks }, { data: links }] = await Promise.all([
      db
        .from("calendar_connections")
        .select("id,provider,mode,status,all_day_hard,last_sync_at,last_error,created_at")
        .neq("status", "disconnected")
        .order("created_at"),
      db
        .from("calendar_busy")
        .select("starts_at,ends_at,busy,all_day,connection_id,title")
        .gte("ends_at", now.toISOString())
        .lte("starts_at", new Date(now.getTime() + 14 * 864e5).toISOString())
        .limit(1000),
      db
        .from("plan_blocks")
        .select("id,title,starts_at,duration_min,status")
        .gte("starts_at", now.toISOString())
        .lte("starts_at", new Date(now.getTime() + 14 * 864e5).toISOString())
        .limit(500),
      db
        .from("calendar_event_links")
        .select("block_id,state,external_starts_at,connection_id,plan_blocks(title,starts_at)")
        .in("state", ["deleted_externally", "moved_externally"]),
    ]);
    const hard = new Map((conns ?? []).map((c) => [c.id, c.all_day_hard]));
    return {
      configured: { google: !!providerConfig("google"), microsoft: !!providerConfig("microsoft") },
      connections: (conns ?? []).map((c) => ({ ...c, stale: isStale(c.last_sync_at, now) })),
      upcomingBusy: (busy ?? []).filter((b) => b.busy).length,
      conflicts: conflicts(
        blocks ?? [],
        (busy ?? []).map((b) => ({ ...b, hard_all_day: hard.get(b.connection_id) ?? false })),
      ).map((b) => ({ id: b.id, title: b.title, starts_at: b.starts_at })),
      attention: (links ?? []).map((l) => ({
        block_id: l.block_id,
        connection_id: l.connection_id,
        state: l.state,
        external_starts_at: l.external_starts_at,
        block: l.plan_blocks as { title: string; starts_at: string } | null,
      })),
    };
  });

export const startCalendarConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ provider: z.enum(["google", "microsoft"]), mode: z.enum(CALENDAR_MODES) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await (
      await import("./entitlements.server")
    ).requireCalendarSlot(context.supabase, context.userId, data.provider);
    const { providerConfig, authUrl } = await import("./calendar.server");
    if (!providerConfig(data.provider)) return { url: null, error: "not_configured" as const };
    return { url: await authUrl(data.provider, data.mode, context.userId, origin()), error: null };
  });

export const setCalendarAllDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), hard: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await owned(context.supabase, data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("calendar_connections")
      .update({ all_day_hard: data.hard })
      .eq("id", data.id);
    return { ok: true };
  });

export const syncCalendarNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await owned(context.supabase, data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncConnection } = await import("./calendar.server");
    return { status: await syncConnection(supabaseAdmin, data.id, origin()) };
  });

export const disconnectCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await owned(context.supabase, data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { disconnect } = await import("./calendar.server");
    await disconnect(supabaseAdmin, data.id);
    return { ok: true };
  });

/** Device/local calendar: an .ics export from the phone or computer calendar. Only busy intervals are kept. */
export const importDeviceCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ ics: z.string().min(10).max(3_000_000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { parseIcs, surrogate } = await import("./calendar");
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("timezone")
      .eq("id", context.userId)
      .single();
    const rows = await parseIcs(data.ics, prof?.timezone ?? null);
    if (!rows.length) throw new Error("No events were found in that file.");
    let { data: conn } = await db
      .from("calendar_connections")
      .select("id,calendar_id_hash")
      .eq("user_id", context.userId)
      .eq("provider", "device")
      .neq("status", "disconnected")
      .maybeSingle();
    if (!conn)
      conn = (
        await db
          .from("calendar_connections")
          .insert({
            user_id: context.userId,
            provider: "device",
            mode: "FREE_BUSY_ONLY",
            status: "active",
            calendar_id_hash: await surrogate("device", context.userId),
          })
          .select("id,calendar_id_hash")
          .single()
      ).data;
    if (!conn) throw new Error("Couldn't save your calendar.");
    await db.from("calendar_busy").delete().eq("connection_id", conn.id);
    const up = rows.map((r) => ({
      ...r,
      user_id: context.userId,
      connection_id: conn!.id,
      calendar_id_hash: conn!.calendar_id_hash,
    }));
    for (let i = 0; i < up.length; i += 200)
      await db
        .from("calendar_busy")
        .upsert(up.slice(i, i + 200), { onConflict: "connection_id,event_hash" });
    await db
      .from("calendar_connections")
      .update({ status: "active", last_sync_at: new Date().toISOString(), last_error: null })
      .eq("id", conn.id);
    return { imported: up.length };
  });

/** User decision on an event they deleted or moved in their own calendar (§66.3: never recreated blindly). */
export const resolveCalendarChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        connectionId: z.string().uuid(),
        blockId: z.string().uuid(),
        decision: z.enum(["restore", "leave_out"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await owned(context.supabase, data.connectionId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const q = supabaseAdmin.from("calendar_event_links");
    if (data.decision === "restore")
      await q
        .update({ state: "synced", content_hash: null })
        .eq("connection_id", data.connectionId)
        .eq("block_id", data.blockId);
    else
      await q
        .update({ state: "removed" })
        .eq("connection_id", data.connectionId)
        .eq("block_id", data.blockId);
    await supabaseAdmin.from("audit_events").insert({
      user_id: context.userId,
      action: `calendar.external_change.${data.decision}`,
      actor_type: "user",
      resource_type: "plan_block",
      resource_id: data.blockId,
      outcome: "succeeded",
      metadata: { connection_id: data.connectionId },
    });
    return { ok: true };
  });
