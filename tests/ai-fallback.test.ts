import { describe, it, expect } from "vitest";
import { fallbackReply, FALLBACK_COUNTS_AS_TURN } from "../src/lib/ai-fallback";
describe("AI fallback", () => {
  it("names the next real block", () => {
    expect(fallbackReply("unavailable", { title: "Run", startsLocal: "18:30" })).toContain(
      "Next up: Run at 18:30",
    );
  });
  it("handles an empty day and never leaks providers", () => {
    for (const r of ["paused", "busy", "unavailable"] as const) {
      const t = fallbackReply(r, null);
      expect(t).toMatch(/plan still works/);
      expect(t).not.toMatch(/gateway|openai|gemini|\d{3}|—/i);
    }
  });
  it("never uses a turn", () => expect(FALLBACK_COUNTS_AS_TURN).toBe(false));
});
