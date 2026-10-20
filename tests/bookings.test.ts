import { describe, it, expect } from "vitest";
import {
  canMove,
  containsPaymentCredentials,
  checkoutUrlOk,
  checkoutExpired,
  kindFor,
  normaliseDetails,
  belongsInCalendar,
  bookingCallInstructions,
  BOOKING_VOICE_TOOLS,
} from "../src/lib/appointments";

describe("real-world bookings: payment safety", () => {
  it("detects card numbers (Luhn) and CVV talk, ignores phone numbers and references", () => {
    expect(containsPaymentCredentials("my card is 4242 4242 4242 4242")).toBe(true);
    expect(containsPaymentCredentials("CVV is 123")).toBe(true);
    expect(containsPaymentCredentials("call +44 20 7946 0958")).toBe(false);
    expect(containsPaymentCredentials("Ref BR-55821")).toBe(false);
  });
  it("refuses card data hidden in booking details", () => {
    expect(() => normaliseDetails({ card_message: "Love you 4000056655665556" })).toThrow(
      "payment_details_refused",
    );
    expect(normaliseDetails({ party_size: "4", cuisine: "Italian", junk: "x" })).toEqual({
      party_size: 4,
      cuisine: "Italian",
    });
  });
  it("accepts only https checkout on the provider's site or a recognised hosted checkout", () => {
    expect(
      checkoutUrlOk("https://shop.bloomco.co.uk/checkout/1", "https://www.bloomco.co.uk").ok,
    ).toBe(true);
    expect(
      checkoutUrlOk("https://checkout.stripe.com/c/pay/cs_1", "https://bloomco.co.uk").ok,
    ).toBe(true);
    expect(checkoutUrlOk("http://bloomco.co.uk/pay", "https://bloomco.co.uk")).toEqual({
      ok: false,
      reason: "not_secure",
    });
    expect(checkoutUrlOk("https://bloomco-pay.example.net/x", "https://bloomco.co.uk")).toEqual({
      ok: false,
      reason: "different_site",
    });
    expect(checkoutUrlOk("https://10.0.0.1/pay", null).ok).toBe(false);
  });
  it("phone calls never take card details and ask for a secure link", () => {
    const t = bookingCallInstructions({
      firstName: "Sam",
      service: "table for 2",
      windows: "19:00-20:00",
      maxPrice: null,
      maxMinutes: 6,
      details: "party size: 2",
    });
    expect(t).toMatch(/never give, read out, ask for or accept card numbers/i);
    expect(t).toContain("party size: 2");
    expect(BOOKING_VOICE_TOOLS.map((x) => x.name)).toContain("payment_required");
  });
});

describe("real-world bookings: states", () => {
  it("checkout is a separate state; opening it never confirms; expiry forces a re-check", () => {
    expect(canMove("booking_in_progress", "checkout_ready")).toBe(true);
    expect(canMove("checkout_ready", "confirmed")).toBe(true);
    expect(canMove("checkout_ready", "expired")).toBe(true);
    expect(canMove("expired", "confirmed")).toBe(false);
    expect(canMove("expired", "booking_in_progress")).toBe(true);
    const now = new Date("2026-10-13T12:00:00Z");
    expect(checkoutExpired("2026-10-13T11:59:00Z", null, now)).toBe(true);
    expect(checkoutExpired(null, "2026-10-13T11:40:00Z", now)).toBe(false);
    expect(checkoutExpired(null, "2026-10-13T11:00:00Z", now)).toBe(true);
  });
  it("classifies kinds and keeps orders out of the calendar unless timing matters", () => {
    expect(kindFor("restaurant", "Italian")).toBe("reservation");
    expect(kindFor(null, "flowers for my wife")).toBe("order");
    expect(kindFor(null, "MOT")).toBe("appointment");
    expect(belongsInCalendar("order", {})).toBe(false);
    expect(belongsInCalendar("order", { delivery_window: "before 17:00" })).toBe(true);
    expect(belongsInCalendar("order", { delivery_window: "tomorrow" })).toBe(false);
    expect(belongsInCalendar("reservation", {})).toBe(true);
  });
});

import { redactPaymentCredentials } from "../src/lib/appointments";
describe("card redaction", () => {
  it("removes card number, expiry and CVV but keeps the rest", () => {
    const r = redactPaymentCredentials(
      "Pay with 4242 4242 4242 4242 exp 12/28 cvv 123 thanks, call 07946 095812",
    );
    expect(r).not.toContain("4242 4242");
    expect(r).not.toMatch(/123/);
    expect(r).not.toContain("12/28");
    expect(r).toContain("07946 095812");
  });
});
