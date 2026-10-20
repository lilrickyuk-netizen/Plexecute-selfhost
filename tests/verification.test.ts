import { describe, it, expect } from "vitest";
import { classify } from "../src/lib/verification";
const b = {
  id: "b",
  domain: "training",
  occurrence_kind: "training",
  status: "done",
  starts_at: "2026-10-01T07:00:00Z",
  duration_min: 60,
};
const act = (ref: string, startsAt = "2026-10-01T07:05:00Z", minutes = 55) => ({
  kind: "external_activity" as const,
  origin: "device" as const,
  ref,
  startsAt,
  minutes,
  source: "apple health",
});
describe("evidence verification", () => {
  it("manual completion is only self-reported", () => {
    expect(classify(b, [{ kind: "self_confirm", origin: "user" }]).evidence).toBe("self_reported");
  });
  it("calendar is never proof", () => {
    expect(classify(b, [{ kind: "calendar", origin: "system" }]).evidence).toBe("unknown");
  });
  it("set log supports, wearable verifies", () => {
    expect(
      classify(b, [{ kind: "workout_log", origin: "user", sets: 12, ref: "w" }]).evidence,
    ).toBe("supported");
    expect(classify(b, [act("h1")]).evidence).toBe("verified_external");
  });
  it("no double-use of one activity", () => {
    expect(
      classify(b, [act("h1"), { kind: "self_confirm", origin: "user" }], new Set(["h1"])).evidence,
    ).toBe("self_reported");
  });
  it("mismatched activity doesn't verify", () => {
    expect(classify(b, [act("h2", "2026-10-01T15:00:00Z")]).evidence).toBe("unknown");
    expect(classify(b, [act("h3", undefined, 10)]).evidence).toBe("unknown");
  });
  it("AI cannot upgrade", () => {
    expect(
      classify(b, [
        { ...act("h4"), origin: "ai" },
        { kind: "workout_log", origin: "ai", sets: 9, ref: "x" },
      ]).evidence,
    ).toBe("unknown");
  });
  it("not done means unknown", () => {
    expect(classify({ ...b, status: "planned" }, [act("h5")]).evidence).toBe("unknown");
  });
});
