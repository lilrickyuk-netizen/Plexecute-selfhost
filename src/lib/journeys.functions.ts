// Member-facing Journey Planning server functions. Pro/Execute only (enforced here, not just
// in the UI). Journeys reserve real time as protected plan_blocks so the planner and Calendar
// treat travel as occupied time; reminders and leave calls use the existing systems.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { requireCapability } from "@/lib/entitlements.server";
import {
  clampBuffer,
  dueForRecheck,
  journeyTitle,
  leaveTime,
  normMode,
  ROUTE_FAILURE_MESSAGE,
  shortPlace,
  type JourneyMode,
} from "@/lib/journeys";

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

type Ctx = { supabase: SupabaseClient<Database>; userId: string };

export type PlaceChoice = { id: string; name: string; address: string };
export type JourneyPlanResult = {
  status: "planned" | "failed" | "ambiguous" | "ambiguous_origin";
  message?: string;
  choices?: PlaceChoice[];
  journey_id?: string;
  title?: string;
  leave_at?: string;
  arrive_by?: string;
  duration_min?: number;
  buffer_min?: number;
  traffic_aware?: boolean;
  dest?: string;
};
export type RecheckResult = {
  journey_id: string;
  shift_min?: number;
  leave_at?: string;
  skipped?: boolean;
  error?: string;
};
export type JourneyChangeResult = {
  status: string;
  error?: string;
  message?: string;
  choices?: PlaceChoice[];
  journey_id?: string;
  title?: string;
  leave_at?: string;
  duration_min?: number;
  buffer_min?: number;
  already?: boolean;
};

const placeInput = z.object({
  label: z.string().min(1).max(40),
  address: z.string().min(3).max(200),
});

export const savePlace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => placeInput.parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireCapability(ctx.supabase, ctx.userId, "journey_planning");
    const db = await admin();
    const j = await import("@/lib/journeys.server");
    const geo = await j.geocode(db, data.address, ctx.userId);
    const { error } = await ctx.supabase.from("saved_places").upsert(
      {
        user_id: ctx.userId,
        label: data.label.toLowerCase(),
        address: geo.formatted,
        lat: geo.lat,
        lng: geo.lng,
      },
      { onConflict: "user_id,label" },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const, label: data.label.toLowerCase(), formatted: geo.formatted };
  });

export const listPlaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const { data } = await ctx.supabase
      .from("saved_places")
      .select("id,label,address")
      .order("label");
    return data ?? [];
  });

export const listJourneys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const { data } = await ctx.supabase
      .from("journeys")
      .select(
        "id,origin_label,origin_address,dest_label,dest_address,mode,arrive_by,leave_at,duration_min,buffer_min,distance_m,traffic_aware,status,appointment_id,last_checked_at,created_at",
      )
      .order("leave_at", { ascending: true })
      .limit(50);
    return data ?? [];
  });

const planInput = z.object({
  destination: z.string().min(1).max(200), // address, place name, or saved label ("home"/"work")
  origin: z.string().max(200).nullable(), // null = home if saved, else previous journey destination
  mode: z.enum(["drive", "transit", "walk"]),
  arrive_by: z.string(), // ISO instant
  buffer_min: z.number().int().min(0).max(120).optional(),
  appointment_id: z.string().uuid().nullable().optional(),
});

type ResolvedPlace = { label: string | null; address: string; lat: number; lng: number };

async function resolvePlace(
  db: Awaited<ReturnType<typeof admin>>,
  userId: string,
  text: string,
  bias?: { lat: number; lng: number },
): Promise<ResolvedPlace | { ambiguous: { id: string; name: string; address: string }[] }> {
  const j = await import("@/lib/journeys.server");
  const lower = text.trim().toLowerCase();
  const { data: saved } = await db
    .from("saved_places")
    .select("label,address,lat,lng")
    .eq("user_id", userId)
    .ilike("label", lower)
    .maybeSingle();
  if (saved?.lat != null && saved.lng != null)
    return { label: saved.label, address: saved.address, lat: saved.lat, lng: saved.lng };
  // Looks like a full address? Geocode it. Otherwise treat as a place/business name.
  if (/\d|,\s*\w/.test(text) && text.trim().length > 8) {
    const geo = await j.geocode(db, text, userId);
    return { label: null, address: geo.formatted, lat: geo.lat, lng: geo.lng };
  }
  const matches = await j.searchPlaces(userId, text, bias);
  if (!matches.length) throw new Error("no_route");
  if (matches.length > 1)
    return { ambiguous: matches.map((m) => ({ id: m.id, name: m.name, address: m.address })) };
  const m = matches[0]!;
  return { label: m.name, address: m.address, lat: m.lat, lng: m.lng };
}

/** Plan a journey: resolve ends, route it, work out leave time, reserve a protected block. */
export const planJourney = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => planInput.parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireCapability(ctx.supabase, ctx.userId, "journey_planning");
    const db = await admin();
    return planJourneyCore(db, ctx.userId, data);
  });

export async function planJourneyCore(
  db: Awaited<ReturnType<typeof admin>>,
  userId: string,
  data: z.infer<typeof planInput>,
): Promise<JourneyPlanResult> {
  const j = await import("@/lib/journeys.server");
  const mode = normMode(data.mode);
  const arriveBy = new Date(data.arrive_by);
  if (Number.isNaN(arriveBy.getTime())) throw new Error("invalid_time");
  const buffer = clampBuffer(data.buffer_min);

  // A journey arriving exactly when a confirmed booking starts belongs to that booking.
  const explicitAppointment = !!data.appointment_id;
  if (!data.appointment_id) {
    const { data: prof } = await db
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .maybeSingle();
    const { zonedInstant } = await import("@/lib/tz");
    const { toMin } = await import("@/lib/appointments");
    const { data: bks } = await db
      .from("appointment_bookings")
      .select("id,slot_date,start_time")
      .eq("user_id", userId)
      .eq("status", "confirmed")
      .not("slot_date", "is", null)
      .gte("slot_date", new Date(arriveBy.getTime() - 864e5).toISOString().slice(0, 10))
      .lte("slot_date", new Date(arriveBy.getTime() + 864e5).toISOString().slice(0, 10));
    const hit = (bks ?? []).find(
      (b) =>
        b.start_time &&
        Math.abs(
          zonedInstant(
            String(b.slot_date),
            toMin(String(b.start_time)),
            prof?.timezone ?? null,
          ).getTime() - arriveBy.getTime(),
        ) < 60e3,
    );
    if (hit) data = { ...data, appointment_id: hit.id };
  }
  // Destination: an appointment's stored address wins when linked.
  let destText = data.destination;
  if (data.appointment_id && explicitAppointment) {
    const { data: appt } = await db
      .from("appointment_bookings")
      .select("provider_name,address:constraints->>location,slot_date,start_time")
      .eq("id", data.appointment_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (appt) {
      const loc = (appt as { address?: string | null }).address;
      if (loc) destText = loc;
    }
  }

  // Origin: explicit, else saved "home", else the destination of the previous journey that day.
  let originText = data.origin;
  if (!originText) {
    const { data: prev } = await db
      .from("journeys")
      .select("dest_label,dest_address,dest_lat,dest_lng,arrive_by")
      .eq("user_id", userId)
      .in("status", ["planned", "monitoring", "leave_soon", "in_progress", "completed"])
      .lt("arrive_by", arriveBy.toISOString())
      .order("arrive_by", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      prev &&
      new Date(prev.arrive_by).getTime() > arriveBy.getTime() - 12 * 3600000 &&
      prev.dest_lat != null
    ) {
      const dest = await resolvePlace(db, userId, destText, {
        lat: prev.dest_lat,
        lng: prev.dest_lng!,
      });
      if ("ambiguous" in dest) return { status: "ambiguous", choices: dest.ambiguous };
      return finishPlan(
        db,
        userId,
        {
          label: prev.dest_label,
          address: prev.dest_address,
          lat: prev.dest_lat,
          lng: prev.dest_lng!,
        },
        dest,
        mode,
        arriveBy,
        buffer,
        data.appointment_id ?? null,
      );
    }
    originText = "home";
  }

  const origin = await resolvePlace(db, userId, originText);
  if ("ambiguous" in origin) return { status: "ambiguous_origin", choices: origin.ambiguous };
  const dest = await resolvePlace(db, userId, destText, origin);
  if ("ambiguous" in dest) return { status: "ambiguous", choices: dest.ambiguous };
  return finishPlan(db, userId, origin, dest, mode, arriveBy, buffer, data.appointment_id ?? null);
}

async function finishPlan(
  db: Awaited<ReturnType<typeof admin>>,
  userId: string,
  origin: ResolvedPlace,
  dest: ResolvedPlace,
  mode: JourneyMode,
  arriveBy: Date,
  buffer: number,
  appointmentId: string | null,
): Promise<JourneyPlanResult> {
  const j = await import("@/lib/journeys.server");
  let route;
  try {
    // Drive/walk: first pass with a rough departure, then recompute at the real leave time
    // so the duration is traffic-aware for when they'll actually travel.
    const rough = await j.computeRoute(userId, {
      origin,
      dest,
      mode,
      departAt: new Date(arriveBy.getTime() - 60 * 60000),
      arriveBy,
    });
    const firstLeave = leaveTime(arriveBy, rough.durationMin, buffer);
    route =
      mode === "drive"
        ? await j.computeRoute(userId, { origin, dest, mode, departAt: firstLeave })
        : rough;
  } catch {
    return { status: "failed", message: ROUTE_FAILURE_MESSAGE };
  }
  const leave = leaveTime(arriveBy, route.durationMin, buffer);
  const title = journeyTitle(dest.label, dest.address, mode);

  // Reserve the travel window as a protected block so the planner never schedules over it.
  const { data: block, error: bErr } = await db
    .from("plan_blocks")
    .insert({
      user_id: userId,
      title,
      starts_at: leave.toISOString(),
      duration_min: route.durationMin + buffer,
      status: "planned",
      is_protected: true,
      occurrence_kind: "other",
      domain: "travel",
      note: "journey",
    })
    .select("id")
    .single();
  if (bErr) throw new Error(bErr.message);

  const { data: journey, error } = await db
    .from("journeys")
    .insert({
      user_id: userId,
      origin_label: origin.label,
      origin_address: origin.address,
      origin_lat: origin.lat,
      origin_lng: origin.lng,
      dest_label: dest.label,
      dest_address: dest.address,
      dest_lat: dest.lat,
      dest_lng: dest.lng,
      mode,
      arrive_by: arriveBy.toISOString(),
      leave_at: leave.toISOString(),
      duration_min: route.durationMin,
      buffer_min: buffer,
      distance_m: route.distanceM,
      traffic_aware: route.trafficAware,
      status: "planned",
      appointment_id: appointmentId,
      plan_block_id: block.id,
      last_checked_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await db.from("journey_events").insert({
    journey_id: journey.id,
    user_id: userId,
    kind: "planned",
    detail: {
      mode,
      duration_min: route.durationMin,
      buffer_min: buffer,
      traffic_aware: route.trafficAware,
    },
  });
  return {
    status: "planned",
    journey_id: journey.id,
    title,
    leave_at: leave.toISOString(),
    arrive_by: arriveBy.toISOString(),
    duration_min: route.durationMin,
    buffer_min: buffer,
    traffic_aware: route.trafficAware,
    dest: shortPlace(dest.address),
  };
}

const changeInput = z.object({
  journey_id: z.string().uuid(),
  mode: z.enum(["drive", "transit", "walk"]).optional(),
  origin: z.string().max(200).optional(),
  buffer_min: z.number().int().min(0).max(120).optional(),
});

/** Change mode, origin or buffer — recalculates only what changed. */
export const changeJourney = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => changeInput.parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireCapability(ctx.supabase, ctx.userId, "journey_planning");
    const db = await admin();
    return changeJourneyCore(db, ctx.userId, data);
  });

export async function changeJourneyCore(
  db: Awaited<ReturnType<typeof admin>>,
  userId: string,
  data: z.infer<typeof changeInput>,
): Promise<JourneyChangeResult> {
  const j = await import("@/lib/journeys.server");
  const { data: cur } = await db
    .from("journeys")
    .select("*")
    .eq("id", data.journey_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!cur) return { status: "error", error: "unknown_journey" };
  if (cur.status === "cancelled" || cur.status === "completed")
    return { status: "error", error: "journey_closed" };

  const mode = data.mode ? normMode(data.mode) : (cur.mode as JourneyMode);
  const buffer = data.buffer_min != null ? clampBuffer(data.buffer_min) : cur.buffer_min;
  let origin: ResolvedPlace = {
    label: cur.origin_label,
    address: cur.origin_address,
    lat: cur.origin_lat ?? 0,
    lng: cur.origin_lng ?? 0,
  };
  if (data.origin) {
    const r = await resolvePlace(db, userId, data.origin);
    if ("ambiguous" in r) return { status: "ambiguous_origin", choices: r.ambiguous };
    origin = r;
  }
  const arriveBy = new Date(cur.arrive_by);
  let route;
  try {
    const rough = await j.computeRoute(userId, {
      origin,
      dest: { lat: cur.dest_lat ?? 0, lng: cur.dest_lng ?? 0 },
      mode,
      departAt: new Date(arriveBy.getTime() - 60 * 60000),
      arriveBy,
    });
    const firstLeave = leaveTime(arriveBy, rough.durationMin, buffer);
    route =
      mode === "drive"
        ? await j.computeRoute(userId, {
            origin,
            dest: { lat: cur.dest_lat ?? 0, lng: cur.dest_lng ?? 0 },
            mode,
            departAt: firstLeave,
          })
        : rough;
  } catch {
    await db
      .from("journeys")
      .update({ status: "needs_attention", updated_at: new Date().toISOString() })
      .eq("id", cur.id);
    return { status: "failed", message: ROUTE_FAILURE_MESSAGE };
  }
  const leave = leaveTime(arriveBy, route.durationMin, buffer);
  const title = journeyTitle(cur.dest_label, cur.dest_address, mode);
  if (cur.plan_block_id) {
    await db
      .from("plan_blocks")
      .update({ title, starts_at: leave.toISOString(), duration_min: route.durationMin + buffer })
      .eq("id", cur.plan_block_id);
  }
  await db
    .from("journeys")
    .update({
      mode,
      buffer_min: buffer,
      origin_label: origin.label,
      origin_address: origin.address,
      origin_lat: origin.lat,
      origin_lng: origin.lng,
      leave_at: leave.toISOString(),
      duration_min: route.durationMin,
      distance_m: route.distanceM,
      traffic_aware: route.trafficAware,
      status: "planned",
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", cur.id);
  await db.from("journey_events").insert({
    journey_id: cur.id,
    user_id: userId,
    kind: "changed",
    detail: {
      mode,
      buffer_min: buffer,
      duration_min: route.durationMin,
      origin_changed: !!data.origin,
    },
  });
  return {
    status: "planned",
    journey_id: cur.id,
    title,
    leave_at: leave.toISOString(),
    duration_min: route.durationMin,
    buffer_min: buffer,
  };
}

export const cancelJourney = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ journey_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireCapability(ctx.supabase, ctx.userId, "journey_planning");
    const db = await admin();
    return cancelJourneyCore(db, ctx.userId, data.journey_id);
  });

export async function cancelJourneyCore(
  db: Awaited<ReturnType<typeof admin>>,
  userId: string,
  journeyId: string,
): Promise<JourneyChangeResult> {
  const { data: cur } = await db
    .from("journeys")
    .select("id,status,plan_block_id")
    .eq("id", journeyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!cur) return { status: "error", error: "unknown_journey" };
  if (cur.status === "cancelled") return { status: "cancelled", already: true }; // idempotent
  await db
    .from("journeys")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", cur.id);
  if (cur.plan_block_id)
    await db.from("plan_blocks").update({ status: "cancelled" }).eq("id", cur.plan_block_id);
  await db
    .from("journey_events")
    .insert({ journey_id: cur.id, user_id: userId, kind: "cancelled", detail: {} });
  return { status: "cancelled" };
}

/**
 * Traffic-aware recheck for upcoming journeys (called by the journeys page on view and by the
 * Coach). Cost-conscious: only journeys due per dueForRecheck are recalculated.
 */
export const recheckJourneys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    await requireCapability(ctx.supabase, ctx.userId, "journey_planning");
    const db = await admin();
    const { data: rows } = await db
      .from("journeys")
      .select(
        "id,mode,origin_lat,origin_lng,dest_lat,dest_lng,arrive_by,leave_at,buffer_min,status,last_checked_at,plan_block_id,dest_label,dest_address",
      )
      .eq("user_id", ctx.userId)
      .in("status", ["planned", "monitoring", "leave_soon"])
      .order("leave_at", { ascending: true })
      .limit(10);
    const now = new Date();
    const due = (rows ?? []).filter((r) => dueForRecheck(r, now));
    const updates: RecheckResult[] = [];
    for (const r of due.slice(0, 3)) {
      updates.push(await recheckOne(db, ctx.userId, r));
    }
    return { checked: updates.length, updates };
  });

async function recheckOne(
  db: Awaited<ReturnType<typeof admin>>,
  userId: string,
  r: {
    id: string;
    mode: string;
    origin_lat: number | null;
    origin_lng: number | null;
    dest_lat: number | null;
    dest_lng: number | null;
    arrive_by: string;
    leave_at: string;
    buffer_min: number;
    plan_block_id: string | null;
    dest_label: string | null;
    dest_address: string;
  },
): Promise<RecheckResult> {
  const j = await import("@/lib/journeys.server");
  if (r.origin_lat == null || r.dest_lat == null) return { journey_id: r.id, skipped: true };
  const arriveBy = new Date(r.arrive_by);
  try {
    const route = await j.computeRoute(userId, {
      origin: { lat: r.origin_lat, lng: r.origin_lng! },
      dest: { lat: r.dest_lat, lng: r.dest_lng! },
      mode: normMode(r.mode),
      departAt: new Date(r.leave_at),
      arriveBy,
    });
    const leave = leaveTime(arriveBy, route.durationMin, r.buffer_min);
    const oldLeave = new Date(r.leave_at).getTime();
    const shiftMin = Math.round((leave.getTime() - oldLeave) / 60000);
    const status = leave.getTime() - Date.now() < 30 * 60000 ? "leave_soon" : "monitoring";
    await db
      .from("journeys")
      .update({
        leave_at: leave.toISOString(),
        duration_min: route.durationMin,
        status,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", r.id);
    if (Math.abs(shiftMin) >= 5 && r.plan_block_id) {
      await db
        .from("plan_blocks")
        .update({ starts_at: leave.toISOString(), duration_min: route.durationMin + r.buffer_min })
        .eq("id", r.plan_block_id);
      await db.from("journey_events").insert({
        journey_id: r.id,
        user_id: userId,
        kind: "leave_time_updated",
        detail: { shift_min: shiftMin },
      });
      const { enqueueNotification } = await import("@/lib/notify.server");
      await enqueueNotification(db, {
        userId,
        category: "PLAN_CHANGED",
        intent: "journey_leave_update",
        title: shiftMin < 0 ? "Leave a little earlier" : "You can leave a little later",
        body: `Your journey to ${r.dest_label ?? shortPlace(r.dest_address)} now means leaving at ${leave.toISOString().slice(11, 16)} (${shiftMin < 0 ? "" : "+"}${shiftMin} min).`,
        link: "/app/journeys",
        kind: "system",
        dedupe: ["journey", r.id, leave.toISOString().slice(0, 16)],
      });
    }
    return { journey_id: r.id, shift_min: shiftMin, leave_at: leave.toISOString() };
  } catch {
    await db.from("journeys").update({ last_checked_at: new Date().toISOString() }).eq("id", r.id);
    return { journey_id: r.id, error: "recheck_failed" };
  }
}

/** "Call me when I need to leave" — uses the normal call system, so allowances and Free's
 *  no-calls rule still apply (journey calls spend the same balance; no separate credits). */
export const scheduleLeaveCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ journey_id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireCapability(ctx.supabase, ctx.userId, "calls");
    const db = await admin();
    return scheduleLeaveCallCore(db, ctx.userId, data.journey_id);
  });

export async function scheduleLeaveCallCore(
  db: Awaited<ReturnType<typeof admin>>,
  userId: string,
  journeyId: string,
): Promise<{ status: string; call_at?: string; error?: string }> {
  const { data: j } = await db
    .from("journeys")
    .select("id,status,leave_at,dest_label,dest_address")
    .eq("id", journeyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!j) return { status: "error", error: "unknown_journey" };
  if (j.status === "cancelled" || j.status === "completed")
    return { status: "error", error: "journey_closed" };
  const { error } = await db.from("scheduled_calls").upsert(
    {
      user_id: userId,
      call_at: j.leave_at,
      purpose: `Time to leave for ${j.dest_label ?? shortPlace(j.dest_address)}`,
      source: "journey",
      source_ref: j.id,
      dedupe_key: `journey:${j.id}`,
      status: "scheduled",
    },
    { onConflict: "user_id,dedupe_key" },
  );
  if (error) return { status: "error", error: error.message };
  await db.from("journey_events").insert({
    journey_id: j.id,
    user_id: userId,
    kind: "leave_call_scheduled",
    detail: { call_at: j.leave_at },
  });
  return { status: "scheduled", call_at: j.leave_at };
}
