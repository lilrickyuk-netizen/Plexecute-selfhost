import { describe, it, expect } from "vitest";
import { repairDay } from "../src/lib/recovery-mode";
const b = (
  id: string,
  start: number,
  duration: number,
  o: Partial<Parameters<typeof repairDay>[0]["blocks"][number]> = {},
) => ({
  id,
  goal_id: "g" + id,
  title: "S" + id,
  domain: "learning",
  start,
  duration,
  status: "planned",
  is_protected: false,
  source_type: "goal",
  ...o,
});
const base = {
  nowMin: 600,
  blockedUntilMin: 600,
  sleepMin: 1380,
  wakeMin: 420,
  busy: [] as [number, number][],
  todayKey: "2026-10-01",
  reason: "overran" as const,
};
describe("recovery mode", () => {
  it("freezes done, protected and commitments", () => {
    const r = repairDay({
      ...base,
      blockedUntilMin: 1300,
      goals: [],
      blocks: [
        b("1", 500, 30, { status: "done" }),
        b("2", 900, 30, { is_protected: true }),
        b("3", 1000, 30, { goal_id: null, source_type: "commitment" }),
      ],
    });
    expect(r.items.every((i) => i.action === "frozen")).toBe(true);
  });
  it("moves after the blocking event and keeps the hour before bed free", () => {
    const r = repairDay({ ...base, blockedUntilMin: 1200, goals: [], blocks: [b("1", 700, 60)] });
    expect(r.items[0]!.action).toBe("moved");
    expect(r.items[0]!.toStart! + r.items[0]!.toDuration!).toBeLessThanOrEqual(1320);
  });
  it("shortens when only part fits and defers when nothing fits", () => {
    const r = repairDay({
      ...base,
      blockedUntilMin: 1270,
      goals: [],
      blocks: [b("1", 700, 60), b("2", 800, 60)],
    });
    expect(r.items.map((i) => i.action).sort()).toEqual(["deferred", "shortened"]);
  });
  it("places must-do before optional and keeps hard exercise away from bedtime", () => {
    const r = repairDay({
      ...base,
      blockedUntilMin: 1140,
      goals: [
        { id: "g2", priority: 1, is_protected: false, deadline: null },
        { id: "g1", priority: 3, is_protected: false, deadline: null },
      ],
      blocks: [b("1", 700, 60), b("2", 800, 60), b("3", 900, 45, { domain: "training" })],
    });
    expect(r.items.find((i) => i.id === "2")!.action).not.toBe("deferred");
    expect(r.items.find((i) => i.id === "3")!.action).toBe("deferred");
  });
});
