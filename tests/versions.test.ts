import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { ENGINE_VERSIONS, PLAN_ENGINE_VERSIONS } from "../src/lib/versions";
describe("rule-set versions", () => {
  it("every engine has a non-empty version", () => {
    for (const v of Object.values(ENGINE_VERSIONS)) expect(v).toMatch(/\S/);
  });
  it("plan stamps are a subset of the registry", () => {
    for (const [k, v] of Object.entries(PLAN_ENGINE_VERSIONS))
      expect((ENGINE_VERSIONS as Record<string, string>)[k]).toBe(v);
  });
  it("every plan proposal insert stamps engine versions", () => {
    const s = readFileSync("src/lib/planning.functions.ts", "utf8");
    expect((s.match(/from\("plan_versions"\)\s*\.insert\(\{/g) ?? []).length).toBe(
      s.split("PLAN_ENGINE_VERSIONS").length - 1,
    );
  });
});
