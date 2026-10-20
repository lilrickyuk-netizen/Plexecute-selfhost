import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { FLAG_CATALOGUE, applyCap, flagDef } from "../src/lib/flags";

describe("V3 §92 feature flags", () => {
  it("never defines pricing, safety, consent or entitlement flags", () => {
    for (const f of FLAG_CATALOGUE)
      expect(f.key).not.toMatch(/price|safety|consent|entitle|tier|trial|reward/);
  });
  it("caps only lower a plan limit", () => {
    expect(applyCap(40, 10)).toBe(10);
    expect(applyCap(40, 500)).toBe(40);
    expect(applyCap(40, null)).toBe(40);
  });
  it("unknown keys are rejected", () => expect(flagDef("free_execute")).toBeUndefined());
});

describe("V3 §10.5 admin routes", () => {
  const files = readdirSync("src/routes/_authenticated");
  it("every required section exists", () => {
    for (const s of [
      "index",
      "users.index",
      "users.$id",
      "subscriptions",
      "integrations",
      "jobs",
      "calls",
      "safety",
      "knowledge",
      "flags",
      "experiments",
      "audit",
      "health",
      "quotas",
      "incidents",
    ])
      expect(files).toContain(`app.admin.${s}.tsx`);
  });
  it("every admin server function checks the admin role first", () => {
    const src = readFileSync("src/lib/admin-console.functions.ts", "utf8");
    const handlers = src.split(".handler(async").slice(1);
    expect(handlers.length).toBeGreaterThan(10);
    for (const h of handlers) expect(h.slice(0, 120)).toContain("await admin(context)");
  });
});
