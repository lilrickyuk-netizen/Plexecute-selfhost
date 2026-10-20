import { afterEach, describe, expect, it, vi } from "vitest";
import { execActionTool, type ActionCtx } from "../src/lib/coach-actions.server";

const apply = vi.fn();
vi.mock("../src/lib/planning.functions", () => ({
  approveWeekPlan: (...args: unknown[]) => apply(...args),
  pinMemberMovedSessions: vi.fn(),
}));
const organic = "11111111-1111-4111-8111-111111111111";
const cyber = "22222222-2222-4222-8222-222222222222";
function setup(memberText: string, swapping = false) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T08:00:00Z"));
  const blocks = [
    { id: organic, title: "Organic marketing study", starts_at: "2026-10-18T18:30:00.000Z" },
    {
      id: cyber,
      title: "Cyber security study",
      starts_at: swapping ? "2026-10-18T19:30:00.000Z" : "2026-10-18T18:30:00.000Z",
    },
  ].map((b) => ({
    ...b,
    goal_id: b.id,
    domain: "learning",
    duration_min: 30,
    status: "planned",
    is_protected: true,
    source_type: "goal",
    commitment_id: null,
    note: null,
  }));
  let proposal: Record<string, any> = {};
  const from = (table: string) => {
    let ids: string[] | undefined;
    let values: unknown;
    const q: Record<string, any> = {};
    for (const key of ["select", "eq", "lt", "order", "limit", "update", "gte"]) q[key] = () => q;
    q.in = (_key: string, v: string[]) => {
      ids = v;
      return q;
    };
    q.insert = (v: Record<string, unknown>) => {
      values = v;
      if (table === "plan_versions") proposal = v;
      return q;
    };
    const result = () => ({
      data:
        table === "plan_blocks"
          ? blocks.filter((b) => !ids || ids.includes(b.id))
          : table === "plan_versions"
            ? values
              ? { id: organic }
              : [{ version: 1 }]
            : [],
      error: null,
    });
    q.single = async () => result();
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return q;
  };
  const ctx = {
    db: { from },
    admin: { from },
    userId: organic,
    tier: "pro",
    tz: "Europe/London",
    actions: [],
    memberText,
  } as unknown as ActionCtx;
  return { ctx, proposal: () => proposal };
}
const args = {
  moves: [],
  remove_session_ids: [],
  clear_day: null,
  rebuild_day: null,
  reason: "Member explicitly requested this edit",
};
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe("explicit edits of locked Plexecute items", () => {
  it("moves the locked organic marketing session from 19:30 to 20:30", async () => {
    const x = setup("Move the organic marketing session to 20:30.");
    expect(
      await execActionTool(x.ctx, "edit_plan", {
        ...args,
        moves: [{ session_id: organic, day: null, time: "20:30" }],
      }),
    ).toMatchObject({ applied: true });
    expect(x.proposal().diff_summary.proposed_blocks).toEqual([
      expect.objectContaining({
        title: "Organic marketing study",
        starts_at: "2026-10-18T19:30:00.000Z",
        is_protected: true,
      }),
    ]);
    expect(
      x.proposal().diff_summary.coach_edit.member_overrides.map((b: { id: string }) => b.id),
    ).toEqual([organic]);
    expect(apply).toHaveBeenCalledOnce();
  });
  it("removes only the explicitly named locked item", async () => {
    const x = setup("Remove the organic marketing session from my plan.");
    expect(
      await execActionTool(x.ctx, "edit_plan", { ...args, remove_session_ids: [organic] }),
    ).toMatchObject({ applied: true });
    expect(x.proposal().diff_summary.proposed_blocks).toEqual([]);
    expect(
      x.proposal().diff_summary.coach_edit.member_overrides.map((b: { id: string }) => b.id),
    ).toEqual([organic]);
    expect(apply).toHaveBeenCalledOnce();
  });
  it("swaps two locked items, preserving protection on both replacements", async () => {
    const x = setup("Swap the organic marketing and cyber security sessions.", true);
    expect(
      await execActionTool(x.ctx, "edit_plan", {
        ...args,
        moves: [
          { session_id: organic, day: null, time: "20:30" },
          { session_id: cyber, day: null, time: "19:30" },
        ],
      }),
    ).toMatchObject({ applied: true });
    expect(x.proposal().diff_summary.proposed_blocks).toEqual([
      expect.objectContaining({
        title: "Organic marketing study",
        starts_at: "2026-10-18T19:30:00.000Z",
        is_protected: true,
      }),
      expect.objectContaining({
        title: "Cyber security study",
        starts_at: "2026-10-18T18:30:00.000Z",
        is_protected: true,
      }),
    ]);
    expect(
      x.proposal().diff_summary.coach_edit.member_overrides.map((b: { id: string }) => b.id),
    ).toEqual([organic, cyber]);
    expect(apply).toHaveBeenCalledOnce();
  });
});
