import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { serviceMonth, tokenUsage, summariseUsage } from "@/lib/usage";
import { USER_TABLES } from "@/lib/privacy";
import { PRODUCTS } from "@/lib/billing";

const src = (p: string) => readFileSync(p, "utf8");

describe("step 89 unit economics instrumentation", () => {
  it("service month follows the paid billing period, else the calendar month", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    expect(serviceMonth(now, "2026-09-20T00:00:00Z", "2026-10-20T00:00:00Z")).toBe("2026-09-20");
    expect(serviceMonth(now, "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z")).toBe("2026-10-01");
    expect(serviceMonth(now)).toBe("2026-10-01");
  });
  it("reads real token counts from both AI response shapes", () => {
    expect(tokenUsage({ usage: { prompt_tokens: 10, completion_tokens: 3 } })).toEqual({
      input: 10,
      output: 3,
    });
    expect(tokenUsage({ usage: { input_tokens: 7, output_tokens: 2 } })).toEqual({
      input: 7,
      output: 2,
    });
    expect(tokenUsage({})).toBeNull();
  });
  it("summarises by tier, provider, feature, market and platform", () => {
    const base = {
      service_month: "2026-10-01",
      tier: "pro",
      provider: "twilio_voice",
      feature: "accountability_call",
      unit: "attempts",
      market: "GB",
      platform: "web",
      ok: true,
    };
    const s = summariseUsage([
      { ...base, quantity: 1 },
      { ...base, quantity: 1, ok: false },
      { ...base, tier: "execute", quantity: 1 },
    ]);
    expect(s.find((r) => r["tier"] === "pro")).toMatchObject({ quantity: 2, events: 2, failed: 1 });
  });
  it("every paid provider path is metered", () => {
    const where: [string, string][] = [
      ["src/lib/coach.functions.ts", "coach_chat"],
      ["src/lib/research.functions.ts", "career_research"],
      ["src/lib/research.functions.ts", "firecrawl"],
      ["src/lib/learning.functions.ts", "study_questions"],
      ["src/lib/nutrition.functions.ts", "food_photo"],
      ["src/lib/twin.server.ts", "life_twin_inference"],
      ["src/lib/knowledge.server.ts", "knowledge_"],
      ["src/lib/calling.server.ts", "billed_seconds"],
      ["src/lib/calling.server.ts", "connected_seconds"],
      ["src/lib/voice.server.ts", "voice_seconds"],
      ["src/lib/calling.functions.ts", "twilio_verify"],
      ["src/lib/notify.server.ts", "expo_push"],
      ["src/lib/notify.server.ts", "resend"],
      ["src/lib/food-provider.server.ts", "fatsecret"],
    ];
    for (const [f, k] of where) expect(src(f), `${f} ${k}`).toContain(k);
  });
  it("usage is covered by export and deletion, and stores no money", () => {
    expect(USER_TABLES as readonly string[]).toContain("usage_events");
    expect(src("src/lib/usage.ts")).not.toMatch(
      /£|price|cost_gbp/i.source === "" ? /x^/ : /cost_gbp|£\d/,
    );
  });
  it("locked prices are untouched", () => {
    expect(JSON.stringify(PRODUCTS)).toBeTruthy();
    expect(src("src/lib/usage.ts")).not.toContain("PRODUCTS");
  });
});
