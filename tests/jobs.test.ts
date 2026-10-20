import { describe, expect, it } from "vitest";
import {
  afterFailure,
  backoffMs,
  canReplay,
  scrubError,
  summariseJobs,
  tickKey,
} from "../src/lib/jobs";

describe("background jobs", () => {
  it("backs off exponentially with a ceiling", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(3)).toBe(240_000);
    expect(backoffMs(30)).toBe(6 * 3600_000);
  });
  it("retries until the ceiling, then dead-letters", () => {
    const now = new Date("2026-10-02T10:00:00Z");
    expect(afterFailure(1, 5, now).status).toBe("retrying");
    expect(afterFailure(1, 5, now).nextAttemptAt!.getTime()).toBe(now.getTime() + 60_000);
    expect(afterFailure(5, 5, now)).toEqual({ status: "dead", nextAttemptAt: null });
    expect(afterFailure(1, 5, now, true).status).toBe("dead");
  });
  it("scrubs personal details and secrets from errors", () => {
    const s = scrubError(
      new Error("failed for jo@x.com +44 7700 900123 key sk_live_abc Bearer tok123"),
    );
    expect(s).not.toMatch(/jo@x|7700|sk_live|tok123/);
  });
  it("only replays replayable dead jobs", () => {
    expect(canReplay("stripe.event", "dead")).toBe(true);
    expect(canReplay("stripe.event", "retrying")).toBe(false);
    expect(canReplay("tick.reminders", "dead")).toBe(false);
  });
  it("gives one tick key per slot", () => {
    const a = new Date("2026-10-02T10:01:00Z"),
      b = new Date("2026-10-02T10:04:59Z"),
      c = new Date("2026-10-02T10:05:00Z");
    expect(tickKey("reminders", a, 300_000)).toBe(tickKey("reminders", b, 300_000));
    expect(tickKey("reminders", a, 300_000)).not.toBe(tickKey("reminders", c, 300_000));
  });
  it("summarises health and lag", () => {
    const now = new Date("2026-10-02T10:00:00Z");
    const s = summariseJobs(
      [
        {
          kind: "stripe.event",
          status: "succeeded",
          next_attempt_at: "",
          created_at: "",
          finished_at: "2026-10-02T09:00:00Z",
          duration_ms: 100,
        },
        {
          kind: "stripe.event",
          status: "retrying",
          next_attempt_at: "2026-10-02T09:20:00Z",
          created_at: "",
          finished_at: null,
          duration_ms: null,
        },
        {
          kind: "email.data_rights",
          status: "dead",
          next_attempt_at: "",
          created_at: "",
          finished_at: null,
          duration_ms: null,
        },
      ],
      now,
    );
    expect(s.dead).toBe(1);
    expect(s.oldestDueMinutes).toBe(40);
    expect(s.healthy).toBe(false);
    expect(s.byKind["stripe.event"]!.avgMs).toBe(100);
  });
});
