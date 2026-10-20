import { describe, expect, it } from "vitest";
import { enqueue, flush, type Op, type Store } from "@/lib/outbox";
import { buildGlance } from "@/lib/glance";

const mem = (): Store => {
  let ops: Op[] = [];
  return {
    get: () => ops,
    set: (o) => {
      ops = o;
    },
  };
};

describe("offline outbox (Step 56)", () => {
  it("enqueue is idempotent per id", () => {
    const s = mem();
    enqueue(s, "set", { a: 1 }, "op-1");
    enqueue(s, "set", { a: 2 }, "op-1");
    expect(s.get()).toHaveLength(1);
  });
  it("replays in order, stops on network failure, keeps the op", async () => {
    const s = mem();
    enqueue(s, "food", {}, "a", new Date("2026-01-01T10:00:00Z"));
    enqueue(s, "food", {}, "b", new Date("2026-01-01T10:01:00Z"));
    const seen: string[] = [];
    const r = await flush(
      s,
      async (op) => {
        seen.push(op.id);
        if (op.id === "b") throw new TypeError("Failed to fetch");
      },
      () => true,
    );
    expect(seen).toEqual(["a", "b"]);
    expect(r).toMatchObject({ sent: 1, conflicts: 0, pending: 1 });
    expect(s.get()[0]).toMatchObject({ id: "b", attempts: 1, state: "pending" });
  });
  it("server rejections become visible conflicts, never silent drops", async () => {
    const s = mem();
    enqueue(s, "transition", {}, "x");
    const r = await flush(
      s,
      async () => {
        throw new Error("EXECUTION_TRANSITION_INVALID");
      },
      () => true,
    );
    expect(r.conflicts).toBe(1);
    expect(s.get()[0]).toMatchObject({ state: "conflict", error: "EXECUTION_TRANSITION_INVALID" });
  });
  it("a replayed id that the server already applied clears cleanly", async () => {
    const s = mem();
    enqueue(s, "set", {}, "dup");
    const r = await flush(
      s,
      async () => ({ ok: true, duplicate: true }),
      () => true,
    );
    expect(r.sent).toBe(1);
    expect(s.get()).toHaveLength(0);
  });
});

describe("glance payload (Step 57)", () => {
  const now = new Date("2026-03-02T09:30:00Z");
  const b = (id: string, h: number, status: string) => ({
    id,
    title: `Session ${id}`,
    domain: "training",
    status,
    starts_at: `2026-03-02T${String(h).padStart(2, "0")}:00:00Z`,
    duration_min: 60,
    is_protected: false,
  });
  it("reports live, next, progress and a redacted lock-screen title", () => {
    const g = buildGlance(
      [b("a", 8, "done"), b("c", 9, "started"), b("d", 11, "planned")] as never,
      { now, tz: "Europe/London" },
    );
    expect(g.live?.id).toBe("c");
    expect(g.live?.actions).toEqual(["complete"]);
    expect(g.next?.lockScreenTitle).toBe("Next session");
    expect(g.next?.title).not.toBe(g.next?.lockScreenTitle);
    expect(g.progress.done).toBe(1);
    expect(g.complication).toMatch(/^Now /);
  });
  it("offers no actions while safety pauses accountability", () => {
    const g = buildGlance([b("d", 11, "planned")] as never, { now, tz: "UTC", safetyPaused: true });
    expect(g.next?.actions).toEqual([]);
  });
});
