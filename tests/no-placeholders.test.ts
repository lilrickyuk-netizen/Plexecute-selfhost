import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { usdaKey } from "../src/lib/food-provider.server";

const files = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
const app = files("src").filter(
  (f) =>
    !f.includes("/integrations/") &&
    !f.includes("/components/ui/") &&
    !f.endsWith("routeTree.gen.ts"),
);
const BANNED =
  /\b(TODO|FIXME|lorem ipsum|coming soon|sample user|demo user|not implemented|example\.com|yourdomain|price_x+|prod_x+)\b/i;

describe("step 93 no production placeholders", () => {
  it("app code has no placeholder markers", () => {
    const hits = app.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((l, i) => (BANNED.test(l) ? `${f}:${i + 1}` : null))
        .filter(Boolean),
    );
    expect(hits).toEqual([]);
  });
  const prev = { ...process.env };
  afterEach(() => {
    process.env = { ...prev };
  });
  it("USDA shared demo key is never used in production", () => {
    delete process.env.USDA_FDC_API_KEY;
    process.env.APP_ENV = "production";
    expect(usdaKey()).toBeUndefined();
    process.env.USDA_FDC_API_KEY = "real";
    expect(usdaKey()).toBe("real");
  });
});
