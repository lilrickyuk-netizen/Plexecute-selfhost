import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseE164 } from "../src/lib/calling";
import { crisisResources, safetyMessage } from "../src/lib/safety";
import { zonedInstant, localHm, localDayKey, inQuietHours } from "../src/lib/tz";
import { resolveDay, parseTime } from "../src/lib/coach-scheduling";
import { buildCalendarItems } from "../src/lib/calendar-items";

describe("UK and US markets", () => {
  it("recognises UK, US and Canadian numbers as their own markets", () => {
    expect(parseE164("+44 7700 900123")?.country).toBe("GB");
    expect(parseE164("+1 (212) 555-0100")?.country).toBe("US");
    expect(parseE164("+1 416 555 0100")?.country).toBe("CA");
    expect(parseE164("07700 900123")).toBeNull();
  });
  it("gives UK and US crisis numbers by time zone", () => {
    expect(crisisResources("Europe/London")?.emergency).toBe("999");
    expect(crisisResources("America/Los_Angeles")?.emergency).toBe("911");
    expect(crisisResources("America/Indiana/Indianapolis")?.crisis).toMatch(/988/);
    expect(crisisResources("Europe/Paris")).toBeNull();
  });
  it("keeps 14:00 local through each market's own clock change", () => {
    // UK ends BST 25 Oct 2026, US ends DST 1 Nov 2026
    for (const [tz, before, after] of [
      ["Europe/London", "2026-10-24", "2026-10-26"],
      ["America/New_York", "2026-10-31", "2026-11-02"],
      ["America/Los_Angeles", "2026-10-31", "2026-11-02"],
    ] as const) {
      for (const d of [before, after]) {
        const t = zonedInstant(d, 14 * 60, tz);
        expect(localHm(t, tz)).toBe("14:00");
        expect(localDayKey(t, tz)).toBe(d);
      }
      expect(zonedInstant(after, 840, tz).getTime() - zonedInstant(before, 840, tz).getTime()).toBe(
        49 * 3600e3,
      );
    }
  });
  it("applies quiet hours in each user's own time", () => {
    const t = new Date("2026-10-13T03:00:00Z"); // 04:00 London, 23:00 New York
    expect(inQuietHours(t, "22:00", "07:00", "Europe/London")).toBe(true);
    expect(inQuietHours(t, "22:00", "07:00", "America/New_York")).toBe(true);
    expect(
      inQuietHours(new Date("2026-10-13T20:00:00Z"), "22:00", "07:00", "America/Los_Angeles"),
    ).toBe(false);
  });
  it("shows a US call in US local time on the Calendar", () => {
    const items = buildCalendarItems(
      {
        commitments: [],
        blocks: [],
        goals: [],
        milestones: [],
        calls: [
          { id: "x", call_at: "2026-10-13T18:30:00Z", purpose: "Dentist", status: "scheduled" },
        ],
      },
      "2026-10-13",
      "2026-10-13",
      "America/New_York",
    );
    expect(items[0]?.start).toBe("14:30");
  });
  it("checkout sends a real true/false for automatic tax and collects the address", () => {
    const s = readFileSync("src/lib/billing.functions.ts", "utf8");
    expect(s).not.toMatch(/\? "true" : undefined/);
    expect(s).toMatch(/billing_address_collection/);
  });
  it("resolves Coach phrases the same way in any market", () => {
    expect(resolveDay("tomorrow", "2026-10-12")).toBe("2026-10-13");
    expect(resolveDay("friday", "2026-10-12")).toBe("2026-10-16");
    expect(parseTime("2 PM")).toBe(840);
    expect(parseTime("9")).not.toBeNull();
  });
  it("caller ID can be set per market", () => {
    expect(readFileSync("src/lib/integrations.server.ts", "utf8")).toMatch(/TWILIO_FROM_NUMBER_US/);
  });
});

describe("US dollar pricing", () => {
  it("derives the billing market from the member's time zone", async () => {
    const { marketForTimezone } = await import("../src/lib/billing");
    expect(marketForTimezone("America/New_York")).toBe("US");
    expect(marketForTimezone("America/Anchorage")).toBe("US");
    expect(marketForTimezone("US/Pacific")).toBe("US");
    expect(marketForTimezone("Europe/London")).toBe("GB");
    expect(marketForTimezone(null)).toBe("GB");
  });
  it("uses the same amounts in dollars, with separate Stripe price env vars", async () => {
    const { PRODUCTS, VOICE_TOPUP, priceEnvFor, priceAmount, money } =
      await import("../src/lib/billing");
    expect(PRODUCTS.pro.month.cents).toBe(PRODUCTS.pro.month.pence);
    expect(PRODUCTS.execute.month.cents).toBe(PRODUCTS.execute.month.pence);
    expect(VOICE_TOPUP.cents).toBe(VOICE_TOPUP.pence);
    expect(priceEnvFor("execute", "month", "US")).toBe("STRIPE_PRICE_EXECUTE_USD");
    expect(priceEnvFor("execute", "month", "GB")).toBe("STRIPE_PRICE_EXECUTE");
    expect(priceEnvFor("pro", "year", "US")).toBe("STRIPE_PRICE_PRO_ANNUAL_USD");
    expect(priceAmount("execute", "month", "US")).toBe(5999);
    expect(money(5999, "US")).toBe("$59.99");
    expect(money(5999, "GB")).toBe("£59.99");
  });
  it("maps US-dollar Stripe prices back to the right tier", () => {
    const s = readFileSync("src/lib/integrations.server.ts", "utf8");
    for (const v of [
      "STRIPE_PRICE_PRO_USD",
      "STRIPE_PRICE_PRO_ANNUAL_USD",
      "STRIPE_PRICE_EXECUTE_USD",
      "STRIPE_PRICE_EXECUTE_ANNUAL_USD",
    ])
      expect(s).toContain(v);
  });
  it("checkout picks the price by the member's market", () => {
    const s = readFileSync("src/lib/billing.functions.ts", "utf8");
    expect(s).toMatch(/marketFor\(/);
    expect(s).toMatch(/priceEnvFor\(data\.tier, data\.interval, market\)/);
  });
  it("the Execute reward works in both currencies", async () => {
    const { REWARD, REWARD_CURRENCIES, invoiceConfirmsCredit } = await import("../src/lib/reward");
    expect(REWARD.amountPence).toBe(1000);
    expect(REWARD_CURRENCIES).toContain("usd");
    const inv = {
      status: "paid",
      billing_reason: "subscription_cycle",
      subscription: "sub_1",
      starting_balance: -1000,
      ending_balance: 0,
      period_start_unix: Math.floor(new Date("2026-11-01T00:00:00Z").getTime() / 1000),
      currency: "usd",
    };
    expect(
      invoiceConfirmsCredit(inv, {
        subscription_id: "sub_1",
        period_end: "2026-11-01T00:00:00Z",
        provider_credit_ref: "cbtxn_1",
      }),
    ).toBe(true);
    const s = readFileSync("src/lib/reward.server.ts", "utf8");
    expect(s).toMatch(/marketFor\(/);
  });
  it("trial disclosure speaks the member's currency", async () => {
    const { trialDisclosure } = await import("../src/lib/billing");
    expect(trialDisclosure("pro", "month", new Date(), "US").autoRenew).toContain("$23.99");
    expect(trialDisclosure("pro", "month", new Date(), "GB").autoRenew).toContain("£23.99");
  });
});
