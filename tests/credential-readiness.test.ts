import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CREDENTIALS } from "../src/lib/credentials";

const files = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
const src = files("src").filter(
  (f) => !f.endsWith("credentials.ts") && !f.endsWith("routeTree.gen.ts"),
);
const read = new Set<string>();
for (const f of src) {
  const t = readFileSync(f, "utf8");
  for (const m of t.matchAll(
    /(?:env\(\s*|process\.env\[\s*|process\.env\.|env(?:Id|Secret)?:\s*)["'`]?([A-Z][A-Z0-9_]{3,})/g,
  ))
    read.add(m[1]);
  for (const m of t.matchAll(/env\(p === "google" \? "([A-Z_]+)" : "([A-Z_]+)"\)/g)) {
    read.add(m[1]);
    read.add(m[2]);
  }
}
read.delete("PRODUCTS");
read.delete("VOICE_TOPUP");
for (const n of [...read]) if (n.startsWith("VITE_")) read.delete(n);

describe("step 92 credential readiness", () => {
  it("every env var the code reads is in the checklist", () => {
    const listed = new Set(CREDENTIALS.map((c) => c.name));
    expect([...read].filter((n) => !listed.has(n))).toEqual([]);
  });
  it("no shells: each listed credential is used by its consumer file", () => {
    const bad = CREDENTIALS.filter(
      (c) =>
        !readFileSync(c.consumer, "utf8").includes(
          c.name.replace(/^(WHOOP|OURA|FITBIT|STRAVA|GARMIN)_CLIENT_/, "$1_CLIENT_"),
        ),
    );
    expect(bad.map((c) => `${c.name} -> ${c.consumer}`)).toEqual([]);
  });
  it("no duplicates", () => {
    const names = CREDENTIALS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
