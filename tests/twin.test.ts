import { describe, expect, it } from "vitest";
import { healthToObservations } from "../src/lib/twin.server";

describe("Life Twin health mapping", () => {
  it("averages sleep/steps, takes latest weight, tags OBSERVED with provenance", () => {
    const o = healthToObservations("apple_health", [
      { kind: "sleep_hours", value: 6, recorded_at: "2026-10-01T06:00:00Z" },
      { kind: "sleep_hours", value: 7, recorded_at: "2026-10-02T06:00:00Z" },
      { kind: "weight_kg", value: 80, recorded_at: "2026-10-01T07:00:00Z" },
      { kind: "weight_kg", value: 79.4, recorded_at: "2026-10-02T07:00:00Z" },
    ]);
    const sleep = o.find((x) => x.fact_key === "avg_sleep_hours")!;
    expect(sleep.value).toBe(6.5);
    expect(sleep.source).toBe("OBSERVED");
    expect(sleep.source_ref).toBe("health:apple_health");
    expect(sleep.observed_at).toBe("2026-10-02T06:00:00Z");
    expect(o.find((x) => x.fact_key === "weight_kg")!.value).toBe(79.4);
    expect(o.some((x) => x.fact_key === "daily_steps")).toBe(false);
  });
});

import { sanitizeInferred } from "../src/lib/twin.server";
describe("Coach inferred facts", () => {
  it("keeps allow-listed, in-range facts and caps confidence", () => {
    const o = sanitizeInferred(
      {
        facts: [
          { key: "avg_sleep_hours", value: "5.5", confidence: 0.95 },
          { key: "avg_sleep_hours", value: 40 },
          { key: "salary", value: 50000 },
          { key: "main_blocker", value: "  kids' bedtime  " },
        ],
      },
      "m1",
    );
    expect(o).toHaveLength(2);
    expect(o[0]).toMatchObject({
      value: 5.5,
      source: "AI_INFERRED",
      confidence: 0.6,
      source_ref: "coach_message:m1",
    });
    expect(o[1]!.value).toBe("kids' bedtime");
  });
});
