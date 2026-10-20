import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COACH_ACTION_TOOLS, CONFIRM_KINDS } from "../src/lib/coach-action-names";
import { FREE_TOOLS, COACH_DENIED_TABLES, coachMayAccess } from "../src/lib/coach-tools";
import { rebuildDaySlots } from "../src/lib/coach-scheduling";

const src = readFileSync("src/lib/coach-actions.server.ts", "utf8");
const caseBody = (name: string) => {
  const start = src.indexOf(`case "${name}":`);
  const ends = ["\n    case ", "\nasync function", "\nexport "]
    .map((m) => src.indexOf(m, start + 10))
    .filter((i) => i > 0);
  return src.slice(start, Math.min(...ends));
};

describe("coach execution tools", () => {
  it("every action tool has a definition and is callable", () => {
    for (const t of COACH_ACTION_TOOLS) {
      expect(src).toContain(`name: "${t}"`);
      // Appointment tools are dispatched by the appointmentTool if-chain; the rest use a switch.
      const dispatched = src.includes(`case "${t}":`) || src.includes(`tool === "${t}"`);
      expect(dispatched, `${t} has a handler`).toBe(true);
      expect(FREE_TOOLS).toContain(t);
    }
  });

  it("destructive and material changes only queue a confirmation", () => {
    for (const t of [
      "remove_commitments",
      "update_goal",
      "update_availability",
      "set_wellness_preferences",
      "log_food",
      "change_training_programme",
      "disconnect_connected_device",
    ]) {
      const body = caseBody(t);
      expect(body).toMatch(/pend\(\s*ctx/);
      expect(body).not.toMatch(/\.(delete|update|upsert)\(/);
    }
    for (const k of CONFIRM_KINDS) expect(src).toContain(`case "${k}":`);
  });

  it("commitment deletes happen only in the confirmed path", () => {
    const before = src.slice(0, src.indexOf("export async function runPending"));
    expect(before).not.toMatch(/from\("commitments"\)\.delete/);
  });

  it("session changes go through plan proposals, never direct plan_blocks writes", () => {
    expect(src).not.toMatch(/from\("plan_blocks"\)\s*\.(insert|update|delete|upsert)/);
    expect(src).toContain('status: "proposed"');
  });

  it("billing, secrets, admin and owner tables stay blocked", () => {
    for (const t of [
      "subscriptions",
      "billing_events",
      "phone_numbers",
      "user_roles",
      "owner_notes",
      "calendar_credentials",
      "wearable_credentials",
    ])
      expect(coachMayAccess(t)).toBe(false);
    expect(COACH_DENIED_TABLES).not.toContain("coach_pending_actions" as never);
    expect(coachMayAccess("commitments")).toBe(true);
  });

  it("rebuilds a day deterministically around commitments", () => {
    const out = rebuildDaySlots(
      [
        { id: "study", start: 855, duration: 45 }, // 14:15, clashes with 13:45-15:15 meeting buffer
        { id: "gym", start: 420, duration: 30 }, // 07:00, fits
      ],
      [[825, 915]],
      390,
      1320,
    );
    expect(out.find((x) => x.id === "gym")).toEqual({ id: "gym", start: 420, moved: false });
    const study = out.find((x) => x.id === "study")!;
    expect(study.moved).toBe(true);
    expect(study.start! + 45 <= 825 || study.start! >= 915).toBe(true);
    expect(study.start! < 420 || study.start! >= 450).toBe(true);
    expect(
      rebuildDaySlots([{ id: "x", start: 600, duration: 60 }], [[0, 1440]], 0, 1440)[0]!.start,
    ).toBeNull();
  });
  it("training, mobility and device actions reuse the domain server functions", () => {
    expect(caseBody("substitute_exercise")).toContain("substituteExercise(");
    expect(caseBody("log_mobility")).toContain('kind: "mobility"');
    expect(caseBody("sync_connected_device")).toContain("syncWearableNow(");
    expect(src.slice(src.indexOf("export async function runPending"))).toContain(
      "createProgramme(",
    );
    expect(src).not.toMatch(
      /from\("(training_programmes|programme_prescriptions|wearable_connections)"\)\s*\.(insert|update|delete|upsert)/,
    );
  });
});
