import { describe, expect, it, vi } from "vitest";
import { bookingCallSignoff, bookingCallEnded, tellMember } from "@/lib/appointments.server";

const enqueue = vi.hoisted(() => vi.fn().mockResolvedValue(["in_app"]));
vi.mock("@/lib/notify.server", () => ({ enqueueNotification: enqueue }));

function database(status = "confirmed") {
  const booking = {
    id: "booking",
    user_id: "member",
    method: "phone",
    status,
    provider_name: "Rachel's",
    slot_date: "2026-10-16",
    start_time: "23:00:00",
    call_log_id: "call",
  };
  const messages = new Map<string, Record<string, unknown>>();
  const db = {
    from: (table: string) => {
      const row = table === "call_logs" ? { user_id: "member", booking_id: "booking" } : booking;
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: row }),
        upsert: async (m: Record<string, unknown>) => {
          if (!messages.has(String(m.id))) messages.set(String(m.id), m);
          return { error: null };
        },
      };
      return q;
    },
  };
  return { db, booking, messages };
}

describe("booking call delivery", () => {
  it("ends a confirmed booking call with a thank-you goodbye, not the confirmation details", async () => {
    const { db } = database();
    const line = await bookingCallSignoff(db, "call");
    expect(line).not.toContain("11 pm");
    expect(line).not.toContain("booked");
    expect(line).toBe("That's great, thank you very much. Goodbye.");
  });
  it("never announces a booking when confirmation is missing", async () => {
    const { db } = database("booking_in_progress");
    expect(await bookingCallSignoff(db, "call")).not.toContain("that's booked");
  });
  it("automatically saves exactly one Coach result per call outcome, including webhook retries", async () => {
    const { db, booking, messages } = database();
    await tellMember(db, "member", booking, "confirmed", "11 pm on Friday 16 October");
    await bookingCallEnded(db, "booking", "busy");
    expect(messages.size).toBe(1);
    expect([...messages.values()][0]?.user_id).toBe("member");
    expect([...messages.values()][0]?.content).toContain("11 pm");
    expect(enqueue).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ userId: "member", intent: "booking_call_confirmed" }),
    );
  });
  it("a new call attempt gets its own outcome message", async () => {
    const { db, booking, messages } = database();
    await tellMember(db, "member", booking, "confirmed", "11 pm");
    await tellMember(
      db,
      "member",
      { ...booking, call_log_id: "second-call" },
      "confirmed",
      "11 pm",
    );
    expect(messages.size).toBe(2);
  });
});
