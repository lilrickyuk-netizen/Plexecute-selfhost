import { describe, expect, it } from "vitest";
import { isCallOrReminderOnly, isRepeatOfRecentRequest } from "../src/lib/coach-scheduling";

describe("call requests from Coach chat", () => {
  it("treats 'call me in 2 minutes' as a call, never a plan rebuild", () => {
    expect(
      isCallOrReminderOnly(
        "I need you to call me at in 2 minutes from now so I can check the oven",
      ),
    ).toBe(true);
    expect(isCallOrReminderOnly("Call me at 9.30 so I don't miss my appointment")).toBe(true);
  });
  it("still allows a rebuild when the member asks for one", () => {
    expect(isCallOrReminderOnly("Rebuild my plan and call me before each session")).toBe(false);
    expect(isCallOrReminderOnly("Move my sessions to the evening")).toBe(false);
  });

  const first = {
    title: "Check the oven",
    start_time: "12:14:00",
    created_at: "2026-10-17T11:12:55Z",
  };
  const now = Date.parse("2026-10-17T11:13:46Z");
  it("a repeated request reuses the first call instead of ringing twice", () => {
    expect(
      isRepeatOfRecentRequest(
        first,
        "Check the oven",
        12 * 60 + 15,
        now,
        "I asked you to call me in 2 minutes from now",
      ),
    ).toBe(true);
  });
  it("'ring me again' is a new call", () => {
    expect(
      isRepeatOfRecentRequest(
        first,
        "Check the oven",
        12 * 60 + 20,
        now,
        "ring me again in 5 minutes",
      ),
    ).toBe(false);
  });
  it("a different item or a time more than 30 minutes away is a new call", () => {
    expect(isRepeatOfRecentRequest(first, "Take out bins", 12 * 60 + 15, now, "")).toBe(false);
    expect(isRepeatOfRecentRequest(first, "Check the oven", 12 * 60 + 50, now, "")).toBe(false);
  });
});
