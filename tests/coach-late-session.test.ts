import { afterEach, describe, expect, it, vi } from "vitest";
import { execActionTool, type ActionCtx } from "../src/lib/coach-actions.server";

const lesson = {
  id: "late-lesson",
  goal_id: "coding",
  title: "Learn coding",
  domain: "learning",
  starts_at: "2026-10-14T14:00:00.000Z",
  duration_min: 30,
  status: "planned",
  is_protected: false,
  source_type: "goal",
  note: null,
};
function setup(patch = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-14T14:29:00.000Z"));
  const block = { ...lesson, ...patch };
  const inserted: Record<string, unknown>[] = [];
  const from = (table: string) => {
    let values: Record<string, unknown> | undefined;
    let ids: string[] | undefined;
    let lower = "";
    const q: Record<string, unknown> = {};
    for (const key of ["select", "eq", "lt", "order", "limit", "update"]) q[key] = () => q;
    q["in"] = (_key: string, v: string[]) => {
      ids = v;
      return q;
    };
    q["gte"] = (_key: string, v: string) => {
      lower = v;
      return q;
    };
    q["insert"] = (v: Record<string, unknown>) => {
      values = v;
      inserted.push(v);
      return q;
    };
    const result = () => ({
      data:
        table === "plan_blocks"
          ? (!ids || ids.includes(block.id)) && (!lower || block.starts_at >= lower)
            ? [block]
            : []
          : table === "plan_versions"
            ? values
              ? { id: "proposal" }
              : [{ version: 1 }]
            : [],
      error: null,
    });
    q["single"] = async () => result();
    q["then"] = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return q;
  };
  const ctx = {
    db: { from },
    admin: { from },
    userId: "member",
    tier: "pro",
    tz: "Europe/London",
    actions: [],
  } as unknown as ActionCtx;
  return { ctx, inserted };
}
afterEach(() => vi.useRealTimers());
describe("Coach late-session moves", () => {
  const args = {
    moves: [{ session_id: lesson.id, day: null, time: "16:00" }],
    remove_session_ids: [],
    clear_day: null,
    rebuild_day: null,
    reason: "I'm running late",
  };
  it("proposes the unlocked 3pm lesson at 4pm after its start, without changing it before approval", async () => {
    const { ctx, inserted } = setup();
    expect(await execActionTool(ctx, "edit_plan", args)).toMatchObject({
      proposal_awaiting_approval: true,
    });
    expect(inserted.find((v) => v["diff_summary"])?.["diff_summary"]).toMatchObject({
      proposed_blocks: [{ starts_at: "2026-10-14T15:00:00.000Z" }],
      coach_edit: { overdue_moves: [{ id: lesson.id, status: "planned" }] },
    });
    expect(ctx.actions).toMatchObject([{ kind: "approve_plan" }]);
  });
  it.each([{ is_protected: true }, { status: "in_progress" }, { status: "done" }])(
    "rejects protected or started sessions: %j",
    async (patch) => {
      const { ctx } = setup(patch);
      expect(await execActionTool(ctx, "edit_plan", args)).toMatchObject({
        error: "these_sessions_cannot_be_changed",
      });
      expect(ctx.actions).toEqual([]);
    },
  );
  it("does not resurrect past sessions during a bulk clear", async () => {
    const { ctx } = setup();
    expect(
      await execActionTool(ctx, "edit_plan", { ...args, moves: [], clear_day: "today" }),
    ).toMatchObject({ no_change_needed: true });
  });
});
