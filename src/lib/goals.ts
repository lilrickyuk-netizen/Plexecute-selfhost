// Deterministic goal model helpers (V3 step 8). Pure functions; no AI.

export type GoalLike = {
  id: string;
  title: string;
  status: string;
  dependencies?: string[] | null;
  is_protected?: boolean | null;
  priority?: number | null;
};

/** Progress from baseline toward target, 0..1. Works for decreasing targets (e.g. weight loss). Null if not measurable. */
export function goalProgress(
  baseline: number | null | undefined,
  current: number | null | undefined,
  target: number | null | undefined,
): number | null {
  if (baseline == null || current == null || target == null) return null;
  if (target === baseline) return current === target ? 1 : 0;
  const p = (current - baseline) / (target - baseline);
  return Math.max(0, Math.min(1, p));
}

/** Splits active goals into those ready to plan and those waiting on an unfinished dependency. */
export function planningGoals<G extends GoalLike>(
  goals: G[],
): { ready: G[]; waiting: { goal: G; waitingOn: string[] }[] } {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const ready: G[] = [];
  const waiting: { goal: G; waitingOn: string[] }[] = [];
  for (const g of goals) {
    if (g.status !== "active") continue;
    const open = (g.dependencies ?? []).filter(
      (d) => d !== g.id && byId.has(d) && byId.get(d)!.status !== "completed",
    );
    if (open.length) waiting.push({ goal: g, waitingOn: open.map((d) => byId.get(d)!.title) });
    else ready.push(g);
  }
  // Protected goals are planned first, then by priority.
  ready.sort(
    (a, b) =>
      Number(!!b.is_protected) - Number(!!a.is_protected) || (b.priority ?? 3) - (a.priority ?? 3),
  );
  return { ready, waiting };
}

/** Whether adding `depId` as a dependency of `goalId` would create a cycle. */
export function createsCycle(goals: GoalLike[], goalId: string, depId: string): boolean {
  if (goalId === depId) return true;
  const byId = new Map(goals.map((g) => [g.id, g]));
  const stack = [depId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === goalId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of byId.get(id)?.dependencies ?? []) stack.push(d);
  }
  return false;
}

export const GOAL_STATUSES = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "abandoned", label: "Stopped" },
] as const;
