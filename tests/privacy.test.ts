import { describe, expect, it } from "vitest";
import {
  EXPORT_TABLES,
  KEEP_ON_WIPE,
  SECRET_TABLES,
  USER_TABLES,
  WIPE_TABLES,
  deletionOrder,
  isOverdue,
  rightsDueAt,
} from "@/lib/privacy";
import { readFileSync, readdirSync } from "fs";

describe("privacy registry", () => {
  it("covers every user_id table created in migrations", () => {
    const sql = readdirSync("supabase/migrations")
      .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8"))
      .join("\n");
    const created = [
      ...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi),
    ]
      .filter((m) => /\buser_id\b/.test(m[2]))
      .map((m) => m[1]);
    for (const t of created) expect(USER_TABLES as readonly string[]).toContain(t);
  });
  it("never exports secrets, wipe keeps billing and legal evidence", () => {
    for (const t of SECRET_TABLES) expect(EXPORT_TABLES).not.toContain(t);
    for (const t of KEEP_ON_WIPE) expect(WIPE_TABLES).not.toContain(t);
    expect(WIPE_TABLES).toContain("health_samples");
    expect(WIPE_TABLES).toContain("life_twin_facts");
  });
  it("deletes children before parents", () => {
    const o = deletionOrder(["plan_blocks", "plan_block_events", "goals", "goal_milestones"]);
    expect(o.indexOf("plan_block_events")).toBeLessThan(o.indexOf("plan_blocks"));
    expect(o.indexOf("goal_milestones")).toBeLessThan(o.indexOf("goals"));
  });
  it("28 day deadline and overdue", () => {
    const d = rightsDueAt(new Date("2026-01-01T00:00:00Z"));
    expect(d.toISOString()).toBe("2026-01-29T00:00:00.000Z");
    expect(isOverdue({ status: "received", due_at: d.toISOString() }, new Date("2026-02-01"))).toBe(
      true,
    );
    expect(
      isOverdue({ status: "completed", due_at: d.toISOString() }, new Date("2026-02-01")),
    ).toBe(false);
  });
});
