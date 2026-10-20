import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { USER_TABLES } from "../src/lib/privacy";

const walk = (d: string, re: RegExp): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p, re) : re.test(f) ? [p] : [];
  });
const code = walk("src", /\.tsx?$/)
  .filter((f) => !f.includes("integrations/supabase/types") && !f.endsWith("routeTree.gen.ts"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
const sql = [...walk("supabase/migrations", /\.sql$/), ...walk("drizzle/migrations", /\.sql$/)]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
const tables = [...types.split("Views:")[0].matchAll(/^ {6}([a-z_]+): \{\n {8}Row:/gm)].map(
  (m) => m[1],
);
/** Service-owned tables (no user_id, or keyed differently) — not exported per member. */
const SYSTEM = new Set([
  "owner_cohorts",
  "admin_access_log",
  "ai_usage",
  "background_job_events",
  "background_jobs",
  "billing_events",
  "call_market_manifest",
  "deletion_jobs",
  "error_events",
  "feature_flags",
  "incidents",
  "knowledge_chunks",
  "knowledge_sources",
  "profiles",
  "provider_calls",
  "rate_limits",
  "retention_runs",
  "guided_video_cache",
  "exercise_demo_cache",
  "appointment_booking_events",
  "fx_rates",
  "geocode_cache",
  "internal_cron_tokens",
]);
/** Retained for export/deletion only; the feature that wrote it was removed. */
const LEGACY = new Set(["lesson_progress"]);

function wired(t: string) {
  const ends = [
    ...code.matchAll(new RegExp(`from\\(\\s*["'\`]${t}["'\`]\\s*\\)|\\b${t}\\(`, "g")),
  ].map((m) => m.index! + m[0].length);
  const helper = new RegExp(`(ins|upd)\\(\\s*"${t}"`).test(code);
  const write =
    helper ||
    ends.some((e) => /\.(insert|upsert|update|delete)\(/.test(code.slice(e, e + 250))) ||
    new RegExp(`(insert into|update|delete from)\\s+(public\\.)?${t}\\b`, "i").test(sql);
  const read =
    ends.some((e) => /\.select\(/.test(code.slice(e, e + 120))) ||
    new RegExp(`select\\("[^"]*\\b${t}\\(`).test(code) ||
    new RegExp(`from\\s+(public\\.)?${t}\\b`, "i").test(sql);
  return { write, read };
}

describe("step 94 database wiring", () => {
  it("found the schema", () => expect(tables.length).toBeGreaterThan(80));
  it("every table is both written and read", () => {
    const bad = tables
      .filter((t) => !LEGACY.has(t))
      .map((t) => ({ t, ...wired(t) }))
      .filter((x) => !x.write || !x.read)
      .map((x) => `${x.t} write=${x.write} read=${x.read}`);
    expect(bad).toEqual([]);
  });
  it("every member table is covered by export/deletion, or is a known service table", () => {
    const listed = new Set<string>(USER_TABLES as readonly string[]);
    expect(tables.filter((t) => !listed.has(t) && !SYSTEM.has(t))).toEqual([]);
  });
});
