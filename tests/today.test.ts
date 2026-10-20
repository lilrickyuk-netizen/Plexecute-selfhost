import { describe, expect, it } from "vitest";
import { summariseToday } from "../src/lib/today";

const base = { domain: "fitness", is_protected: false, duration_min: 30 };
const now = new Date("2026-10-01T12:00:00Z").getTime();

describe("summariseToday", () => {
  it("empty day", () => expect(summariseToday([], now).status).toBe("empty"));
  it("next is the earliest open block not yet ended; overdue flags behind", () => {
    const s = summariseToday(
      [
        { ...base, id: "a", title: "A", status: "planned", starts_at: "2026-10-01T08:00:00Z" },
        { ...base, id: "b", title: "B", status: "planned", starts_at: "2026-10-01T15:00:00Z" },
        { ...base, id: "c", title: "C", status: "done", starts_at: "2026-10-01T07:00:00Z" },
        { ...base, id: "d", title: "D", status: "rescheduled", starts_at: "2026-10-01T09:00:00Z" },
      ],
      now,
    );
    expect(s.next?.id).toBe("b");
    expect(s.status).toBe("behind");
    expect(s.total).toBe(3);
    expect(s.pct).toBe(33);
  });
  it("complete when nothing open", () => {
    const s = summariseToday(
      [{ ...base, id: "c", title: "C", status: "done", starts_at: "2026-10-01T07:00:00Z" }],
      now,
    );
    expect(s.status).toBe("complete");
  });
});
