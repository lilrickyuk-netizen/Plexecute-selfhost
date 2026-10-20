import { describe, it, expect } from "vitest";
import { dedupe, filterByPermission, sanitiseCategories, hashToken } from "../src/lib/health";
describe("health", () => {
  it("refuses categories not granted", () => {
    const r = filterByPermission(
      [{ kind: "steps" as const }, { kind: "weight_kg" as const }, { kind: "hrv_ms" as const }],
      ["steps", "heart_rate"],
    );
    expect(r.ok.map((s) => s.kind)).toEqual(["steps", "hrv_ms"]);
    expect(r.refused.length).toBe(1);
  });
  it("sanitises categories", () =>
    expect(sanitiseCategories(["sleep", "bogus"])).toEqual(["sleep"]));
  const ex = [
    {
      id: "a",
      kind: "steps",
      recorded_at: "2026-10-01T08:00:00Z",
      end_at: null,
      provider_event_id: "p1",
      source: "apple_health",
    },
  ];
  it("matches exact provider id first", () =>
    expect(
      dedupe(
        { kind: "steps", value: 1, recorded_at: "2026-10-02T08:00:00Z", provider_event_id: "p1" },
        "apple_health",
        ex,
      ),
    ).toEqual({ action: "update", id: "a" }));
  it("flags cross-source overlap as possible duplicate, keeps both", () =>
    expect(
      dedupe(
        { kind: "steps", value: 1, recorded_at: "2026-10-01T08:02:00Z" },
        "health_connect",
        ex,
      ),
    ).toEqual({ action: "insert", possibleDuplicate: true }));
  it("new reading inserts cleanly", () =>
    expect(
      dedupe({ kind: "steps", value: 1, recorded_at: "2026-10-03T08:00:00Z" }, "apple_health", ex),
    ).toEqual({ action: "insert", possibleDuplicate: false }));
  it("hashes keys deterministically", async () =>
    expect(await hashToken("x")).toBe(await hashToken("x")));
});
