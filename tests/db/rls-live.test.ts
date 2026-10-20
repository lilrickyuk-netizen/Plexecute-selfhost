/** Step 70 database policy suite: runs against the real backend with the public key only (RUN_DB_TESTS=1). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { USER_TABLES } from "../../src/lib/privacy";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);
const URL = env["VITE_SUPABASE_URL"],
  KEY = env["VITE_SUPABASE_PUBLISHABLE_KEY"];
const run = process.env["RUN_DB_TESTS"] === "1" ? describe : describe.skip;

run("live RLS: signed-out visitors see no member data", () => {
  for (const t of USER_TABLES) {
    it(`${t} returns no rows to anon`, async () => {
      const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: KEY! } });
      if (r.ok) expect(await r.json()).toEqual([]);
      else expect([401, 403, 404]).toContain(r.status);
    });
  }
  it("anon cannot write a plan block", async () => {
    const r = await fetch(`${URL}/rest/v1/plan_blocks`, {
      method: "POST",
      headers: { apikey: KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(r.ok).toBe(false);
  });
});
