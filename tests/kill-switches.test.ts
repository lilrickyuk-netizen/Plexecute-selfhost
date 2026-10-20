import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FLAG_CATALOGUE, heldChannels, applyCap } from "@/lib/flags";

const src = (p: string) => readFileSync(p, "utf8");

describe("§88 incident and kill-switch controls", () => {
  it("covers calling, AI, provider integrations, notifications and purchases", () => {
    const keys = FLAG_CATALOGUE.filter((f) => f.kind === "kill_switch").map((f) => f.key);
    for (const k of [
      "calls_outbound",
      "coach_ai",
      "ai_assist",
      "wearable_sync",
      "calendar_sync",
      "food_photo",
      "push_notifications",
      "email_notifications",
      "billing_checkout",
    ])
      expect(keys).toContain(k);
  });
  it("every kill switch is enforced on its server path", () => {
    const where: Record<string, string> = {
      calls_outbound: "src/lib/calling.server.ts",
      coach_ai: "src/lib/coach.functions.ts",
      ai_assist: "src/lib/research.functions.ts",
      wearable_sync: "src/lib/wearables.server.ts",
      calendar_sync: "src/lib/calendar.server.ts",
      food_photo: "src/lib/nutrition.functions.ts",
      push_notifications: "src/lib/notify.server.ts",
      email_notifications: "src/lib/notify.server.ts",
      billing_checkout: "src/lib/billing.functions.ts",
    };
    for (const [k, f] of Object.entries(where)) expect(src(f)).toContain(`"${k}"`);
    expect(src("src/lib/learning.functions.ts")).toContain('"ai_assist"');
  });
  it("paused channels are held, not dropped", () => {
    expect(heldChannels(true, true)).toEqual([]);
    expect(heldChannels(false, true)).toEqual(["push"]);
    expect(heldChannels(false, false)).toEqual(["push", "email"]);
  });
  it("purchase switch never blocks renewals, cancellations or the webhook", () => {
    expect(src("src/routes/api/public/stripe-webhook.ts")).not.toContain("billing_checkout");
    expect(
      (src("src/lib/billing.functions.ts").match(/"billing_checkout"\)\)\)/g) ?? []).length,
    ).toBe(2);
  });
  it("caps only lower limits", () => {
    expect(applyCap(20, 500)).toBe(20);
    expect(applyCap(20, 5)).toBe(5);
  });
});
