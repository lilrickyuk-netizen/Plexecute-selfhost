import { describe, it, expect } from "vitest";
import { currentConsents } from "@/lib/consent";
const r = (action: string, t: string, subject = "a") => ({
  purpose: "health_data",
  action,
  policy_version: "v",
  created_at: t,
  scope: [],
  source: "app",
  provider: null,
  domain: null,
  subject_id: subject,
});
describe("consent state", () => {
  it("latest record wins per subject", () => {
    const c = currentConsents([
      r("granted", "2026-01-01"),
      r("withdrawn", "2026-02-01"),
      r("granted", "2026-01-05", "b"),
    ]);
    expect(c.find((x) => x.subject_id === "a")!.granted).toBe(false);
    expect(c.find((x) => x.subject_id === "a")!.history).toBe(2);
    expect(c.find((x) => x.subject_id === "b")!.granted).toBe(true);
  });
});
