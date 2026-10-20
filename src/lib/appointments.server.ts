// Appointment booking service: one implementation for the Appointments screen and the Coach.
// Never reports "booked" without a real confirmation (member-entered reference for online
// bookings, or the business confirming on a phone call). Every step appends an audit event.
import {
  canMove,
  confirmationReasons,
  conflictsFor,
  bookingSlots,
  slotFits,
  toMin,
  hm,
  type BookingStatus,
  type Busy,
  type Constraints,
  type Slot,
  type BookingKind,
  normaliseDetails,
  kindFor,
  containsPaymentCredentials,
  checkoutUrlOk,
  checkoutExpired,
  belongsInCalendar,
  deliveryTime,
  BOOKING_CATEGORIES,
} from "./appointments";

import type { Json } from "@/integrations/supabase/types";

type Db = any;
export type BookingRow = Record<string, unknown> & {
  id: string;
  status: BookingStatus;
  user_id: string;
};

async function event(
  db: Db,
  b: { id: string; user_id: string },
  ev: string,
  from: string | null,
  to: string | null,
  detail: Record<string, unknown> = {},
) {
  await db.from("appointment_booking_events").insert({
    booking_id: b.id,
    user_id: b.user_id,
    event: ev,
    from_status: from,
    to_status: to,
    detail,
  });
}

async function move(
  db: Db,
  b: BookingRow,
  to: BookingStatus,
  patch: Record<string, unknown>,
  ev: string,
  detail: Record<string, unknown> = {},
) {
  if (!canMove(b.status, to))
    throw new Error(`This booking is ${b.status.replace(/_/g, " ")} and can't change that way.`);
  const { error } = await db
    .from("appointment_bookings")
    .update({ status: to, ...patch })
    .eq("id", b.id)
    .eq("status", b.status);
  if (error) throw new Error("The booking could not be updated.");
  await event(db, b, ev, b.status, to, detail);
}

async function getBooking(db: Db, userId: string, id: string): Promise<BookingRow> {
  const { data } = await db
    .from("appointment_bookings")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("That booking was not found.");
  return data as BookingRow;
}

/** Fixed commitments and planned sessions in local time for the date range. */
export async function loadBusy(
  db: Db,
  userId: string,
  from: string,
  to: string,
  tz: string | null,
): Promise<Busy[]> {
  const { daysBetween } = await import("./appointments");
  const { localDayKey, localHm, zonedInstant } = await import("./tz");
  const days = daysBetween(from, to);
  const [{ data: cs }, { data: bl }] = await Promise.all([
    db
      .from("commitments")
      .select("title,recurrence,days,on_date,start_time,end_time,active")
      .eq("user_id", userId)
      .eq("active", true),
    db
      .from("plan_blocks")
      .select("title,starts_at,duration_min,status,source_type")
      .eq("user_id", userId)
      .gte("starts_at", zonedInstant(from, 0, tz).toISOString())
      .lt("starts_at", zonedInstant(to, 24 * 60, tz).toISOString())
      .not("status", "in", "(rescheduled,cancelled)"),
  ]);
  const out: Busy[] = [];
  for (const d of days) {
    const dow = ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    for (const c of cs ?? []) {
      const on = c.recurrence === "once" ? c.on_date === d : (c.days ?? []).includes(dow);
      if (on)
        out.push({
          date: d,
          start: toMin(c.start_time),
          end: toMin(c.end_time),
          title: c.title,
          source: "commitment",
        });
    }
  }
  for (const b of bl ?? []) {
    if (b.source_type === "commitment") continue;
    const t = new Date(b.starts_at);
    const s = toMin(localHm(t, tz));
    out.push({
      date: localDayKey(t, tz),
      start: s,
      end: s + (b.duration_min ?? 30),
      title: b.title,
      source: "plan",
    });
  }
  return out;
}

export type StartInput = {
  service: string;
  request_text?: string | null;
  constraints: Constraints;
  provider_name?: string | null;
  provider_url?: string | null;
  provider_phone?: string | null;
  use_usual?: boolean;
  preauthorised?: boolean;
  idempotency_key: string;
  replaces_booking_id?: string | null;
  kind?: BookingKind | null;
  category?: string | null;
  details?: Record<string, unknown> | null;
  /** The member's own words authorising "just book it" within these constraints (recorded). */
  preauthorisation_text?: string | null;
};

/** Find options: free times from the real schedule plus providers (usual one, named one, or a web search). Idempotent per key. */
// Explicit serialisable result types: optional fields use `| undefined` so the
// union survives exactOptionalPropertyTypes through createServerFn.
export type StartResult =
  | { tier_locked: true; message: string }
  | { safety: true; message: string }
  | { needs_choice: true; message: string; providers: string[] }
  | {
      booking_id: string;
      status: BookingStatus;
      replay: boolean;
      service: string;
      providers: Json;
      free_times: Json;
      failure_reason: string | null;
      note: string;
    };

export type ChooseResult =
  | {
      status: BookingStatus;
      already: true;
      provider_url: string | null;
      note?: string | undefined;
      calling?: boolean | undefined;
    }
  | { status: "booking_in_progress"; provider_url: string | null; clashes: string[]; next: string }
  | { status: "failed"; reason: string; message: string }
  | { error: string; message?: string | undefined };

export type ConfirmResult =
  | { status: "confirmed"; already: true; commitment_id: string | null }
  | {
      status: "confirmed";
      commitment_id: string | null;
      planned_sessions_now_clashing: string[];
      next: string;
    }
  | { error: string; message: string; reasons?: string[] | undefined };

export type CancelResult =
  | { status: "cancelled"; already?: true | undefined; note?: string | undefined }
  | {
      status: "cancellation_requested";
      cancellation_terms: string;
      provider_url: string | null;
      next: string;
    }
  | { error: string };

export async function startBooking(
  db: Db,
  userId: string,
  tz: string | null,
  i: StartInput,
): Promise<StartResult> {
  const { data: prof } = await db.from("profiles").select("tier").eq("id", userId).maybeSingle();
  if ((prof?.tier as string) !== "execute")
    return {
      tier_locked: true,
      message:
        "Appointment booking is part of Execute. Upgrade to have Plexecute find and book appointments for you.",
    };
  const { data: dup } = await db
    .from("appointment_bookings")
    .select("*")
    .eq("user_id", userId)
    .eq("idempotency_key", i.idempotency_key)
    .maybeSingle();
  if (dup) return summarise(dup as BookingRow, true);
  // The same request asked again (new message, same thing) continues the open booking instead of starting a duplicate.
  if (!i.replaces_booking_id) {
    const { data: open } = await db
      .from("appointment_bookings")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["awaiting_confirmation", "booking_in_progress", "checkout_ready"])
      .gte("created_at", new Date(Date.now() - 6 * 3600e3).toISOString())
      .order("created_at", { ascending: false })
      .limit(20);
    const want = i.kind ?? kindFor(i.category, i.service);
    const norm = (t: unknown) =>
      String(t ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const o = ((open ?? []) as BookingRow[]).find((x) => {
      if (x["kind"] !== want) return false;
      // A choice already in progress is continued even if the dates were re-stated; a fresh search needs the same start date.
      if (
        x.status === "awaiting_confirmation" &&
        (x["constraints"] as Constraints | null)?.date_from !== i.constraints.date_from
      )
        return false;
      const pn = norm(x["provider_name"]);
      if (i.provider_name && pn) return pn === norm(i.provider_name);
      return (
        norm(x["service"]) === norm(i.service) ||
        (!!pn && norm(`${i.service} ${i.request_text ?? ""}`).includes(pn))
      );
    });
    if (o) return summarise(o, true);
  }
  const { detectSignals } = await import("./safety");
  const sig = detectSignals(`${i.service} ${i.request_text ?? ""}`);
  if (sig.length) {
    const { recordSafety } = await import("./safety.server");
    await recordSafety(userId, "coach", "input", sig);
    return {
      safety: true,
      message:
        "That sounds like it may need urgent help rather than a routine booking. If it's an emergency call 999 (UK) or 911 (US), or NHS 111 for urgent advice.",
    };
  }
  if (containsPaymentCredentials(`${i.service} ${i.request_text ?? ""}`))
    return {
      safety: true,
      message:
        "Please don't share card details with me. Plexecute never takes payment details: when payment is needed I'll send you the business's secure checkout page to pay yourself.",
    };
  let details: ReturnType<typeof normaliseDetails>;
  try {
    details = normaliseDetails(i.details);
  } catch {
    return {
      safety: true,
      message:
        "Please don't share card details with me. Plexecute never takes payment details: when payment is needed I'll send you the business's secure checkout page to pay yourself.",
    };
  }
  const kind: BookingKind = i.kind ?? kindFor(i.category, i.service);
  const category =
    i.category && (BOOKING_CATEGORIES as readonly string[]).includes(i.category)
      ? i.category
      : null;
  const c = i.constraints;
  const busy = await loadBusy(db, userId, c.date_from, c.date_to, tz);
  // Orders (flowers, gifts) are delivered, not attended: they need no free time in the member's day.
  const memberChosen = !!i.preauthorised || c.earliest === c.latest;
  const slots = kind === "order" ? [] : bookingSlots(c, busy, memberChosen);

  let providers: { name: string; url: string | null; phone: string | null; source: string }[] = [];
  if (i.provider_name)
    providers = [
      {
        name: i.provider_name,
        url: i.provider_url ?? null,
        phone: i.provider_phone ?? null,
        source: "member",
      },
    ];
  else if (i.use_usual) {
    const { data: past } = await db
      .from("appointment_bookings")
      .select("provider_name,provider_url")
      .eq("user_id", userId)
      .ilike("service", i.service)
      .eq("status", "confirmed")
      .not("provider_name", "is", null);
    const names = [...new Set((past ?? []).map((p: { provider_name: string }) => p.provider_name))];
    if (names.length === 1) {
      const p = (past ?? []).find((x: { provider_name: string }) => x.provider_name === names[0]);
      providers = [
        { name: names[0] as string, url: p?.provider_url ?? null, phone: null, source: "history" },
      ];
    } else if (names.length > 1)
      return {
        needs_choice: true,
        message: `You've booked ${i.service} with ${names.join(" and ")} before. Which one?`,
        providers: names.map(String),
      };
  }
  if (!providers.length) {
    const { firecrawl } = await import("./guided-video.server");
    const q =
      `${i.service} ${details.cuisine ?? ""} ${c.location ?? ""} ${kind === "order" ? "order online delivery" : kind === "reservation" ? "book table online" : "book appointment online"}`
        .replace(/\s+/g, " ")
        .trim();
    const hits = await firecrawl(q, userId, 1, "appointment_search").catch(() => []);
    providers = hits.slice(0, 3).map((h) => ({
      name: (h.title ?? h.url).slice(0, 100),
      url: h.url,
      phone: null,
      source: "web_search",
    }));
  }
  const { encryptPhone } = await import("./calling.server");
  const { parseE164 } = await import("./calling");
  const phone = i.provider_phone ? parseE164(i.provider_phone) : null;
  // "The number I gave you": reuse the number from this member's latest booking with the same business.
  let reusedPhoneEnc: string | null = null;
  if (!phone && i.provider_name) {
    const { data: prev } = await db
      .from("appointment_bookings")
      .select("provider_phone_enc,provider_name")
      .eq("user_id", userId)
      .not("provider_phone_enc", "is", null)
      .order("created_at", { ascending: false })
      .limit(20);
    const norm = (x: string) =>
      x
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .replace(/restaurant$/, "");
    reusedPhoneEnc =
      (prev ?? []).find(
        (r: { provider_name: string | null; provider_phone_enc: string | null }) =>
          r.provider_name && norm(r.provider_name) === norm(i.provider_name!),
      )?.provider_phone_enc ?? null;
  }
  const row = {
    user_id: userId,
    idempotency_key: i.idempotency_key,
    service: i.service.slice(0, 80),
    request_text: i.request_text?.slice(0, 400) ?? null,
    constraints: c,
    preauthorised: !!i.preauthorised,
    preauthorisation: i.preauthorised
      ? {
          text: (i.preauthorisation_text ?? i.request_text ?? "").slice(0, 400),
          at: new Date().toISOString(),
          constraints: c,
        }
      : null,
    kind,
    category,
    details,
    status: (providers.length && (slots.length || kind === "order")
      ? "awaiting_confirmation"
      : "failed") as BookingStatus,
    failure_reason:
      !slots.length && kind !== "order"
        ? "no_free_time_in_schedule"
        : !providers.length
          ? "no_providers_found"
          : null,
    options: {
      providers: providers.map((p) => ({ ...p, phone: p.phone ? "on_file" : null })),
      slots,
    },
    provider_name: providers.length === 1 ? providers[0]!.name : null,
    provider_url: providers.length === 1 ? providers[0]!.url : null,
    provider_phone_enc: phone ? await encryptPhone(phone.e164) : reusedPhoneEnc,
    replaces_booking_id: i.replaces_booking_id ?? null,
  };
  const { data: b, error } = await db.from("appointment_bookings").insert(row).select("*").single();
  if (error) {
    const { data: again } = await db
      .from("appointment_bookings")
      .select("*")
      .eq("user_id", userId)
      .eq("idempotency_key", i.idempotency_key)
      .maybeSingle();
    if (again) return summarise(again as BookingRow, true);
    throw new Error("The booking request could not be saved.");
  }
  await event(db, b, "requested", null, b.status, {
    kind,
    category,
    constraints: c,
    providers: providers.length,
    slots: slots.length,
    preauthorised: !!i.preauthorised,
  });
  return summarise(b as BookingRow, false);
}

function summarise(b: BookingRow, replay: boolean) {
  const o = (b["options"] ?? {}) as { providers?: unknown[]; slots?: Slot[] };
  return {
    booking_id: b.id,
    status: b.status,
    replay,
    service: String(b["service"] ?? ""),
    providers: (o.providers ?? []) as Json,
    free_times: (o.slots ?? []) as unknown as Json,
    failure_reason: (b["failure_reason"] as string | null) ?? null,
    note:
      b["kind"] === "order"
        ? "Order: no calendar time is needed. Once the member has picked the shop and given its checkout link and total (or you found them), call prepare_checkout with this booking_id; they pay on that page themselves. Nothing is ordered until they send the confirmation."
        : "Offer the member up to three of these free times and providers. Booking only happens after they choose. If payment or a deposit is needed, use prepare_checkout.",
  };
}

/** Member chose a provider and time. Online: opens the provider's booking page. Phone: Plexecute calls the business. */
export async function chooseOption(
  db: Db,
  userId: string,
  a: {
    booking_id: string;
    provider_index?: number | null;
    slot: Slot;
    method: "online" | "phone";
    provider_phone?: string | null;
    origin: string;
  },
): Promise<ChooseResult> {
  let b = await getBooking(db, userId, a.booking_id);
  // A phone booking whose call has ended without a result is retryable: a request to ring
  // again places a new call instead of being told one is "already in progress".
  if (b.status === "booking_in_progress" && b["method"] === "phone" && a.method === "phone") {
    if (!(await liveBookingCall(db, b.id))) {
      await fail(db, b, "no_confirmation_on_call");
      b = await getBooking(db, userId, a.booking_id);
    }
  }
  // A time without an end (e.g. "11pm") gets the booking's usual length, so the row stays valid.
  if (!/^\d{2}:\d{2}$/.test(a.slot.end ?? "") && /^\d{1,2}:\d{2}$/.test(a.slot.start ?? "")) {
    const st = a.slot.start.padStart(5, "0");
    const dur = ((b["constraints"] as Constraints | null)?.duration_min ?? 60) || 60;
    a = { ...a, slot: { ...a.slot, start: st, end: hm(Math.min(1439, toMin(st) + dur)) } };
  }
  if (
    b.status === "checkout_ready" &&
    checkoutExpired(
      (b["checkout_expires_at"] as string | null) ?? null,
      (b["checkout_created_at"] as string | null) ?? null,
    )
  )
    await expire(db, b);
  if (
    b.status === "booking_in_progress" ||
    b.status === "confirmed" ||
    b.status === "checkout_ready"
  )
    return {
      status: b.status,
      already: true,
      provider_url: (b["provider_url"] as string | null) ?? null,
    };
  const c = b["constraints"] as Constraints;
  if (b["kind"] !== "order" && !slotFits(a.slot, c)) return { error: "outside_requested_times" };
  const { data: tz } = await db
    .from("profiles")
    .select("timezone,tier")
    .eq("id", userId)
    .maybeSingle();
  const clash = conflictsFor(
    a.slot,
    await loadBusy(db, userId, a.slot.date, a.slot.date, tz?.timezone ?? null),
    c.travel_min,
  );
  const fixed = clash.filter((x) => x.title && x.start !== undefined);
  const o = (b["options"] ?? {}) as { providers?: { name: string; url: string | null }[] };
  const p = a.provider_index != null ? o.providers?.[a.provider_index] : null;
  const patch: Record<string, unknown> = {
    method: a.method,
    slot_date: a.slot.date,
    start_time: a.slot.start,
    end_time: a.slot.end,
    ...(p ? { provider_name: p.name, provider_url: p.url } : {}),
  };
  if (a.method === "phone") {
    if (tz?.tier !== "execute")
      return { error: "booking_execute_only", message: "Appointment booking is part of Execute." };
    if (a.provider_phone) {
      const { parseE164 } = await import("./calling");
      const ph = parseE164(a.provider_phone);
      if (!ph) return { error: "phone_must_include_country_code" };
      if (!isBookablePhone(ph.e164))
        return {
          error: "phone_not_bookable",
          message:
            "That number can't be called for a booking (premium-rate or not a UK/US number).",
        };
      patch["provider_phone_enc"] = await (await import("./calling.server")).encryptPhone(ph.e164);
    } else if (!b["provider_phone_enc"])
      return {
        error: "need_provider_phone",
        message: "I need the business's phone number to call them.",
      };
  } else if (!(p?.url ?? b["provider_url"]))
    return {
      error: "no_booking_page",
      message: "I couldn't find a booking page for that provider. I can phone them instead.",
    };
  if (a.method === "phone") {
    const { rateLimit } = await import("./security.server");
    if (!(await rateLimit("booking_call", userId)))
      return {
        error: "booking_call_limit",
        message: "You've reached today's limit for booking calls. Try again tomorrow.",
      };
  }
  await move(
    db,
    b,
    "booking_in_progress",
    patch,
    a.method === "online" ? "online_started" : "phone_started",
    { slot: a.slot, clashes: fixed.map((x) => x.title) },
  );
  if (a.method === "phone")
    return (await placeBookingCall(db, userId, b.id, a.origin)) as ChooseResult;
  return {
    status: "booking_in_progress",
    provider_url: ((p?.url ?? b["provider_url"]) as string | null) ?? null,
    clashes: fixed.map((x) => x.title),
    next: "Open the booking page, book the time, then tell me the confirmation reference so I can add it to your calendar.",
  };
}

/** Record a real confirmation and put the appointment (and known travel) into the member's commitments. Idempotent. */
export async function confirmBooking(
  db: Db,
  userId: string,
  a: {
    booking_id: string;
    slot: Slot;
    reference?: string | null;
    confirmation_text?: string | null;
    price_minor?: number | null;
    deposit_minor?: number | null;
    cancellation_terms?: string | null;
    prep_notes?: string | null;
    address?: string | null;
    source: "member_online" | "phone_call";
    accept_terms?: boolean;
  },
): Promise<ConfirmResult> {
  const b = await getBooking(db, userId, a.booking_id);
  if (b.status === "confirmed")
    return {
      status: "confirmed",
      already: true,
      commitment_id: (b["commitment_id"] as string | null) ?? null,
    };
  if (
    containsPaymentCredentials(
      `${a.reference ?? ""} ${a.confirmation_text ?? ""} ${a.prep_notes ?? ""}`,
    )
  )
    return {
      error: "payment_details_refused",
      message: "Don't send card details. I only need the booking or order reference.",
    };
  if (!a.reference?.trim() && !a.confirmation_text?.trim())
    return {
      error: "confirmation_needed",
      message:
        "I can only mark it booked once you have the confirmation reference or message from them.",
    };
  const c = b["constraints"] as Constraints;
  const reasons = confirmationReasons(
    { slot: a.slot, price_minor: a.price_minor ?? null, deposit_minor: a.deposit_minor ?? null },
    c,
    true,
  )
    .filter(
      (r) =>
        r !== "not_preauthorised" && !(r === "outside_requested_times" && b["kind"] === "order"),
    )
    // Paying the business's own checkout is the member's acceptance of its deposit/price.
    .filter((r) => !(b.status === "checkout_ready" && (r === "deposit" || r === "payment")));
  if (reasons.length && !a.accept_terms)
    return {
      error: "needs_member_confirmation",
      reasons,
      message:
        "This differs from what you asked for (time, price or deposit). Please confirm you accept it.",
    };
  const title = `${b["service"]}${b["provider_name"] ? `: ${b["provider_name"]}` : ""}`.slice(
    0,
    120,
  );
  const kind = (b["kind"] as BookingKind) ?? "appointment";
  const wasCheckout = b.status === "checkout_ready" || b["payment_state"] === "checkout_ready";
  if (!belongsInCalendar(kind, normaliseDetails(b["details"]))) {
    await move(
      db,
      b,
      "confirmed",
      {
        reference: a.reference ?? null,
        price_minor: a.price_minor ?? (b["checkout_amount_minor"] as number | null) ?? null,
        confirmation_source: a.source,
        payment_state: wasCheckout ? "paid_confirmed" : (b["payment_state"] ?? "none"),
      },
      "confirmed",
      { reference: a.reference ?? null, kind, paid: wasCheckout },
    );
    return {
      status: "confirmed",
      commitment_id: null,
      planned_sessions_now_clashing: [],
      next: "Tell the member the order is confirmed with its reference. Nothing was added to their calendar.",
    };
  }
  if (kind === "order") {
    const t = deliveryTime(normaliseDetails(b["details"]))!;
    a = { ...a, slot: { date: a.slot.date, start: t, end: hm(Math.min(1439, toMin(t) + 15)) } };
  }
  const { data: com, error } = await db
    .from("commitments")
    .insert({
      user_id: userId,
      title,
      kind: "appointment",
      recurrence: "once",
      on_date: a.slot.date,
      start_time: a.slot.start,
      end_time: a.slot.end,
      is_hard: true,
      booking_id: b.id,
      location: a.address ?? b["provider_address"] ?? null,
      note:
        [a.reference ? `Ref ${a.reference}` : null, a.prep_notes]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 300) || null,
    })
    .select("id")
    .single();
  if (error || !com) throw new Error("The appointment could not be added to your calendar.");
  if (c.travel_min) {
    const s = toMin(a.slot.start),
      e = toMin(a.slot.end);
    await db.from("commitments").insert([
      {
        user_id: userId,
        title: `Travel to ${b["service"]}`.slice(0, 120),
        kind: "travel",
        recurrence: "once",
        on_date: a.slot.date,
        start_time: hm(Math.max(0, s - c.travel_min)),
        end_time: a.slot.start,
        is_hard: true,
        booking_id: b.id,
      },
      {
        user_id: userId,
        title: `Travel back from ${b["service"]}`.slice(0, 120),
        kind: "travel",
        recurrence: "once",
        on_date: a.slot.date,
        start_time: a.slot.end,
        end_time: hm(Math.min(1439, e + c.travel_min)),
        is_hard: true,
        booking_id: b.id,
      },
    ]);
  }
  await move(
    db,
    b,
    "confirmed",
    {
      slot_date: a.slot.date,
      start_time: a.slot.start,
      end_time: a.slot.end,
      reference: a.reference ?? null,
      price_minor: a.price_minor ?? null,
      deposit_minor: a.deposit_minor ?? null,
      cancellation_terms: a.cancellation_terms ?? null,
      prep_notes: a.prep_notes ?? null,
      provider_address: a.address ?? b["provider_address"] ?? null,
      confirmation_source: a.source,
      commitment_id: com.id,
      payment_state: wasCheckout ? "paid_confirmed" : (b["payment_state"] ?? "none"),
    },
    "confirmed",
    {
      reference: a.reference ?? null,
      has_text: !!a.confirmation_text,
      price_minor: a.price_minor ?? null,
      deposit_minor: a.deposit_minor ?? null,
    },
  );
  // A confirmed reschedule retires the original appointment.
  if (b["replaces_booking_id"])
    await retire(db, userId, String(b["replaces_booking_id"]), "rescheduled");
  const { data: prof } = await db
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  const clashes = (
    await loadBusy(db, userId, a.slot.date, a.slot.date, prof?.timezone ?? null)
  ).filter(
    (x) =>
      x.title !== title &&
      !x.title.startsWith("Travel") &&
      x.start < toMin(a.slot.end) + (c.travel_min ?? 0) &&
      x.end > toMin(a.slot.start) - (c.travel_min ?? 0),
  );
  return {
    status: "confirmed",
    commitment_id: com.id,
    planned_sessions_now_clashing: clashes.map((x) => x.title),
    next: clashes.length
      ? "Tell the member which planned sessions now clash and offer request_replan. Never delete sessions silently. Then ask if they want a reminder or accountability call."
      : "Ask if they want a reminder or an accountability call before it.",
  };
}

/** Remove an appointment's calendar entries and its reminder calls. */
async function retire(db: Db, userId: string, bookingId: string, why: "cancelled" | "rescheduled") {
  const b = await getBooking(db, userId, bookingId).catch(() => null);
  if (!b || b.status === "cancelled") return;
  const { data: coms } = await db
    .from("commitments")
    .select("id")
    .eq("user_id", userId)
    .eq("booking_id", bookingId);
  const ids = (coms ?? []).map((c: { id: string }) => c.id);
  if (ids.length) {
    await db
      .from("scheduled_calls")
      .update({ status: "cancelled", status_reason: `appointment_${why}` })
      .eq("user_id", userId)
      .in("commitment_id", ids)
      .eq("status", "scheduled");
    await db.from("commitments").delete().in("id", ids);
  }
  await db
    .from("appointment_bookings")
    .update({
      status: "cancelled",
      failure_reason: why === "rescheduled" ? "replaced_by_reschedule" : null,
    })
    .eq("id", bookingId);
  await event(db, b, why, b.status, "cancelled", { removed_commitments: ids.length });
}

export type CheckoutResult =
  | {
      status: "checkout_ready";
      already?: boolean | undefined;
      checkout_url: string | null;
      amount_minor: number | null;
      deposit_minor: number | null;
      fee_minor: number | null;
      currency: string;
      expires_at: string;
      summary: string;
      next: string;
    }
  | { error: string; message: string };

/**
 * Payment needed: record the business's own secure checkout page (or that they will text/email one) and hand it to the member.
 * Plexecute never pays, never takes card details and never marks it paid because the page was opened.
 */
export async function prepareCheckout(
  db: Db,
  userId: string,
  a: {
    booking_id: string;
    checkout_url: string | null;
    amount_minor: number | null;
    deposit_minor?: number | null;
    fee_minor?: number | null;
    cancellation_terms?: string | null;
    expires_at?: string | null;
    slot?: Slot | null;
    source: "member" | "coach" | "phone_call";
  },
): Promise<CheckoutResult> {
  let b = await getBooking(db, userId, a.booking_id);
  const { data: prof } = await db
    .from("profiles")
    .select("tier,billing_country")
    .eq("id", userId)
    .maybeSingle();
  if (prof?.tier !== "execute")
    return { error: "booking_execute_only", message: "Bookings and orders are part of Execute." };
  if (
    b.status === "checkout_ready" &&
    !checkoutExpired(
      (b["checkout_expires_at"] as string | null) ?? null,
      (b["checkout_created_at"] as string | null) ?? null,
    )
  )
    return {
      ...checkoutView(b, String(prof?.billing_country === "US" ? "USD" : "GBP")),
      already: true,
    };
  if (b.status === "awaiting_confirmation" || b.status === "expired" || b.status === "failed") {
    await move(db, b, "booking_in_progress", {}, "checkout_started", {});
    b = await getBooking(db, userId, b.id);
  }
  if (b.status !== "booking_in_progress")
    return {
      error: "not_ready",
      message: `This is ${b.status.replace(/_/g, " ")}, so there's nothing to pay.`,
    };
  if (a.checkout_url) {
    const ok = checkoutUrlOk(a.checkout_url, (b["provider_url"] as string | null) ?? null);
    if (!ok.ok)
      return {
        error: `checkout_link_${ok.reason}`,
        message:
          ok.reason === "different_site"
            ? "That payment link isn't on the business's own website or a recognised secure checkout, so I won't send it. Use the link on their site."
            : "That isn't a secure (https) payment page.",
      };
  } else if (a.source !== "phone_call")
    return {
      error: "checkout_link_needed",
      message: "I need the business's secure checkout page link.",
    };
  const terms = a.cancellation_terms?.slice(0, 300) ?? null;
  if (containsPaymentCredentials(`${terms ?? ""}`))
    return { error: "payment_details_refused", message: "Don't send card details." };
  const now = new Date();
  const exp =
    a.expires_at && Date.parse(a.expires_at) > now.getTime()
      ? new Date(a.expires_at)
      : new Date(now.getTime() + 30 * 60e3);
  const currency = prof?.billing_country === "US" ? "USD" : "GBP";
  await move(
    db,
    b,
    "checkout_ready",
    {
      checkout_url: a.checkout_url,
      checkout_amount_minor: a.amount_minor,
      checkout_fee_minor: a.fee_minor ?? null,
      deposit_minor: a.deposit_minor ?? null,
      cancellation_terms: terms ?? b["cancellation_terms"] ?? null,
      checkout_created_at: now.toISOString(),
      checkout_expires_at: exp.toISOString(),
      payment_state: "checkout_ready",
      currency,
      ...(a.slot ? { slot_date: a.slot.date, start_time: a.slot.start, end_time: a.slot.end } : {}),
    },
    "checkout_ready",
    {
      source: a.source,
      amount_minor: a.amount_minor,
      deposit_minor: a.deposit_minor ?? null,
      fee_minor: a.fee_minor ?? null,
      has_link: !!a.checkout_url,
    },
  );
  b = await getBooking(db, userId, b.id);
  const view = checkoutView(b, currency);
  const { enqueueNotification } = await import("./notify.server");
  await enqueueNotification(db, {
    userId,
    category: "DUE",
    intent: "booking_checkout_ready",
    title: "Ready for you to pay",
    body: view.summary.slice(0, 280),
    link: "/app/appointments",
    kind: "system",
    dedupe: ["checkout", b.id, String(b["checkout_created_at"])],
  }).catch(() => undefined);
  return view;
}

function money(minor: number | null | undefined, cur: string) {
  return minor == null ? null : `${cur === "USD" ? "$" : "£"}${(minor / 100).toFixed(2)}`;
}
function checkoutView(
  b: BookingRow,
  currency: string,
): Extract<CheckoutResult, { status: "checkout_ready" }> {
  const cur = String(b["currency"] ?? currency);
  const amount = b["checkout_amount_minor"] as number | null;
  const dep = b["deposit_minor"] as number | null;
  const fee = b["checkout_fee_minor"] as number | null;
  const parts = [
    `${b["provider_name"] ?? "The business"}: ${b["service"]}`,
    b["slot_date"] ? `${b["slot_date"]} ${String(b["start_time"] ?? "").slice(0, 5)}` : null,
    money(amount, cur) ? `total ${money(amount, cur)}` : "amount shown on their page",
    money(dep, cur) ? `deposit ${money(dep, cur)}` : null,
    money(fee, cur) ? `fee ${money(fee, cur)}` : null,
    b["cancellation_terms"] ? `terms: ${b["cancellation_terms"]}` : null,
  ].filter(Boolean);
  return {
    status: "checkout_ready",
    checkout_url: (b["checkout_url"] as string | null) ?? null,
    amount_minor: amount,
    deposit_minor: dep,
    fee_minor: fee,
    currency: cur,
    expires_at: String(b["checkout_expires_at"]),
    summary: parts.join(" · "),
    next: b["checkout_url"]
      ? "Pay on their secure page yourself, then send me the confirmation or reference so I can mark it confirmed."
      : "They'll send you a secure payment link by text or email. Pay there yourself, then send me the confirmation or reference.",
  };
}

async function expire(db: Db, b: BookingRow) {
  await move(db, b, "expired", { payment_state: "expired" }, "checkout_expired", {
    expires_at: b["checkout_expires_at"] ?? null,
  });
}
/** Checkouts past their hold are never shown as still valid. Runs on every read. */
export async function expireStaleCheckouts(db: Db, userId: string) {
  const { data } = await db
    .from("appointment_bookings")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "checkout_ready");
  let n = 0;
  for (const b of (data ?? []) as BookingRow[])
    if (
      checkoutExpired(
        (b["checkout_expires_at"] as string | null) ?? null,
        (b["checkout_created_at"] as string | null) ?? null,
      )
    ) {
      await expire(db, b).catch(() => undefined);
      n++;
    }
  return n;
}

/** Step 1 of cancelling: shows terms and how to cancel with the business. Nothing is removed yet. */
export async function requestCancel(
  db: Db,
  userId: string,
  bookingId: string,
): Promise<CancelResult> {
  const b = await getBooking(db, userId, bookingId);
  if (b.status === "cancelled") return { status: "cancelled", already: true };
  if (b.status !== "confirmed") {
    await move(
      db,
      b,
      "cancelled",
      b["payment_state"] === "checkout_ready" || b["payment_state"] === "expired"
        ? { payment_state: "abandoned" }
        : {},
      "abandoned",
    );
    return {
      status: "cancelled",
      note: "It was never booked, so there's nothing to cancel with the business.",
    };
  }
  await move(db, b, "cancellation_requested", {}, "cancel_requested");
  return {
    status: "cancellation_requested",
    cancellation_terms: String(
      b["cancellation_terms"] ?? "Not known. Check with them before cancelling.",
    ),
    provider_url: (b["provider_url"] as string | null) ?? null,
    next: "Cancel with the business, then confirm here so I remove it from your calendar.",
  };
}
/** Step 2: the member confirms the business cancelled it. Idempotent. */
export async function completeCancel(
  db: Db,
  userId: string,
  bookingId: string,
): Promise<CancelResult> {
  const b = await getBooking(db, userId, bookingId);
  if (b.status === "cancelled") return { status: "cancelled", already: true };
  if (b.status !== "cancellation_requested") return { error: "request_cancel_first" };
  await retire(db, userId, bookingId, "cancelled");
  return { status: "cancelled" };
}

/** Rescheduling starts a linked replacement; the original stays until the new time is confirmed. */
export async function startReschedule(
  db: Db,
  userId: string,
  tz: string | null,
  bookingId: string,
  c: Constraints,
  key: string,
) {
  const b = await getBooking(db, userId, bookingId);
  if (b.status !== "confirmed") return { error: "only_confirmed_appointments_can_be_moved" };
  return startBooking(db, userId, tz, {
    service: String(b["service"]),
    constraints: c,
    provider_name: (b["provider_name"] as string) ?? null,
    provider_url: (b["provider_url"] as string) ?? null,
    idempotency_key: key,
    replaces_booking_id: b.id,
  });
}

/** Phone booking through the existing calling stack: counts against the member's call allowance. */
export async function placeBookingCall(
  guarded: Db,
  userId: string,
  bookingId: string,
  origin: string,
) {
  // Billing/phone tables are off-limits to the Coach's guarded client; this tightly scoped step uses the service client.
  void guarded;
  const db: Db = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  origin = origin || process.env["APP_BASE_URL"] || "";
  const b = await getBooking(db, userId, bookingId);
  const { data: p } = await db.from("profiles").select("tier").eq("id", userId).maybeSingle();
  const tier = p?.tier as string;
  if (tier !== "execute") return fail(db, b, "booking_execute_only");
  const cs = await import("./calling.server");
  if (!cs.callingReady()) return fail(db, b, "calling_not_switched_on");
  if (!(await (await import("./flags.server")).flagOn("calls_outbound")))
    return fail(db, b, "calls_paused");
  if (!(await (await import("./spend.server")).callSpendOk(userId)))
    return fail(db, b, "allowance_used");
  const win = await cs.serviceWindow(db, userId);
  if (await liveBookingCall(db, b.id))
    return {
      status: "booking_in_progress",
      calling: true,
      note: "Plexecute is already on the phone to them for this booking.",
    };
  // One campaign per call attempt, so a retry after an unanswered or unconfirmed call is a real new call.
  const { count: prior } = await db
    .from("call_logs")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", b.id);
  const attempt = (prior ?? 0) + 1;
  const { data: camp, error } = await db
    .from("call_campaigns")
    .insert({
      user_id: userId,
      policy: tier,
      trigger: "booking",
      state: "CALL_CREATED",
      max_attempts: 1,
      attempts: 1,
      service_month_start: win.start.toISOString(),
      dedupe_key: attempt === 1 ? `booking:${b.id}` : `booking:${b.id}:${attempt}`,
      consumed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !camp) {
    // Never leave the booking stuck "in progress" when no call was actually placed.
    if (await liveBookingCall(db, b.id))
      return {
        status: "booking_in_progress",
        calling: true,
        note: "Plexecute is already on the phone to them for this booking.",
      };
    return fail(db, b, "call_failed");
  }
  const { data: log } = await db
    .from("call_logs")
    .insert({
      user_id: userId,
      campaign_id: camp.id,
      booking_id: b.id,
      attempt_no: attempt,
      status: "queued",
    })
    .select("id")
    .single();
  if (!log) return fail(db, b, "call_failed");
  const hold = await (await import("./spend.server")).reserveCall(userId, camp.id, log.id, 420, db);
  if (!hold) {
    await db.from("call_logs").update({ status: "failed" }).eq("id", log.id);
    return fail(db, b, "allowance_used");
  }
  await db.from("appointment_bookings").update({ call_log_id: log.id }).eq("id", b.id);
  try {
    const to = await cs.decryptPhone(String(b["provider_phone_enc"]));
    const { twilioCreateCall } = await import("./integrations.server");
    const sid = await twilioCreateCall(
      to,
      `${origin}/api/public/twilio/voice?log=${log.id}`,
      `${origin}/api/public/twilio/status?log=${log.id}`,
      {
        // Async detection: the business hears Plexecute at once instead of several seconds of silence
        // while Twilio classifies the answer; voicemail is hung up from the callback.
        MachineDetection: "Enable",
        AsyncAmd: "true",
        AsyncAmdStatusCallback: `${origin}/api/public/twilio/amd?log=${log.id}`,
        AsyncAmdStatusCallbackMethod: "POST",
        TimeLimit: String(hold.seconds),
        Timeout: "30",
      },
    );
    await db.from("call_logs").update({ call_sid: sid, status: "initiated" }).eq("id", log.id);
    await event(db, b, "call_placed", b.status, b.status, {});
    return {
      status: "booking_in_progress",
      calling: true,
      note: "Plexecute is phoning them now. I'll only mark it booked if they confirm a time.",
    };
  } catch {
    await db.rpc("settle_call_usage", { _ref: `call:${log.id}`, _seconds: 0 });
    await db.from("call_logs").update({ status: "failed" }).eq("id", log.id);
    return fail(db, b, "call_failed");
  }
}

/** A booking call that is still ringing or connected (started in the last 10 minutes and not ended). */
async function liveBookingCall(db: Db, bookingId: string): Promise<boolean> {
  const { data } = await db
    .from("call_logs")
    .select("id")
    .eq("booking_id", bookingId)
    .in("status", ["queued", "initiated", "ringing", "in-progress", "answered"])
    .gte("created_at", new Date(Date.now() - 10 * 60000).toISOString())
    .limit(1);
  return !!data?.length;
}

async function fail(db: Db, b: BookingRow, reason: string) {
  const fresh = await getBooking(db, b.user_id, b.id);
  if (fresh.status !== "failed" && canMove(fresh.status, "failed"))
    await move(db, fresh, "failed", { failure_reason: reason }, "failed", { reason });
  const msg: Record<string, string> = {
    calls_not_on_free: "Phone booking is part of Pro and Execute.",
    calling_not_switched_on: "Phone booking isn't switched on yet.",
    calls_paused: "Calls are paused right now.",
    allowance_used:
      "You've used this month's included calls. Book online, or on Execute add call time in Billing.",
    call_failed: "The call couldn't be placed.",
    no_answer: "They didn't answer. Nothing was booked.",
    no_availability: "They had nothing in your times. Nothing was booked.",
  };
  return {
    status: "failed",
    reason,
    message: msg[reason] ?? "Booking didn't complete. Nothing was booked.",
  };
}

/** Voice tool outcomes from a booking call. Only confirm_booking within the approved times creates an appointment. */
export async function bookingVoiceOutcome(
  db: Db,
  logId: string,
  tool: string,
  args: Record<string, unknown>,
) {
  const { data: log } = await db
    .from("call_logs")
    .select("user_id,booking_id")
    .eq("id", logId)
    .maybeSingle();
  if (!log?.booking_id) return "No booking on this call.";
  let b = await getBooking(db, log.user_id, log.booking_id);
  if (tool === "confirm_booking") {
    // The call-ended webhook can mark it "no confirmation" a moment before the call's own result lands.
    if (b.status === "failed" && b["failure_reason"] === "no_confirmation_on_call") {
      await move(db, b, "booking_in_progress", { failure_reason: null }, "phone_result", {});
      b = await getBooking(db, log.user_id, log.booking_id);
    }
    const c = b["constraints"] as Constraints;
    const date = String(args["date"] ?? "");
    const start = String(args["start"] ?? "").padStart(5, "0");
    const slot = {
      date,
      start,
      end: /^\d{1,2}:\d{2}$/.test(String(args["end"] ?? ""))
        ? String(args["end"]).padStart(5, "0")
        : hm(toMin(start) + c.duration_min),
    };
    const taxi = b["category"] === "transport";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (!taxi && !slotFits(slot, c)))
      return "That time is not one the member approved. Politely decline it and ask for another time in the approved window, or say they'll call back.";
    const price = Number(String(args["price"] ?? "").replace(/[^\d.]/g, "")) || null;
    const r = await confirmBooking(db, log.user_id, {
      booking_id: b.id,
      slot,
      reference: (args["reference"] as string) || null,
      confirmation_text: `Confirmed by phone with the business for ${date} ${start}`,
      price_minor: price ? Math.round(price * 100) : null,
      prep_notes: (args["notes"] as string)?.slice(0, 300) ?? null,
      accept_terms: taxi,
      source: "phone_call",
    });
    if ("error" in r) {
      await move(
        db,
        await getBooking(db, log.user_id, b.id),
        "awaiting_confirmation",
        {},
        "needs_member",
        { reasons: (r as { reasons?: string[] }).reasons ?? [] },
      ).catch(() => undefined);
      return "Don't confirm. Say the member will call back to confirm, thank them, and say goodbye.";
    }
    await tellMember(
      db,
      log.user_id,
      b,
      "confirmed",
      `${describeTime(slot)}${args["reference"] ? `, reference ${String(args["reference"]).slice(0, 40)}` : ""}`,
    );
    return `Booked. Do not repeat the booking details. Say exactly: "That's great, thank you very much. Goodbye." Then stop.`;
  }
  if (tool === "payment_required") {
    const n = (v: unknown) => {
      const x = Number(String(v ?? "").replace(/[^\d.]/g, ""));
      return x > 0 ? Math.round(x * 100) : null;
    };
    const date = String(args["date"] ?? "");
    const start = String(args["start"] ?? "").padStart(5, "0");
    const c = b["constraints"] as Constraints;
    const slot =
      /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(start)
        ? { date, start, end: hm(toMin(start) + c.duration_min) }
        : null;
    if (!args["link_will_be_sent"]) {
      await move(
        db,
        b,
        "awaiting_confirmation",
        { failure_reason: "payment_needed_no_link" },
        "needs_member",
        { reason: "payment by card over the phone only" },
      ).catch(() => undefined);
      return "Say the member will pay directly with them and will call back. Never take card details. Thank them and say goodbye.";
    }
    await prepareCheckout(db, log.user_id, {
      booking_id: b.id,
      checkout_url: null,
      amount_minor: n(args["amount"]),
      deposit_minor: n(args["deposit"]),
      cancellation_terms: (args["terms"] as string)?.slice(0, 300) ?? null,
      slot,
      source: "phone_call",
    }).catch(() => undefined);
    return "Thank them, confirm they will send the payment link to the member, and say goodbye.";
  }
  if (tool === "needs_member") {
    await move(
      db,
      b,
      "awaiting_confirmation",
      { failure_reason: String(args["reason"] ?? "needs_member").slice(0, 200) },
      "needs_member",
      { reason: String(args["reason"] ?? "").slice(0, 200) },
    ).catch(() => undefined);
    return "Say the member will call back to arrange it, thank them, and say goodbye.";
  }
  await fail(db, b, "no_availability");
  return "Thank them and say goodbye.";
}

function describeTime(slot: { date: string; start: string }) {
  const [h, m] = slot.start.split(":").map(Number);
  const ap = h! >= 12 ? "pm" : "am";
  const h12 = h! % 12 || 12;
  const day = new Date(`${slot.date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${ap} on ${day}`;
}

/** The member always hears how a booking call went: in the app, and as a push prompt where enabled. */
export async function tellMember(
  db: Db,
  userId: string,
  b: BookingRow,
  outcome: "confirmed" | "not_confirmed" | "no_answer" | "needs_member" | "payment_required",
  detail = "",
) {
  const who = (b["provider_name"] as string | null) ?? "The business";
  const title =
    outcome === "confirmed"
      ? `Booked: ${who}`
      : outcome === "payment_required"
        ? `Payment needed: ${who}`
        : outcome === "needs_member"
          ? `Your decision needed: ${who}`
          : outcome === "no_answer"
            ? `${who} didn't answer`
            : `${who} didn't confirm`;
  const body =
    outcome === "confirmed"
      ? `Confirmed on the phone for ${detail}. It's in your calendar.`
      : outcome === "payment_required"
        ? "The business needs payment. Nothing is confirmed yet; pay them directly on their secure page."
        : outcome === "needs_member"
          ? "The business needs your decision before this can be confirmed. Check your booking details."
          : outcome === "no_answer"
            ? "Nothing was booked. Ask Coach to ring again or try another time."
            : "They didn't confirm a time, so nothing was booked. Ask Coach to ring again.";
  // Stable UUID per call outcome: retries cannot create duplicate Coach messages.
  const hash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`booking_call:${b.id}:${String(b["call_log_id"] ?? "")}:${outcome}`),
    ),
  );
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(hash.slice(0, 16), (x) => x.toString(16).padStart(2, "0")).join("");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const { error } = await db.from("coach_messages").upsert(
    {
      id,
      user_id: userId,
      role: "assistant",
      mode: "COACH",
      content: `${title}. ${body}`,
      tool_trace: [{ tool: "booking_call_result", ok: true, booking_id: b.id, outcome }],
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error) throw new Error("Could not save the booking result to Coach.");
  const { enqueueNotification } = await import("./notify.server");
  await enqueueNotification(db, {
    userId,
    category: "DUE",
    intent: `booking_call_${outcome}`,
    title: title.slice(0, 120),
    body,
    link: "/app/appointments",
    kind: "system",
    dedupe: ["booking_call", b.id, outcome, String(b["call_log_id"] ?? "")],
  });
}

/** Deterministic spoken close from the persisted booking, independent of either live voice. */
export async function bookingCallSignoff(db: Db, logId: string): Promise<string> {
  const { data: log } = await db
    .from("call_logs")
    .select("user_id,booking_id")
    .eq("id", logId)
    .maybeSingle();
  if (!log?.booking_id) return "Thank you for your time. Goodbye.";
  const b = await getBooking(db, log.user_id, log.booking_id);
  if (b.status === "confirmed" && b["slot_date"] && b["start_time"])
    return "That's great, thank you very much. Goodbye.";
  if (b.status === "checkout_ready")
    return "Thank you very much. The member will pay you directly using your secure payment page. Goodbye.";
  if (b.status === "awaiting_confirmation")
    return "Thank you for your help. The member will contact you directly to finish arranging this. Goodbye.";
  return "I'm sorry, I can't complete this booking on the call. Thank you for your time. Goodbye.";
}

/** Call ended: if it never produced a confirmation, say so truthfully. */
export async function bookingCallEnded(db: Db, bookingId: string, status: string) {
  // Give the voice session's own result (including the end-of-call transcript check) time to land.
  if (status === "completed") await new Promise((r) => setTimeout(r, 8000));
  const { data: b } = await db
    .from("appointment_bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();
  if (!b || b.method !== "phone") return;
  if (b.status === "confirmed") {
    await tellMember(
      db,
      b.user_id,
      b as BookingRow,
      "confirmed",
      describeTime({ date: b.slot_date, start: b.start_time.slice(0, 5) }),
    );
    return;
  }
  if (b.status === "checkout_ready" || b.status === "awaiting_confirmation") {
    await tellMember(
      db,
      b.user_id,
      b as BookingRow,
      b.status === "checkout_ready" ? "payment_required" : "needs_member",
    );
    return;
  }
  if (b.status === "failed") {
    await tellMember(
      db,
      b.user_id,
      b as BookingRow,
      b.failure_reason === "no_answer" ? "no_answer" : "not_confirmed",
    );
    return;
  }
  if (b.status !== "booking_in_progress") return;
  const reason = status === "completed" ? "no_confirmation_on_call" : "no_answer";
  await fail(db, b as BookingRow, reason);
  await tellMember(
    db,
    b.user_id,
    b as BookingRow,
    reason === "no_answer" ? "no_answer" : "not_confirmed",
  );
}

/**
 * Safety net for a booking call that ended without the voice recording an outcome: reads the call's
 * own words and confirms only when the business clearly agreed a specific time. The same
 * window/price checks as a live confirmation apply; the words themselves are not stored.
 */
export async function settleBookingFromTranscript(
  db: Db,
  logId: string,
  lines: { who: "business" | "assistant"; text: string }[],
): Promise<"confirmed" | "none"> {
  const text = lines
    .map((l) => `${l.who === "business" ? "Business" : "Assistant"}: ${l.text.trim()}`)
    .filter((l) => l.length > 12)
    .join("\n")
    .slice(-6000);
  const key = (process.env["GEMINI_API_KEY"] || process.env["GEMINI_LIVE_API_KEY"]);
  if (!text || !key) return "none";
  const { data: log } = await db
    .from("call_logs")
    .select("user_id,booking_id")
    .eq("id", logId)
    .maybeSingle();
  if (!log?.booking_id) return "none";
  const b = await getBooking(db, log.user_id, log.booking_id);
  if (b.status === "confirmed") return "confirmed";
  const c = b["constraints"] as Constraints;
  const model = "google/gemini-3.8-flash";
  const res = await (
    await import("./metered-ai.server")
  )
    .meteredAiFetch(
      log.user_id,
      "booking_call_check",
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `A phone call where an assistant tried to book "${b["service"]}" for dates ${c.date_from} to ${c.date_to}. Decide whether the BUSINESS clearly agreed a specific booking (e.g. the assistant proposed a time and the business said yes, or the business stated the booked time). Reply JSON {"confirmed":boolean,"date":"YYYY-MM-DD"|null,"start":"HH:MM"|null,"reference":string|null}. 24-hour time; "tonight"/"today" means ${c.date_from}. If unclear, refused, or only availability was discussed, confirmed=false. Never guess.`,
            },
            { role: "user", content: text },
          ],
        }),
      },
    )
    .catch(() => null);
  const { recordAiUsage } = await import("./usage.server");
  if (!res?.ok) {
    await recordAiUsage(log.user_id, "booking_call_check", model, null, false);
    return "none";
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  await recordAiUsage(log.user_id, "booking_call_check", model, j);
  const { parseTranscriptVerdict } = await import("./appointments");
  const v = parseTranscriptVerdict(j.choices?.[0]?.message?.content ?? "");
  if (!v) return "none";
  const reply = await bookingVoiceOutcome(db, logId, "confirm_booking", {
    date: v.date,
    start: v.start,
    reference: v.reference ?? "",
  });
  return /^Booked/.test(reply) ? "confirmed" : "none";
}

export async function bookingCallContext(db: Db, logId: string) {
  const { data: log } = await db
    .from("call_logs")
    .select("user_id,booking_id")
    .eq("id", logId)
    .maybeSingle();
  if (!log?.booking_id) return null;
  const b = await getBooking(db, log.user_id, log.booking_id);
  const { data: p } = await db
    .from("profiles")
    .select("display_name,billing_country,timezone")
    .eq("id", log.user_id)
    .maybeSingle();
  const c = b["constraints"] as Constraints;
  const first = String(p?.display_name ?? "the member").split(" ")[0] || "the member";
  const { describeSlot } = await import("./appointments");
  const chosen = b["slot_date"]
    ? describeSlot({
        date: String(b["slot_date"]),
        start: String(b["start_time"]).slice(0, 5),
        end: "",
      })
    : null;
  const windows = `${chosen ? `ideally ${chosen}; otherwise ` : ""}between ${c.earliest} and ${c.latest} start, from ${c.date_from} to ${c.date_to}`;
  const sym = p?.billing_country === "US" ? "$" : "£";
  const details = normaliseDetails(b["details"]);
  const isRestaurant =
    b["category"] === "restaurant" ||
    /\b(table|restaurant|dinner|lunch|brunch)\b/i.test(String(b["service"]));
  const { localDayKey } = await import("./tz");
  return {
    userId: log.user_id as string,
    firstName: first,
    service: String(b["service"]),
    windows,
    restaurantRequest: isRestaurant
      ? {
          partySize: typeof details.party_size === "number" ? details.party_size : null,
          date: String(b["slot_date"] ?? c.date_from),
          start: String(b["start_time"] ?? c.earliest).slice(0, 5),
          today: localDayKey(new Date(), p?.timezone ?? "Europe/London"),
        }
      : null,
    maxPrice: c.max_price_minor != null ? `${sym}${(c.max_price_minor / 100).toFixed(2)}` : null,
    details:
      Object.entries(normaliseDetails(b["details"]))
        .filter(
          ([k]) =>
            !["registration", "delivery_address", "recipient", "card_message"].includes(k) ||
            b["kind"] === "order" ||
            b["category"] === "automotive",
        )
        .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
        .join("; ") || null,
  };
}

/** UK/US business numbers only; premium-rate, personal-rate and short-code ranges are refused. */
export function isBookablePhone(e164: string): boolean {
  const d = e164.replace(/[^+\d]/g, "");
  if (/^\+44\d{9,10}$/.test(d)) return !/^\+44(9|70|87|118)/.test(d);
  if (/^\+1[2-9]\d{9}$/.test(d)) return !/^\+1(900|976)/.test(d);
  return false;
}
