import { describe, it, expect } from "vitest";
import { buildBehaviourModel } from "../src/lib/behaviour-model";
const base = {
  tz: "Europe/London",
  now: new Date("2026-09-30T12:00:00Z"),
  events: [],
  checkins: [],
  notifications: [],
  calls: [],
  foodDays: [],
};
const mk = (n: number, hourUtc: number, status: string, startDay = 1) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${hourUtc}-${i}`,
    domain: "training",
    duration_min: 30,
    status,
    starts_at: `2026-09-${String(startDay + i * 4).padStart(2, "0")}T${String(hourUtc).padStart(2, "0")}:00:00Z`,
  }));
describe("behaviour model", () => {
  it("withholds patterns below n>=5 per group", () => {
    const o = buildBehaviourModel({
      ...base,
      blocks: [...mk(4, 6, "done"), ...mk(5, 18, "skipped")],
    }).find((x) => x.key === "completion_time")!;
    expect(o.enough).toBe(false);
  });
  it("withholds patterns under 14 days", () => {
    const blocks = Array.from({ length: 10 }, (_, i) => ({
      id: `x${i}`,
      domain: "training",
      duration_min: 30,
      status: i % 2 ? "done" : "skipped",
      starts_at: `2026-09-0${1 + (i % 5)}T${i < 5 ? "06" : "18"}:00:00Z`,
    }));
    expect(
      buildBehaviourModel({ ...base, blocks }).find((x) => x.key === "completion_time")!.enough,
    ).toBe(false);
  });
  it("states an association with sample once thresholds are met", () => {
    const o = buildBehaviourModel({
      ...base,
      blocks: [...mk(5, 6, "done"), ...mk(5, 18, "skipped", 2)],
    }).find((x) => x.key === "completion_time")!;
    expect(o.enough).toBe(true);
    expect(o.text).toMatch(/associated/);
    expect(o.text).toMatch(/not proof of cause/);
    expect(o.text).toMatch(/5 of 5/);
  });
});
