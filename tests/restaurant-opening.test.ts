import { describe, expect, it } from "vitest";
import { restaurantOpening } from "@/lib/appointments";

describe("restaurant request details", () => {
  it("uses Ricky's table for four at 9pm today", () => {
    expect(
      restaurantOpening({
        firstName: "Ricky",
        partySize: 4,
        date: "2026-10-18",
        start: "21:00",
        today: "2026-10-18",
      }),
    ).toBe("Hi, can I book a table for Ricky for 4 at 9pm please?");
  });
  it("uses the actual future date and fractional hour", () => {
    expect(
      restaurantOpening({
        firstName: "Sam",
        partySize: 2,
        date: "2026-10-19",
        start: "19:30",
        today: "2026-10-18",
      }),
    ).toBe("Hi, can I book a table for Sam for 2 at 7:30pm on 19 October please?");
  });
  it("does not invent a missing party size", () => {
    expect(
      restaurantOpening({
        firstName: "Ricky",
        partySize: null,
        date: "2026-10-18",
        start: "21:00",
        today: "2026-10-18",
      }),
    ).toBe("Hi, can I book a table for Ricky at 9pm please?");
  });
});
