import { CalendarCheck } from "lucide-react";
import { FeatureHeader } from "@/components/FeatureHeader";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listAppointments,
  findAppointment,
  chooseAppointment,
  confirmAppointment,
  cancelAppointment,
  prepareAppointmentCheckout,
} from "@/lib/appointments.functions";
import { describeSlot, type Slot } from "@/lib/appointments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaidGate } from "@/components/PaidGate";

export const Route = createFileRoute("/_authenticated/app/appointments")({
  head: () => ({
    meta: [
      { title: "Bookings | Plexecute" },
      {
        name: "description",
        content:
          "Book appointments, reserve tables and prepare orders around your real schedule. You always pay on the business's own secure page.",
      },
      { property: "og:title", content: "Bookings | Plexecute" },
      {
        property: "og:description",
        content:
          "Appointments, reservations and orders booked online or by phone with Plexecute Execute.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AppointmentsPage,
});

const STATUS: Record<string, string> = {
  searching: "Searching",
  awaiting_confirmation: "Choose a time",
  booking_in_progress: "Booking in progress",
  checkout_ready: "Waiting for you to pay",
  expired: "Checkout expired",
  confirmed: "Booked",
  failed: "Not booked",
  cancellation_requested: "Cancelling",
  cancelled: "Cancelled",
};

type Booking = {
  id: string;
  service: string;
  status: string;
  method: string | null;
  options: { providers?: { name: string; url: string | null }[]; slots?: Slot[] } | null;
  provider_name: string | null;
  provider_url: string | null;
  slot_date: string | null;
  start_time: string | null;
  end_time: string | null;
  reference: string | null;
  failure_reason: string | null;
  cancellation_terms: string | null;
  has_phone?: boolean;
  kind?: string;
  details?: Record<string, string | number> | null;
  checkout_url?: string | null;
  checkout_amount_minor?: number | null;
  checkout_fee_minor?: number | null;
  checkout_expires_at?: string | null;
  deposit_minor?: number | null;
  currency?: string | null;
  payment_state?: string;
  constraints?: { date_from?: string } | null;
};
const money = (m: number | null | undefined, cur?: string | null) =>
  m == null ? null : `${cur === "USD" ? "$" : "£"}${(m / 100).toFixed(2)}`;
const KINDS = [
  ["appointment", "Appointment", "Dentist, barber, MOT, physio"],
  ["reservation", "Table or venue", "Restaurant, hotel, court, class"],
  ["order", "Order", "Flowers, gifts, delivered"],
] as const;

function AppointmentsPage() {
  const list = useServerFn(listAppointments);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["appointments"], queryFn: () => list() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["appointments"] });
  return (
    <PaidGate cap="appointment_booking" title="Appointments">
      <div className="member-bookings-page">
        <FeatureHeader
          title="Bookings"
          icon={CalendarCheck}
          description="Appointments, table reservations and simple orders. Plexecute finds times that fit your calendar. Nothing is booked until you choose, and it's only marked booked once there's a real confirmation. When payment is needed you pay on the business's own secure page: Plexecute never takes card details. You can also just ask the Coach."
        />
        <NewBooking onDone={refresh} />
        <ul className="mt-6 space-y-3">
          {((data ?? []) as unknown as Booking[]).map((b) => (
            <BookingCard key={b.id} b={b} onDone={refresh} />
          ))}
        </ul>
        {data && !data.length && (
          <p className="mt-6 text-sm text-muted-foreground">No bookings yet.</p>
        )}
      </div>
    </PaidGate>
  );
}

function NewBooking({ onDone }: { onDone: () => void }) {
  const find = useServerFn(findAppointment);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    service: "",
    date_from: today,
    date_to: today,
    earliest: "09:00",
    latest: "17:00",
    duration: "30",
    location: "",
    provider: "",
    url: "",
    phone: "",
    maxPrice: "",
    travel: "",
    how: "online" as "online" | "phone",
    kind: "appointment" as "appointment" | "reservation" | "order",
    party: "",
    cuisine: "",
    dietary: "",
    occasion: "",
    recipient: "",
    address: "",
    window: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="mt-6 space-y-3 rounded-[20px] border border-border bg-card p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = (await find({
            data: {
              service: f.service,
              date_from: f.date_from,
              date_to: f.date_to,
              earliest: f.earliest,
              latest: f.latest,
              duration_min: Number(f.duration) || 30,
              travel_min: f.travel ? Number(f.travel) : null,
              max_price: f.maxPrice ? Number(f.maxPrice) : null,
              location: f.location || null,
              provider_name: f.provider || null,
              provider_url: f.url || null,
              provider_phone: f.phone || null,
              key: crypto.randomUUID(),
              kind: f.kind,
              category:
                f.kind === "order"
                  ? /gift|present/i.test(f.service)
                    ? "gifts"
                    : "flowers"
                  : f.kind === "reservation" &&
                      /restaurant|table|dinner|lunch|brunch/i.test(f.service)
                    ? "restaurant"
                    : null,
              details: Object.fromEntries(
                Object.entries(
                  f.kind === "reservation"
                    ? {
                        party_size: f.party ? Number(f.party) : "",
                        cuisine: f.cuisine,
                        dietary: f.dietary,
                        occasion: f.occasion,
                      }
                    : f.kind === "order"
                      ? {
                          recipient: f.recipient,
                          delivery_address: f.address,
                          delivery_window: f.window,
                          card_message: f.note,
                        }
                      : {},
                ).filter(([, v]) => v !== ""),
              ),
            },
          })) as { message?: string; failure_reason?: string | null };
          if (r.message) toast(r.message);
          else if (r.failure_reason)
            toast.error(
              r.failure_reason === "no_free_time_in_schedule"
                ? "You have no free time in those hours."
                : "No providers found. Add one by name.",
            );
          onDone();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't search.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-semibold">New booking</h2>
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Type
        </p>
        <div role="radiogroup" aria-label="What are you booking?" className="member-segments">
          {KINDS.map(([k, l]) => (
            <button
              type="button"
              role="radio"
              aria-selected={f.kind === k}
              key={k}
              onClick={() =>
                setF({ ...f, kind: k, duration: k === "reservation" ? "90" : f.duration })
              }
            >
              {l}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {KINDS.find(([k]) => k === f.kind)?.[2]}
        </p>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Booked how
        </p>
        <div role="radiogroup" aria-label="How should Plexecute book?" className="member-segments">
          {(
            [
              ["online", "Book online"],
              ["phone", "Book by phone call"],
            ] as const
          ).map(([k, l]) => (
            <button
              type="button"
              role="radio"
              aria-selected={f.how === k}
              key={k}
              onClick={() => setF({ ...f, how: k })}
            >
              {l}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {f.how === "online"
            ? "Uses the business's own booking page."
            : "Plexecute phones them for you."}
        </p>
      </div>
      <Input
        required
        placeholder={
          f.kind === "order"
            ? "What? e.g. flowers for my wife"
            : f.kind === "reservation"
              ? "What? e.g. Italian restaurant table"
              : "What for? e.g. dentist check-up"
        }
        value={f.service}
        onChange={set("service")}
        aria-label="Appointment type"
      />
      {f.kind === "reservation" && (
        <div className="grid grid-cols-2 gap-2">
          <Input
            inputMode="numeric"
            placeholder="Party size"
            value={f.party}
            onChange={set("party")}
            aria-label="Party size"
          />
          <Input
            placeholder="Cuisine (optional)"
            value={f.cuisine}
            onChange={set("cuisine")}
            aria-label="Cuisine"
          />
          <Input
            placeholder="Dietary needs to share (optional)"
            value={f.dietary}
            onChange={set("dietary")}
            aria-label="Dietary needs"
          />
          <Input
            placeholder="Occasion (optional)"
            value={f.occasion}
            onChange={set("occasion")}
            aria-label="Occasion"
          />
        </div>
      )}
      {f.kind === "order" && (
        <div className="grid gap-2">
          <Input
            placeholder="Recipient name"
            value={f.recipient}
            onChange={set("recipient")}
            aria-label="Recipient"
          />
          <Input
            placeholder="Delivery address (only shared with the business for this order)"
            value={f.address}
            onChange={set("address")}
            aria-label="Delivery address"
          />
          <Input
            placeholder="Delivery time, if it matters (e.g. before 17:00)"
            value={f.window}
            onChange={set("window")}
            aria-label="Delivery time"
          />
          <Input
            placeholder="Card message (optional)"
            value={f.note}
            onChange={set("note")}
            aria-label="Card message"
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-muted-foreground">
          {f.kind === "order" ? "Deliver from" : "From"}
          <Input type="date" value={f.date_from} onChange={set("date_from")} />
        </label>
        <label className="text-xs text-muted-foreground">
          {f.kind === "order" ? "Deliver by" : "To"}
          <Input type="date" value={f.date_to} onChange={set("date_to")} />
        </label>
        {f.kind !== "order" && (
          <>
            <label className="text-xs text-muted-foreground">
              Earliest start
              <Input type="time" value={f.earliest} onChange={set("earliest")} />
            </label>
            <label className="text-xs text-muted-foreground">
              Latest start
              <Input type="time" value={f.latest} onChange={set("latest")} />
            </label>
            <label className="text-xs text-muted-foreground">
              Length (minutes)
              <Input inputMode="numeric" value={f.duration} onChange={set("duration")} />
            </label>
            <label className="text-xs text-muted-foreground">
              Travel each way (minutes, optional)
              <Input inputMode="numeric" value={f.travel} onChange={set("travel")} />
            </label>
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-muted-foreground">
          Area or postcode (optional)
          <Input
            placeholder="e.g. Manchester M1"
            value={f.location}
            onChange={set("location")}
            aria-label="Area"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Business name (optional)
          <Input
            placeholder="e.g. Smith Dental"
            value={f.provider}
            onChange={set("provider")}
            aria-label="Provider name"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Their booking page (optional)
          <Input
            placeholder="https://…"
            value={f.url}
            onChange={set("url")}
            aria-label="Booking page"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Their phone {f.how === "phone" ? "(required)" : "(optional)"}
          <Input
            required={f.how === "phone"}
            type="tel"
            placeholder="With country code, e.g. +44…"
            value={f.phone}
            onChange={set("phone")}
            aria-label="Provider phone"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Maximum price (optional)
          <Input
            placeholder="e.g. 50"
            inputMode="decimal"
            value={f.maxPrice}
            onChange={set("maxPrice")}
            aria-label="Maximum price"
          />
        </label>
      </div>
      <Button type="submit" disabled={busy || !f.service}>
        {busy
          ? "Searching…"
          : f.kind === "order"
            ? "Find where to order"
            : f.how === "phone"
              ? "Find times, then call"
              : "Find times"}
      </Button>
    </form>
  );
}

function BookingCard({ b, onDone }: { b: Booking; onDone: () => void }) {
  const choose = useServerFn(chooseAppointment);
  const confirm = useServerFn(confirmAppointment);
  const cancel = useServerFn(cancelAppointment);
  const providers = b.options?.providers ?? [];
  const slots = b.options?.slots ?? [];
  const [pi, setPi] = useState(0);
  const [si, setSi] = useState(0);
  const [ref, setRef] = useState("");
  const [phone, setPhone] = useState("");
  const checkout = useServerFn(prepareAppointmentCheckout);
  const [co, setCo] = useState({ url: "", amount: "", deposit: "", fee: "", terms: "", hold: "" });
  const isOrder = b.kind === "order";
  const orderSlot: Slot = {
    date: b.constraints?.date_from ?? new Date().toISOString().slice(0, 10),
    start: "00:00",
    end: "00:00",
  };
  const chosen: Slot | null = b.slot_date
    ? {
        date: b.slot_date,
        start: (b.start_time ?? "").slice(0, 5),
        end: (b.end_time ?? "").slice(0, 5),
      }
    : null;
  const run = async (fn: () => Promise<unknown>) => {
    try {
      const r = (await fn()) as {
        message?: string;
        error?: string;
        provider_url?: string;
        next?: string;
        planned_sessions_now_clashing?: string[];
      };
      if (r.provider_url) window.open(r.provider_url, "_blank", "noopener");
      if (r.message) toast(r.message);
      else if (r.error) toast.error(r.error.replace(/_/g, " "));
      if (r.planned_sessions_now_clashing?.length)
        toast(
          `Now clashing: ${r.planned_sessions_now_clashing.join(", ")}. Ask the Coach to replan.`,
        );
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work.");
    }
  };
  return (
    <li className="rounded-[16px] border border-border bg-card p-4 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <b>
          {b.service}
          {b.provider_name ? ` · ${b.provider_name}` : ""}
        </b>
        <span className="text-xs text-muted-foreground">{STATUS[b.status] ?? b.status}</span>
      </div>
      {b.details && Object.keys(b.details).length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {Object.entries(b.details)
            .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
            .join(" · ")}
        </p>
      )}
      {chosen && !isOrder && (
        <p className="mt-1">
          {describeSlot(chosen)}
          {b.reference ? ` · Ref ${b.reference}` : ""}
        </p>
      )}
      {b.status === "failed" && b.failure_reason && (
        <p className="mt-1 text-muted-foreground">
          Not booked: {b.failure_reason.replace(/_/g, " ")}.
        </p>
      )}

      {b.status === "awaiting_confirmation" && slots.length > 0 && (
        <div className="mt-3 space-y-2">
          {providers.length > 1 && (
            <select
              className="w-full rounded-md border border-border bg-background p-2"
              value={pi}
              onChange={(e) => setPi(Number(e.target.value))}
              aria-label="Provider"
            >
              {providers.map((p, i) => (
                <option key={i} value={i}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <select
            className="w-full rounded-md border border-border bg-background p-2"
            value={si}
            onChange={(e) => setSi(Number(e.target.value))}
            aria-label="Time"
          >
            {slots.map((s, i) => (
              <option key={i} value={i}>
                {describeSlot(s)}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                run(() =>
                  choose({
                    data: {
                      booking_id: b.id,
                      provider_index: providers.length ? pi : null,
                      slot: slots[si]!,
                      method: "online",
                      provider_phone: null,
                      confirm: true,
                      origin: window.location.origin,
                    },
                  }),
                )
              }
            >
              Book online
            </Button>
            <Input
              className="max-w-[12rem]"
              placeholder={b.has_phone ? "Number saved" : "Their phone (+44…)"}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-label="Business phone"
            />
            <Button
              size="sm"
              variant={b.has_phone ? "default" : "outline"}
              disabled={!phone.trim() && !b.has_phone}
              onClick={() =>
                run(() =>
                  choose({
                    data: {
                      booking_id: b.id,
                      provider_index: providers.length ? pi : null,
                      slot: slots[si]!,
                      method: "phone",
                      provider_phone: phone || null,
                      confirm: true,
                      origin: window.location.origin,
                    },
                  }),
                )
              }
            >
              Book by phone call
            </Button>
          </div>
        </div>
      )}

      {b.status === "awaiting_confirmation" && isOrder && providers.length > 0 && (
        <div className="mt-3 space-y-2">
          <select
            className="w-full rounded-md border border-border bg-background p-2"
            value={pi}
            onChange={(e) => setPi(Number(e.target.value))}
            aria-label="Shop"
          >
            {providers.map((p, i) => (
              <option key={i} value={i}>
                {p.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            onClick={() =>
              run(() =>
                choose({
                  data: {
                    booking_id: b.id,
                    provider_index: pi,
                    slot: orderSlot,
                    method: "online",
                    provider_phone: null,
                    confirm: true,
                    origin: window.location.origin,
                  },
                }),
              )
            }
          >
            Prepare this order
          </Button>
        </div>
      )}
      {b.status === "expired" && (
        <div className="mt-3 space-y-2">
          <p className="text-muted-foreground">
            The checkout or hold ran out, so it is not booked. Availability needs checking again.
          </p>
          <Button
            size="sm"
            onClick={() =>
              run(() =>
                choose({
                  data: {
                    booking_id: b.id,
                    provider_index: null,
                    slot: chosen ?? orderSlot,
                    method: "online",
                    provider_phone: null,
                    confirm: true,
                    origin: window.location.origin,
                  },
                }),
              )
            }
          >
            Check again and rebuild checkout
          </Button>
        </div>
      )}
      {b.status === "checkout_ready" && (
        <div
          role="group"
          className="mt-3 space-y-2 rounded-xl border border-border p-3"
          aria-label="Payment handoff"
        >
          <p>
            <b>Ready for you to pay</b>
            {money(b.checkout_amount_minor, b.currency)
              ? ` · total ${money(b.checkout_amount_minor, b.currency)}`
              : " · amount shown on their page"}
            {money(b.deposit_minor, b.currency)
              ? ` · deposit ${money(b.deposit_minor, b.currency)}`
              : ""}
            {money(b.checkout_fee_minor, b.currency)
              ? ` · fee ${money(b.checkout_fee_minor, b.currency)}`
              : ""}
          </p>
          {b.cancellation_terms && (
            <p className="text-xs text-muted-foreground">Terms: {b.cancellation_terms}</p>
          )}
          {b.checkout_expires_at && (
            <p className="text-xs text-muted-foreground">
              Held until{" "}
              {new Date(b.checkout_expires_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
              . After that it must be checked again.
            </p>
          )}
          {b.checkout_url ? (
            <a
              className="inline-block rounded-[10px] bg-primary px-3 py-2 text-primary-foreground"
              href={b.checkout_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Pay on their secure page
            </a>
          ) : (
            <p>They'll text or email you a secure payment link.</p>
          )}
          <p className="text-xs text-muted-foreground">
            You pay the business directly. Opening the page doesn't mark it paid: send the
            confirmation below once done.
          </p>
          <Input
            placeholder="Confirmation or order reference"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            aria-label="Confirmation reference"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!ref.trim()}
              onClick={() =>
                run(() =>
                  confirm({
                    data: {
                      booking_id: b.id,
                      slot: chosen ?? orderSlot,
                      reference: ref.trim(),
                      confirmation_text: null,
                      price: null,
                      deposit: null,
                      cancellation_terms: null,
                      address: null,
                      accept_terms: false,
                    },
                  }),
                )
              }
            >
              I've paid: confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => run(() => cancel({ data: { booking_id: b.id, step: "request" } }))}
            >
              I won't pay: cancel
            </Button>
          </div>
        </div>
      )}
      {b.status === "booking_in_progress" && b.method === "online" && (chosen || isOrder) && (
        <details className="mt-3 rounded-xl border border-border p-3">
          <summary className="cursor-pointer">Payment needed? Add their checkout page</summary>
          <div className="mt-2 grid gap-2">
            <Input
              placeholder="Their secure checkout link (https://…)"
              value={co.url}
              onChange={(e) => setCo({ ...co, url: e.target.value })}
              aria-label="Checkout link"
            />
            <div className="grid grid-cols-3 gap-2">
              <Input
                inputMode="decimal"
                placeholder="Total"
                value={co.amount}
                onChange={(e) => setCo({ ...co, amount: e.target.value })}
                aria-label="Total"
              />
              <Input
                inputMode="decimal"
                placeholder="Deposit"
                value={co.deposit}
                onChange={(e) => setCo({ ...co, deposit: e.target.value })}
                aria-label="Deposit"
              />
              <Input
                inputMode="decimal"
                placeholder="Fee"
                value={co.fee}
                onChange={(e) => setCo({ ...co, fee: e.target.value })}
                aria-label="Fee"
              />
            </div>
            <Input
              placeholder="Cancellation / no-show terms (optional)"
              value={co.terms}
              onChange={(e) => setCo({ ...co, terms: e.target.value })}
              aria-label="Terms"
            />
            <Input
              inputMode="numeric"
              placeholder="How long they hold it, minutes (optional)"
              value={co.hold}
              onChange={(e) => setCo({ ...co, hold: e.target.value })}
              aria-label="Hold minutes"
            />
            <Button
              size="sm"
              disabled={!co.url.trim()}
              onClick={() =>
                run(() =>
                  checkout({
                    data: {
                      booking_id: b.id,
                      checkout_url: co.url.trim(),
                      amount: co.amount ? Number(co.amount) : null,
                      deposit: co.deposit ? Number(co.deposit) : null,
                      fee: co.fee ? Number(co.fee) : null,
                      cancellation_terms: co.terms || null,
                      expires_in_min: co.hold ? Number(co.hold) : null,
                      slot: chosen,
                    },
                  }),
                )
              }
            >
              Save checkout
            </Button>
          </div>
        </details>
      )}
      {b.status === "booking_in_progress" && b.method === "online" && (chosen || isOrder) && (
        <div className="mt-3 space-y-2">
          {b.provider_url && (
            <a className="underline" href={b.provider_url} target="_blank" rel="noreferrer">
              Open their booking page
            </a>
          )}
          <Input
            placeholder="Confirmation reference they gave you"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            aria-label="Confirmation reference"
          />
          <Button
            size="sm"
            disabled={!ref.trim()}
            onClick={() =>
              run(() =>
                confirm({
                  data: {
                    booking_id: b.id,
                    slot: chosen ?? orderSlot,
                    reference: ref.trim(),
                    confirmation_text: null,
                    price: null,
                    deposit: null,
                    cancellation_terms: null,
                    address: null,
                    accept_terms: false,
                  },
                }),
              )
            }
          >
            It's booked
          </Button>
        </div>
      )}
      {b.status === "booking_in_progress" && b.method === "phone" && (
        <p className="mt-2 text-muted-foreground">
          Plexecute is phoning them. It's only marked booked if they confirm a time.
        </p>
      )}

      {b.status === "confirmed" && (
        <div className="mt-3 flex gap-2">
          {(!isOrder || b.details?.["delivery_window"]) && (
            <Link to="/app/calendar" className="text-sm underline">
              See in Calendar
            </Link>
          )}
          {b.payment_state === "paid_confirmed" && (
            <span className="text-xs text-muted-foreground">Paid by you and confirmed</span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => run(() => cancel({ data: { booking_id: b.id, step: "request" } }))}
          >
            {isOrder ? "Cancel order" : "Cancel"}
          </Button>
        </div>
      )}
      {b.status === "cancellation_requested" && (
        <div className="mt-3 space-y-2">
          <p>Cancellation terms: {b.cancellation_terms ?? "not known, check with them first"}.</p>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => run(() => cancel({ data: { booking_id: b.id, step: "done" } }))}
          >
            I've cancelled with them: remove it
          </Button>
        </div>
      )}
    </li>
  );
}
