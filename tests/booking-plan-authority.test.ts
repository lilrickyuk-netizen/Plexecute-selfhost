import { describe, expect, it } from "vitest";
import {
  bookingSlots,
  preservesExistingBooking,
  type Constraints,
  type Busy,
} from "../src/lib/appointments";

const c: Constraints = {
  date_from: "2026-10-18",
  date_to: "2026-10-18",
  earliest: "21:00",
  latest: "21:00",
  duration_min: 90,
  travel_min: null,
  max_price_minor: null,
  location: null,
};
const study: Busy = { date: "2026-10-18", start: 1260, end: 1320, title: "Coding", source: "plan" };
describe("member booking authority", () => {
  it("allows the requested 9pm table instead of the internal coding session", () => {
    expect(bookingSlots(c, [study], true)).toEqual([
      { date: "2026-10-18", start: "21:00", end: "22:30" },
    ]);
    expect(bookingSlots(c, [study], false)).toEqual([]);
  });
  it("keeps external commitments blocking even when the booking has priority", () => {
    expect(bookingSlots(c, [{ ...study, source: "commitment" }], true)).toEqual([]);
  });
  it("a separate table is not authority to remove the existing 7pm table", () => {
    expect(preservesExistingBooking("Yes I know but a seperate table booked for 9pm")).toBe(true);
    expect(preservesExistingBooking("Cancel my existing table and book another table at 9pm")).toBe(
      false,
    );
  });
  it("a 7pm reservation ending at 9pm does not block the separate 9pm table", () => {
    expect(
      bookingSlots(
        c,
        [
          study,
          {
            date: c.date_from,
            start: 1140,
            end: 1260,
            title: "Existing table",
            source: "commitment",
          },
        ],
        true,
      ),
    ).toHaveLength(1);
  });
});
