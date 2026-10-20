import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const HM = z.string().regex(/^\d{2}:\d{2}$/);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const slot = z.object({ date: DAY, start: HM, end: HM });

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

export const listAppointments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await (
      await import("./appointments.server")
    ).expireStaleCheckouts(await admin(), context.userId);
    const { data } = await context.supabase
      .from("appointment_bookings")
      .select(
        "id,service,status,method,options,provider_name,provider_url,slot_date,start_time,end_time,reference,price_minor,deposit_minor,currency,cancellation_terms,prep_notes,failure_reason,confirmation_source,constraints,created_at,provider_phone_enc,kind,category,details,checkout_url,checkout_amount_minor,checkout_fee_minor,checkout_expires_at,payment_state",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = data ?? [];
    const ids = rows.map((b) => b.id);
    const { data: events } = ids.length
      ? await context.supabase
          .from("appointment_booking_events")
          .select("booking_id,event,detail,created_at")
          .in("booking_id", ids)
          .order("created_at", { ascending: false })
      : {
          data: [] as { booking_id: string; event: string; detail: unknown; created_at: string }[],
        };
    const latest = new Map<string, { event: string; created_at: string }>();
    for (const e of events ?? []) if (!latest.has(e.booking_id)) latest.set(e.booking_id, e);
    return rows.map((b) => ({
      ...b,
      provider_phone_enc: undefined,
      has_phone: !!b.provider_phone_enc,
      last_event: latest.get(b.id) ?? null,
    }));
  });

export const findAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        service: z.string().min(1).max(80),
        date_from: DAY,
        date_to: DAY,
        earliest: HM,
        latest: HM,
        duration_min: z.number().int().min(10).max(240),
        travel_min: z.number().int().min(0).max(180).nullable(),
        max_price: z.number().min(0).max(10000).nullable(),
        location: z.string().max(120).nullable(),
        provider_name: z.string().max(100).nullable(),
        provider_url: z.string().url().max(500).nullable(),
        provider_phone: z.string().max(30).nullable(),
        key: z.string().min(8).max(80),
        kind: z.enum(["appointment", "reservation", "order"]).nullable().optional(),
        category: z.string().max(30).nullable().optional(),
        details: z
          .record(z.string(), z.union([z.string().max(200), z.number()]))
          .nullable()
          .optional(),
        preauthorised: z.boolean().optional(),
        preauthorisation_text: z.string().max(400).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: p } = await context.supabase
      .from("profiles")
      .select("timezone")
      .eq("id", context.userId)
      .single();
    const ap = await import("./appointments.server");
    return ap.startBooking(await admin(), context.userId, p?.timezone ?? null, {
      service: data.service,
      constraints: {
        date_from: data.date_from,
        date_to: data.date_to,
        earliest: data.earliest,
        latest: data.latest,
        duration_min: data.duration_min,
        travel_min: data.travel_min,
        max_price_minor: data.max_price != null ? Math.round(data.max_price * 100) : null,
        location: data.location,
      },
      provider_name: data.provider_name,
      provider_url: data.provider_url,
      provider_phone: data.provider_phone,
      idempotency_key: `ui:${data.key}`,
      kind: data.kind ?? null,
      category: data.category ?? null,
      details: data.details ?? null,
      preauthorised: !!data.preauthorised,
      preauthorisation_text: data.preauthorisation_text ?? null,
    });
  });

export const chooseAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        booking_id: z.string().uuid(),
        provider_index: z.number().int().min(0).max(5).nullable(),
        slot,
        method: z.enum(["online", "phone"]),
        provider_phone: z.string().max(30).nullable(),
        confirm: z.literal(true),
        origin: z.string().url(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) =>
    (await import("./appointments.server")).chooseOption(await admin(), context.userId, {
      ...data,
    }),
  );

export const confirmAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        booking_id: z.string().uuid(),
        slot,
        reference: z.string().max(80).nullable(),
        confirmation_text: z.string().max(400).nullable(),
        price: z.number().min(0).max(10000).nullable(),
        deposit: z.number().min(0).max(10000).nullable(),
        cancellation_terms: z.string().max(300).nullable(),
        address: z.string().max(200).nullable(),
        accept_terms: z.boolean(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) =>
    (await import("./appointments.server")).confirmBooking(await admin(), context.userId, {
      booking_id: data.booking_id,
      slot: data.slot,
      reference: data.reference,
      confirmation_text: data.confirmation_text,
      price_minor: data.price != null ? Math.round(data.price * 100) : null,
      deposit_minor: data.deposit != null ? Math.round(data.deposit * 100) : null,
      cancellation_terms: data.cancellation_terms,
      address: data.address,
      source: "member_online",
      accept_terms: data.accept_terms,
    }),
  );

export const cancelAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ booking_id: z.string().uuid(), step: z.enum(["request", "done"]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const ap = await import("./appointments.server");
    return data.step === "request"
      ? ap.requestCancel(await admin(), context.userId, data.booking_id)
      : ap.completeCancel(await admin(), context.userId, data.booking_id);
  });

export const prepareAppointmentCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        booking_id: z.string().uuid(),
        checkout_url: z.string().url().max(1000),
        amount: z.number().min(0).max(100000).nullable(),
        deposit: z.number().min(0).max(100000).nullable(),
        fee: z.number().min(0).max(100000).nullable(),
        cancellation_terms: z.string().max(300).nullable(),
        expires_in_min: z.number().int().min(1).max(1440).nullable(),
        slot: slot.nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const m = (v: number | null) => (v != null ? Math.round(v * 100) : null);
    return (await import("./appointments.server")).prepareCheckout(await admin(), context.userId, {
      booking_id: data.booking_id,
      checkout_url: data.checkout_url,
      amount_minor: m(data.amount),
      deposit_minor: m(data.deposit),
      fee_minor: m(data.fee),
      cancellation_terms: data.cancellation_terms,
      expires_at: data.expires_in_min
        ? new Date(Date.now() + data.expires_in_min * 60e3).toISOString()
        : null,
      slot: data.slot,
      source: "member",
    });
  });
