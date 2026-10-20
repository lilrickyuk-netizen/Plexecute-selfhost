// Member-initiated deletion of goals and weekly plans. One implementation for the screens and the Coach.
// Preview first (what will be affected + a confirmation token); delete only with a matching token.
import { addDaysKey, weekKeyOf, zonedInstant } from "./tz";

type Db = any;
const OPEN = ["planned", "scheduled", "upcoming", "due", "snoozed"];
const LIVE_CALL = ["CALL_ELIGIBLE", "CALL_QUEUED", "RETRY_SCHEDULED", "RETRY_POLICY_PAUSED"];

async function token(parts: unknown): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(parts)),
  );
  return Array.from(new Uint8Array(buf).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
}
const count = async (q: Promise<{ count: number | null }>) => (await q).count ?? 0;

async function blockSideEffects(admin: Db, userId: string, ids: string[]) {
  if (!ids.length) return { reminders: 0, calls: 0 };
  return {
    reminders: await count(
      admin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("block_id", ids)
        .in("status", ["queued", "retrying"]),
    ),
    calls: await count(
      admin
        .from("call_campaigns")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("block_id", ids)
        .in("state", LIVE_CALL),
    ),
  };
}

export type GoalImpact = {
  found: boolean;
  title: string | null;
  removes: {
    milestones: number;
    upcoming_sessions: number;
    reminders: number;
    calls: number;
    progress_entries: number;
    reflections: number;
    intentions: number;
    learning_items: number;
    pending_proposals: number;
  };
  keeps: { finished_sessions: number; research: number; outcomes: number };
  token: string;
};

export async function goalImpact(
  admin: Db,
  userId: string,
  goalId: string,
  now = new Date(),
): Promise<GoalImpact> {
  const { data: goal } = await admin
    .from("goals")
    .select("id,title")
    .eq("id", goalId)
    .eq("user_id", userId)
    .maybeSingle();
  const empty = {
    milestones: 0,
    upcoming_sessions: 0,
    reminders: 0,
    calls: 0,
    progress_entries: 0,
    reflections: 0,
    intentions: 0,
    learning_items: 0,
    pending_proposals: 0,
  };
  if (!goal)
    return {
      found: false,
      title: null,
      removes: empty,
      keeps: { finished_sessions: 0, research: 0, outcomes: 0 },
      token: await token(["goal", goalId, "gone"]),
    };
  const by = (t: string) =>
    count(admin.from(t).select("id", { count: "exact", head: true }).eq("goal_id", goalId));
  const { data: up } = await admin
    .from("plan_blocks")
    .select("id")
    .eq("user_id", userId)
    .eq("goal_id", goalId)
    .in("status", OPEN)
    .gte("starts_at", now.toISOString());
  const upIds = (up ?? []).map((b: { id: string }) => b.id);
  const side = await blockSideEffects(admin, userId, upIds);
  const { data: props } = await admin
    .from("plan_versions")
    .select("id,diff_summary")
    .eq("user_id", userId)
    .eq("status", "proposed");
  const pending = (props ?? []).filter((p: { diff_summary: unknown }) =>
    JSON.stringify(p.diff_summary ?? {}).includes(goalId),
  ).length;
  const learning =
    (await by("learning_topics")) +
    (await by("learning_resources")) +
    (await by("learning_assessments")) +
    (await by("retrieval_items"));
  const removes = {
    milestones: await by("goal_milestones"),
    upcoming_sessions: upIds.length,
    reminders: side.reminders,
    calls: side.calls,
    progress_entries: await by("goal_metric_entries"),
    reflections: await by("goal_reflections"),
    intentions: await by("goal_intentions"),
    learning_items: learning,
    pending_proposals: pending,
  };
  const all = await by("plan_blocks");
  const keeps = {
    finished_sessions: all - upIds.length,
    research: await by("career_research"),
    outcomes: await by("outcome_ledger"),
  };
  return {
    found: true,
    title: goal.title,
    removes,
    keeps,
    token: await token(["goal", goalId, removes, keeps]),
  };
}

async function removeBlocks(admin: Db, userId: string, ids: string[]) {
  if (!ids.length) return;
  await admin
    .from("call_campaigns")
    .update({ state: "CANCELLED" })
    .eq("user_id", userId)
    .in("block_id", ids)
    .in("state", LIVE_CALL);
  await admin.from("plan_blocks").delete().eq("user_id", userId).in("id", ids); // queued reminders go with them
}

async function audit(
  admin: Db,
  userId: string,
  action: string,
  id: string,
  metadata: Record<string, unknown>,
) {
  await admin.from("audit_events").insert({
    user_id: userId,
    actor_type: "user",
    action,
    resource_type: action.split(".")[0],
    resource_id: id,
    outcome: "succeeded",
    metadata,
  } as never);
}

export type DeleteResult = {
  deleted: boolean;
  already_deleted?: boolean;
  error?: "changed_since_preview";
};

/** Deletes a goal after the member confirmed the exact preview. Safe to repeat. */
export async function deleteGoal(
  admin: Db,
  userId: string,
  goalId: string,
  confirmToken: string,
  source: "screen" | "coach",
): Promise<DeleteResult> {
  const now = new Date();
  const imp = await goalImpact(admin, userId, goalId, now);
  if (!imp.found) return { deleted: false, already_deleted: true };
  if (imp.token !== confirmToken) return { deleted: false, error: "changed_since_preview" };
  const { data: up } = await admin
    .from("plan_blocks")
    .select("id")
    .eq("user_id", userId)
    .eq("goal_id", goalId)
    .in("status", OPEN)
    .gte("starts_at", now.toISOString());
  await removeBlocks(
    admin,
    userId,
    (up ?? []).map((b: { id: string }) => b.id),
  );
  const { data: props } = await admin
    .from("plan_versions")
    .select("id,diff_summary")
    .eq("user_id", userId)
    .eq("status", "proposed");
  const stale = (props ?? [])
    .filter((p: { diff_summary: unknown }) => JSON.stringify(p.diff_summary ?? {}).includes(goalId))
    .map((p: { id: string }) => p.id);
  if (stale.length)
    await admin.from("plan_versions").update({ status: "superseded" }).in("id", stale);
  await admin
    .from("plan_property_locks")
    .delete()
    .eq("user_id", userId)
    .eq("property", `goal:${goalId}:schedule`);
  const { error } = await admin.from("goals").delete().eq("id", goalId).eq("user_id", userId);
  if (error) throw new Error("The goal could not be deleted.");
  await audit(admin, userId, "goal.deleted", goalId, {
    title: imp.title,
    removed: imp.removes,
    kept: imp.keeps,
    source,
  });
  return { deleted: true };
}

export type PlanImpact = {
  found: boolean;
  week_start: string;
  versions: number;
  removes: {
    upcoming_sessions: number;
    reminders: number;
    calls: number;
    pending_proposals: number;
  };
  keeps: { finished_sessions: number; commitments_and_routines: number };
  token: string;
};

async function planScope(
  admin: Db,
  userId: string,
  weekStart: string,
  tz: string | null,
  now: Date,
) {
  const from = zonedInstant(weekStart, 0, tz).toISOString();
  const to = zonedInstant(addDaysKey(weekStart, 7), 0, tz).toISOString();
  const { data: blocks } = await admin
    .from("plan_blocks")
    .select("id,status,starts_at,source_type")
    .eq("user_id", userId)
    .gte("starts_at", from)
    .lt("starts_at", to);
  const list = (blocks ?? []) as {
    id: string;
    status: string;
    starts_at: string;
    source_type: string;
  }[];
  const planned = list.filter((b) => b.source_type === "goal" || b.source_type === "makeup");
  const upcoming = planned.filter(
    (b) => OPEN.includes(b.status) && b.starts_at >= now.toISOString(),
  );
  const { data: versions } = await admin
    .from("plan_versions")
    .select("id,status")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .in("status", ["approved", "proposed"]);
  return {
    upcoming,
    finished: planned.length - upcoming.length,
    other: list.length - planned.length,
    versions: (versions ?? []) as { id: string; status: string }[],
  };
}

export function weekStartFor(
  expr: string | null | undefined,
  tz: string | null,
  now = new Date(),
): string {
  const thisWeek = weekKeyOf(now, tz);
  if (expr && /^\d{4}-\d{2}-\d{2}$/.test(expr)) return weekKeyOf(zonedInstant(expr, 720, tz), tz);
  if (expr && /next/i.test(expr)) return addDaysKey(thisWeek, 7);
  return thisWeek;
}

export async function planImpact(
  admin: Db,
  userId: string,
  weekStart: string,
  tz: string | null,
  now = new Date(),
): Promise<PlanImpact> {
  const s = await planScope(admin, userId, weekStart, tz, now);
  const side = await blockSideEffects(
    admin,
    userId,
    s.upcoming.map((b) => b.id),
  );
  const removes = {
    upcoming_sessions: s.upcoming.length,
    reminders: side.reminders,
    calls: side.calls,
    pending_proposals: s.versions.filter((v) => v.status === "proposed").length,
  };
  const keeps = { finished_sessions: s.finished, commitments_and_routines: s.other };
  const found = s.versions.length > 0 || s.upcoming.length > 0;
  return {
    found,
    week_start: weekStart,
    versions: s.versions.length,
    removes,
    keeps,
    token: await token(["plan", weekStart, found, removes, keeps, s.versions.map((v) => v.id)]),
  };
}

/** Deletes a week's plan: upcoming planned sessions go; finished history, commitments and routines stay. Safe to repeat. */
export async function deletePlan(
  admin: Db,
  userId: string,
  weekStart: string,
  tz: string | null,
  confirmToken: string,
  source: "screen" | "coach",
): Promise<DeleteResult> {
  const now = new Date();
  const imp = await planImpact(admin, userId, weekStart, tz, now);
  if (!imp.found) return { deleted: false, already_deleted: true };
  if (imp.token !== confirmToken) return { deleted: false, error: "changed_since_preview" };
  const s = await planScope(admin, userId, weekStart, tz, now);
  await removeBlocks(
    admin,
    userId,
    s.upcoming.map((b) => b.id),
  );
  if (s.versions.length) {
    const { error } = await admin
      .from("plan_versions")
      .update({ status: "deleted" })
      .in(
        "id",
        s.versions.map((v) => v.id),
      );
    if (error) throw new Error("The plan could not be deleted.");
  }
  await audit(admin, userId, "plan.deleted", weekStart, {
    week_start: weekStart,
    removed: imp.removes,
    kept: imp.keeps,
    versions: s.versions.map((v) => v.id),
    source,
  });
  return { deleted: true };
}

/** Plain-language list of what a deletion removes and keeps, for previews and the Coach. */
export function describeImpact(i: {
  removes: Record<string, number>;
  keeps: Record<string, number>;
}) {
  const L: Record<string, string> = {
    milestones: "milestone",
    upcoming_sessions: "upcoming session",
    reminders: "pending reminder",
    calls: "scheduled call",
    progress_entries: "progress entry",
    reflections: "reflection",
    intentions: "intention",
    learning_items: "learning item",
    pending_proposals: "pending plan proposal",
    finished_sessions: "finished or past session",
    research: "research record",
    outcomes: "outcome record",
    commitments_and_routines: "commitment or routine item",
  };
  const fmt = (o: Record<string, number>) =>
    Object.entries(o)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => {
        const w = L[k] ?? k;
        return `${n} ${n > 1 ? (w.endsWith("y") ? `${w.slice(0, -1)}ies` : `${w}s`) : w}`;
      });
  return { removes: fmt(i.removes), keeps: fmt(i.keeps) };
}
