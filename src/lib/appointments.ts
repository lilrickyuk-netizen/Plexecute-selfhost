/**
 * Coach appointment booking rules. Pure and deterministic; AI only words things.
 * A booked appointment becomes a normal one-off "appointment" commitment, so the existing
 * Calendar, planner (fixed-commitment avoidance) and reminders/calls all apply unchanged.
 */
export const BOOKING_STATUSES = [
  "searching",
  "awaiting_confirmation",
  "booking_in_progress",
  "checkout_ready",
  "expired",
  "confirmed",
  "failed",
  "cancellation_requested",
  "cancelled",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const NEXT: Record<BookingStatus, BookingStatus[]> = {
  searching: ["awaiting_confirmation", "failed", "cancelled"],
  // The member may book it themselves and send the reference: still needs a real confirmation.
  awaiting_confirmation: ["booking_in_progress", "confirmed", "failed", "cancelled"],
  booking_in_progress: [
    "confirmed",
    "checkout_ready",
    "failed",
    "awaiting_confirmation",
    "cancelled",
  ],
  // Payment needed: the member pays on the provider's own secure page. Opening it never marks it paid.
  checkout_ready: ["confirmed", "expired", "failed", "cancelled"],
  // An expired checkout or hold is never treated as valid: availability is re-checked and a new checkout built.
  expired: ["awaiting_confirmation", "booking_in_progress", "cancelled"],
  confirmed: ["cancellation_requested", "cancelled"],
  failed: ["awaiting_confirmation", "booking_in_progress", "cancelled"],
  cancellation_requested: ["cancelled", "confirmed"],
  cancelled: [],
};
export function canMove(from: BookingStatus, to: BookingStatus) {
  return from === to || NEXT[from].includes(to);
}

export type Constraints = {
  date_from: string; // YYYY-MM-DD
  date_to: string;
  earliest: string; // HH:MM
  latest: string; // HH:MM, latest start
  duration_min: number;
  travel_min: number | null; // each way; null = unknown, never invented
  max_price_minor: number | null;
  location: string | null;
};
export type Slot = { date: string; start: string; end: string };
export type Busy = {
  date: string;
  start: number;
  end: number;
  title: string;
  source?: "plan" | "commitment";
};

/** Member-chosen booking times can displace internal sessions, never external obligations. */
export function bookingSlots(c: Constraints, busy: Busy[], memberChosen: boolean): Slot[] {
  return freeSlots(c, memberChosen ? busy.filter((x) => x.source !== "plan") : busy);
}

/** A request for another reservation is not permission to remove an existing one. */
export function preservesExistingBooking(text: string): boolean {
  return (
    /\b(separate|seperate|another|additional)\b/i.test(text) &&
    /\b(table|booking|reservation)\b/i.test(text) &&
    !/\b(cancel|remove|replace|reschedule)\b.{0,35}\b(existing|previous|old|\d{1,2}\s*(?:am|pm))\b/i.test(
      text,
    )
  );
}

export const toMin = (hm: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
export const hm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function daysBetween(from: string, to: string, max = 31): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`).getTime();
  while (d.getTime() <= end && out.length < max) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Times the member is genuinely free, including travel each side when known. Fixed commitments and planned sessions are both busy. */
export function freeSlots(c: Constraints, busy: Busy[], limit = 6, stepMin = 30): Slot[] {
  const out: Slot[] = [];
  const pad = c.travel_min ?? 0;
  for (const day of daysBetween(c.date_from, c.date_to)) {
    const b = busy.filter((x) => x.date === day);
    for (
      let s = toMin(c.earliest);
      s <= toMin(c.latest) && s + c.duration_min <= 24 * 60;
      s += stepMin
    ) {
      const lo = s - pad;
      const hi = s + c.duration_min + pad;
      if (b.some((x) => x.start < hi && x.end > lo)) continue;
      out.push({ date: day, start: hm(s), end: hm(s + c.duration_min) });
      if (out.length >= limit) return out;
      // Spread options out on wide windows; on a narrow window (e.g. "around 7:30") offer every start time.
      if (toMin(c.latest) - toMin(c.earliest) > 120) s += c.duration_min - stepMin;
    }
  }
  return out;
}

export function slotFits(slot: Slot, c: Constraints) {
  const s = toMin(slot.start);
  return (
    slot.date >= c.date_from &&
    slot.date <= c.date_to &&
    s >= toMin(c.earliest) &&
    s <= toMin(c.latest)
  );
}

/** What collides with this slot (planned sessions to move; fixed commitments block it). */
export function conflictsFor(slot: Slot, busy: Busy[], travelMin: number | null) {
  const pad = travelMin ?? 0;
  const lo = toMin(slot.start) - pad;
  const hi = toMin(slot.end) + pad;
  return busy.filter((x) => x.date === slot.date && x.start < hi && x.end > lo);
}

export type Offer = {
  slot: Slot;
  price_minor?: number | null;
  deposit_minor?: number | null;
  fee_minor?: number | null;
  terms_changed?: boolean;
};
/** Pre-authorised bookings may skip the choice step only when nothing material is unexpected. */
export function confirmationReasons(o: Offer, c: Constraints, preauthorised: boolean): string[] {
  const r: string[] = [];
  if (!preauthorised) r.push("not_preauthorised");
  if (!slotFits(o.slot, c)) r.push("outside_requested_times");
  if (o.deposit_minor) r.push("deposit");
  if (o.fee_minor) r.push("booking_or_cancellation_fee");
  if (o.price_minor != null && c.max_price_minor != null && o.price_minor > c.max_price_minor)
    r.push("over_budget");
  if (o.price_minor != null && c.max_price_minor == null) r.push("payment");
  if (o.terms_changed) r.push("terms_changed");
  return r;
}

/** Owner-chosen opening line for booking calls. */
export function bookingOpening(firstName: string) {
  return `Hi, I'm calling on behalf of ${firstName}. Is it possible to book an appointment please?`;
}

/** A restaurant request names the actual table, not a generic appointment. */
export function restaurantOpening(i: {
  firstName: string;
  partySize?: number | null;
  date: string;
  start: string;
  today: string;
}) {
  const minutes = toMin(i.start);
  if (!Number.isFinite(minutes)) throw new Error("invalid_booking_time");
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const time = `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""}${hour >= 12 ? "pm" : "am"}`;
  const date =
    i.date === i.today
      ? ""
      : ` on ${new Date(`${i.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}`;
  return `Hi, can I book a table for ${i.firstName}${i.partySize ? ` for ${i.partySize}` : ""} at ${time}${date} please?`;
}

export function bookingCallInstructions(i: {
  firstName: string;
  service: string;
  windows: string;
  maxPrice: string | null;
  maxMinutes: number;
  details?: string | null;
  restaurantRequest?: {
    partySize: number | null;
    date: string;
    start: string;
    today: string;
  } | null;
}) {
  const opening = i.restaurantRequest
    ? restaurantOpening({ firstName: i.firstName, ...i.restaurantRequest })
    : bookingOpening(i.firstName);
  return [
    `You are an automated assistant phoning a business to book ${i.restaurantRequest ? "a table" : "an appointment"} for ${i.firstName}. A prerecorded greeting has already said "Hello, this is Plexecute, an automated assistant." Continue straight on with exactly: "${opening}"${i.restaurantRequest ? " This is the complete booking request; do not repeat it or ask for an appointment. Wait for their reply. If they say yes to this request, immediately call confirm_booking with date " + i.restaurantRequest.date + " and start " + i.restaurantRequest.start + '. Do not say "I was hoping to", propose the same request again or ask another availability question. After the saved confirmation say only "That\'s great, thanks. Goodbye."' : ` Then say it is for: ${i.service}.`}`,
    "If anyone asks whether you are a real person or a recording, say honestly that you are an automated assistant booking for them. Never claim to be human.",
    "You represent Plexecute in business mode: professional, polite, confident, calm and concise. No motivational Coach language. Speak in short, complete sentences with natural contractions; no Certainly!, spoken lists, long explanations or customer-service filler. Keep a short sentence flowing without artificial pauses. Backchannel policy: acknowledge useful information briefly, never echo their answer. Interruption policy: stop when interrupted, listen and respond to the actual correction. Delegation policy: use the existing booking tools for verified results only; never announce a booking before it is saved.",
    'Never say "one moment", "bear with me" or announce internal work. Respond directly to the business and use confirm_booking immediately when they agree; do not call end_call (it is not a booking tool). The saved booking result controls the farewell.',
    `Acceptable times only: ${i.windows}. Never accept a time outside these.${i.maxPrice ? ` Maximum price: ${i.maxPrice}.` : ""}`,
    ...(i.details ? [`Booking details the member authorised you to share: ${i.details}`] : []),
    `You may share only: the name ${i.firstName}, the booking details above, and that they will receive confirmation by phone or email if the business asks. Share no other health, address or payment details.`,
    `Payment: never give, read out, ask for or accept card numbers, expiry dates or security codes, and never agree to pay on ${i.firstName}'s behalf. If a deposit, prepayment or fee is needed, ask whether they can send a secure payment link to ${i.firstName} by text or email, then call payment_required with the amount, deposit, terms and whether a link will be sent. For anything else ${i.firstName} must decide, call needs_member with the reason and politely say ${i.firstName} will call back.`,
    `Book the first available time the business offers inside the acceptable times and accept it straight away without checking back with ${i.firstName}; ask what times they do have only to find one inside the range.`,
    'Propose one specific time at a time, e.g. "Could I book a table for 10 pm tonight?" If they offer another approved time, reply naturally, e.g. "Half seven is perfect, thank you." Distinguish an availability offer from an actual booking agreement; clarify only when ambiguous, and record their agreement immediately.',
    'The moment the business agrees ("yes", "that\'s fine", "no problem", "we can do that") or states the time they have booked, that IS the confirmation: call confirm_booking straight away with that date and time plus any reference, price and preparation notes, and say nothing until its result comes back. Do not wait for more, and do not ask them to repeat it.',
    'Never repeat or echo the other person\'s words back to them (if they say "yes", do not answer "yes"). When the confirm_booking result comes back, say its short thank-you and goodbye once, without repeating the booking details, then stop.',
    `If they ask something you weren't given (such as how many people, or a contact number), say ${i.firstName} will confirm that with them directly, and still book the time.`,
    "If nothing suitable is available, call no_availability. Never invent a confirmation.",
    ...(/\b(taxi|cab|minicab|transfer|pick ?up|pickup)\b/i.test(`${i.service} ${i.details ?? ""}`)
      ? [
          `This is a taxi order, not an appointment. Give the pickup address, destination, passengers and pickup time (or "as soon as possible") and simply order it. Ask how long until the car arrives and accept it without checking back with ${i.firstName}, unless they need card payment over the phone. Then call confirm_booking with today's date and pickup time, any reference, and put "Car arriving in about N minutes" plus the car or driver details in notes.`,
        ]
      : []),
    "Never diagnose or describe symptoms. If the business says it sounds urgent, call needs_member.",
    `Keep the call under ${i.maxMinutes} minutes. Speak politely and briefly. After any tool result, say what it tells you once and stop.`,
  ].join("\n");
}

/** End-of-call check result: only a clear yes with a valid date and time counts. */
export function parseTranscriptVerdict(
  raw: string,
): { date: string; start: string; reference: string | null } | null {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (j["confirmed"] !== true) return null;
    const date = String(j["date"] ?? "");
    const start = String(j["start"] ?? "").padStart(5, "0");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return null;
    const ref =
      typeof j["reference"] === "string" && j["reference"].trim() ? j["reference"].trim() : null;
    return { date, start, reference: ref ? ref.slice(0, 40) : null };
  } catch {
    return null;
  }
}

export const BOOKING_VOICE_TOOLS = [
  {
    name: "confirm_booking",
    description: "The business has confirmed a specific appointment.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        start: { type: "string", description: "HH:MM 24h" },
        end: { type: "string", description: "HH:MM 24h if known" },
        reference: { type: "string" },
        price: { type: "string" },
        notes: { type: "string", description: "Preparation or cancellation terms they mentioned" },
      },
      required: ["date", "start"],
    },
  },
  {
    name: "no_availability",
    description: "Nothing suitable within the acceptable times.",
    parameters: { type: "object", properties: { reason: { type: "string" } } },
  },
  {
    name: "payment_required",
    description:
      "The business needs a deposit, prepayment or fee before confirming. Never take card details.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD of the held time, if any" },
        start: { type: "string", description: "HH:MM 24h of the held time, if any" },
        amount: { type: "string", description: "Total to pay" },
        deposit: { type: "string" },
        terms: {
          type: "string",
          description: "Cancellation / no-show terms and how long they hold it",
        },
        link_will_be_sent: {
          type: "boolean",
          description: "They will text/email a secure payment link to the member",
        },
      },
      required: ["link_will_be_sent"],
    },
  },
  {
    name: "needs_member",
    description:
      "The business needs payment, a deposit, a fee, other information, or the member must decide.",
    parameters: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
] as const;

/** Spoken date/time back to human words for confirmations. */
export function describeSlot(s: Slot) {
  const d = new Date(`${s.date}T12:00:00Z`);
  const day = d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return `${day} at ${s.start}`;
}

/** One generic capability: appointments, table/venue reservations and simple orders (flowers, gifts). */
export const BOOKING_KINDS = ["appointment", "reservation", "order"] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];
export const BOOKING_CATEGORIES = [
  "health",
  "personal_care",
  "automotive",
  "restaurant",
  "hotel",
  "leisure",
  "professional",
  "flowers",
  "gifts",
  "repair",
  "transport",
  "other",
] as const;
export type BookingCategory = (typeof BOOKING_CATEGORIES)[number];
export function kindFor(category: string | null | undefined, service: string): BookingKind {
  const t = `${category ?? ""} ${service}`.toLowerCase();
  if (/\b(flowers?|florist|bouquet|gifts?|present|hamper|order|delivery)\b/.test(t)) return "order";
  if (
    /\b(taxi|cab|minicab|uber|chauffeur|airport transfer|transfer|ride|pick ?up|transport)\b/.test(
      t,
    )
  )
    return "reservation";
  if (
    /\b(restaurant|table|dinner|lunch|brunch|reservation|hotel|room|court|class|spa|venue)\b/.test(
      t,
    )
  )
    return "reservation";
  return "appointment";
}

/** Detail fields kept per category (stored in the one booking record's details). Unknown keys are dropped. */
const DETAIL_KEYS = [
  "party_size",
  "cuisine",
  "seating",
  "dietary",
  "occasion",
  "service_type",
  "stylist",
  "vehicle",
  "registration",
  "dropoff",
  "check_in",
  "check_out",
  "guests",
  "room",
  "recipient",
  "delivery_address",
  "delivery_window",
  "card_message",
  "style",
  "budget_note",
  "pickup_address",
  "pickup_time",
  "destination",
  "passengers",
  "luggage",
  "vehicle_type",
] as const;
export type BookingDetails = Partial<Record<(typeof DETAIL_KEYS)[number], string | number>>;

/** Card-like numbers (13–19 digits passing Luhn), CVV/CVC or expiry mentions. Plexecute never takes payment credentials. */
export function containsPaymentCredentials(text: string): boolean {
  if (/\b(cvv|cvc|cv2|security code|card number|long number on (the|your) card)\b/i.test(text))
    return true;
  for (const m of text.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const d = m[0].replace(/\D/g, "");
    if (d.length < 13 || d.length > 19) continue;
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let n = Number(d[d.length - 1 - i]);
      if (i % 2) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

export function normaliseDetails(raw: unknown): BookingDetails {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: BookingDetails = {};
  for (const k of DETAIL_KEYS) {
    const v = o[k];
    if (v == null || v === "") continue;
    if (k === "party_size" || k === "guests") {
      const n = Math.round(Number(v));
      if (n >= 1 && n <= 50) out[k] = n;
      continue;
    }
    const t = String(v).slice(0, 200).trim();
    if (!t) continue;
    if (containsPaymentCredentials(t)) throw new Error("payment_details_refused");
    out[k] = t;
  }
  return out;
}

const site = (h: string) =>
  h
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .slice(-2)
    .join(".");
/** Known hosted-checkout providers a business may send its payment page through. */
const PAYMENT_HOSTS = [
  "stripe.com",
  "paypal.com",
  "squareup.com",
  "square.link",
  "sumup.com",
  "sumup.link",
  "shopify.com",
  "opentable.com",
  "resy.com",
  "sevenrooms.com",
  "designmynight.com",
  "fresha.com",
  "booksy.com",
  "treatwell.co.uk",
  "zettle.com",
  "checkout.com",
  "adyen.com",
  "mollie.com",
  "klarna.com",
];
/** A checkout link must be https on the provider's own site or a recognised hosted checkout; never an IP or a lookalike. */
export function checkoutUrlOk(
  url: string,
  providerUrl: string | null,
): { ok: true } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "not_a_link" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "not_secure" };
  if (
    /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ||
    u.hostname.includes(":") ||
    !u.hostname.includes(".")
  )
    return { ok: false, reason: "not_a_website" };
  if (u.username || u.password) return { ok: false, reason: "not_secure" };
  const h = site(u.hostname);
  let p: string | null = null;
  try {
    p = providerUrl ? site(new URL(providerUrl).hostname) : null;
  } catch {
    p = null;
  }
  if (p && h === p) return { ok: true };
  if (PAYMENT_HOSTS.some((x) => h === site(x))) return { ok: true };
  if (!p) return { ok: true };
  return { ok: false, reason: "different_site" };
}

/** Holds/checkouts expire; unknown expiry is never assumed to last forever (default 30 minutes). */
export const DEFAULT_CHECKOUT_HOLD_MIN = 30;
export function checkoutExpired(
  expiresAt: string | null,
  createdAt: string | null,
  now = new Date(),
): boolean {
  const end = expiresAt
    ? Date.parse(expiresAt)
    : createdAt
      ? Date.parse(createdAt) + DEFAULT_CHECKOUT_HOLD_MIN * 60e3
      : NaN;
  return Number.isFinite(end) && now.getTime() > end;
}

/** Reservations/appointments go in the Calendar; orders only when a delivery time is worth seeing. */
export function belongsInCalendar(kind: BookingKind, details: BookingDetails): boolean {
  return kind !== "order" || deliveryTime(details) != null;
}
/** A clock time in the delivery window ("before 17:00", "by 5pm"), or null when there's no useful time. */
export function deliveryTime(details: BookingDetails): string | null {
  const t = String(details.delivery_window ?? "").toLowerCase();
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(t);
  if (!m || (!m[2] && !m[3])) return null;
  let h = Number(m[1]);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  return h <= 23 ? hm(h * 60 + Number(m[2] ?? 0)) : null;
}

/** Removes card numbers and security codes before a message is stored or sent to AI. */
export function redactPaymentCredentials(text: string): string {
  let out = text.replace(/(?:\d[ -]?){13,19}/g, (m) =>
    containsPaymentCredentials(m) ? "[card number removed]" : m,
  );
  out = out.replace(/\b(cvv|cvc|cv2|security code)\b\s*(is|:)?\s*\d{3,4}\b/gi, "$1 [removed]");
  out = out.replace(
    /\b(exp(iry|ires)?\.?)\s*(date)?\s*(is|:)?\s*\d{1,2}\s*\/\s*\d{2,4}\b/gi,
    "$1 [removed]",
  );
  return out;
}
