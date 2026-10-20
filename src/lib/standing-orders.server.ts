// Standing instructions from the member ("keep going until I reach my goal"): Plexecute keeps planning each
// new week, booking the session calls and rolling the meal plan on, until the goal or target weight is reached.
// Each run goes through the same planner, approval and scheduling code as the Coach and the screens.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ToolCtx } from "./coach-tools.server";
import { addDaysKey, isoDowOfKey, localDayKey, weekKeyOf, zonedInstant } from "./tz";

type Db = SupabaseClient<Database>;
export type StandingKind = "weekly_plan" | "meals";
type Order = Database["public"]["Tables"]["coach_standing_orders"]["Row"];
type RunCtx = Pick<ToolCtx, "db" | "userId" | "tier" | "tz"> & Partial<ToolCtx>;

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

/** Records (or replaces) the member's standing instruction of this kind. */
export async function recordStandingOrder(
  ctx: RunCtx,
  kind: StandingKind,
  params: Record<string, unknown>,
  opts: { goal_id: string | null; target_weight_kg: number | null },
) {
  const db = await admin();
  let startWeight: number | null = null;
  if (opts.target_weight_kg) {
    const { data: w } = await db
      .from("daily_logs")
      .select("value")
      .eq("user_id", ctx.userId)
      .eq("kind", "weight")
      .order("log_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    startWeight = w?.value != null ? Number(w.value) : null;
  }
  await db
    .from("coach_standing_orders")
    .update({ active: false, ended_reason: "replaced" })
    .eq("user_id", ctx.userId)
    .eq("kind", kind)
    .eq("active", true);
  const { data, error } = await db
    .from("coach_standing_orders")
    .insert({
      user_id: ctx.userId,
      kind,
      params: { ...params, start_weight_kg: startWeight } as never,
      goal_id: opts.goal_id,
      target_weight_kg: opts.target_weight_kg,
      source_message: ctx.messageId ?? null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  await db.from("audit_events").insert({
    user_id: ctx.userId,
    actor_type: "user",
    action: "coach.standing_order_set",
    resource_type: "coach_standing_order",
    resource_id: data.id,
    outcome: "succeeded",
    metadata: {
      kind,
      goal_id: opts.goal_id,
      target_weight_kg: opts.target_weight_kg,
      authorised_by: "member_instruction",
    },
  } as never);
  return {
    standing_order: kind,
    until: opts.target_weight_kg
      ? `weight reaches ${opts.target_weight_kg} kg`
      : opts.goal_id
        ? "the goal is completed"
        : "the member stops it",
  };
}

/** Pure: whether a standing order has reached its end. */
export function orderFinished(
  o: Pick<Order, "target_weight_kg" | "params">,
  goalStatus: string | null | undefined,
  latestWeight: number | null,
): string | null {
  if (goalStatus === "completed") return "goal_completed";
  if (goalStatus === "missing") return "goal_removed";
  const target = o.target_weight_kg == null ? null : Number(o.target_weight_kg);
  if (target != null && latestWeight != null) {
    const start = Number((o.params as Record<string, unknown> | null)?.["start_weight_kg"] ?? NaN);
    const gaining = Number.isFinite(start) ? target > start : true;
    if (gaining ? latestWeight >= target : latestWeight <= target) return "target_weight_reached";
  }
  return null;
}

/** Pure: the next week needs planning from Thursday onwards when it has no goal sessions yet. */
export function needsNextWeek(todayKey: string, nextWeekGoalBlocks: number) {
  return isoDowOfKey(todayKey) >= 4 && nextWeekGoalBlocks === 0;
}

async function endIfFinished(o: Order): Promise<boolean> {
  const db = await admin();
  let goalStatus: string | null = null;
  if (o.goal_id) {
    const { data: g } = await db
      .from("goals")
      .select("status")
      .eq("id", o.goal_id)
      .eq("user_id", o.user_id)
      .maybeSingle();
    goalStatus = g?.status ?? "missing";
  }
  let weight: number | null = null;
  if (o.target_weight_kg != null) {
    const { data: w } = await db
      .from("daily_logs")
      .select("value")
      .eq("user_id", o.user_id)
      .eq("kind", "weight")
      .order("log_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    weight = w?.value != null ? Number(w.value) : null;
  }
  const why = orderFinished(o, goalStatus, weight);
  if (!why) return false;
  await db
    .from("coach_standing_orders")
    .update({ active: false, ended_reason: why })
    .eq("id", o.id);
  await db.from("audit_events").insert({
    user_id: o.user_id,
    actor_type: "system",
    action: "coach.standing_order_ended",
    resource_type: "coach_standing_order",
    resource_id: o.id,
    outcome: "succeeded",
    metadata: { reason: why },
  } as never);
  return true;
}

/** What each active order still has to do (cheap checks with the service client, before any member session is used). */
async function pendingWork(o: Order, tz: string) {
  const db = await admin();
  const today = localDayKey(new Date(), tz);
  if (o.kind === "weekly_plan") {
    const next = addDaysKey(weekKeyOf(new Date(), tz), 7);
    const { count } = await db
      .from("plan_blocks")
      .select("id", { count: "exact", head: true })
      .eq("user_id", o.user_id)
      .eq("source_type", "goal")
      .gte("starts_at", zonedInstant(next, 0, tz).toISOString())
      .lt("starts_at", zonedInstant(addDaysKey(next, 7), 0, tz).toISOString())
      .not("status", "in", "(cancelled,rescheduled)");
    const call = String((o.params as Record<string, unknown>)?.["call_for_sessions"] ?? "none");
    const stale = !o.last_run_at || Date.now() - new Date(o.last_run_at).getTime() > 20 * 3600e3;
    return needsNextWeek(today, count ?? 0) || (call !== "none" && stale);
  }
  const { data } = await db
    .from("commitments")
    .select("on_date")
    .eq("user_id", o.user_id)
    .eq("source", "coach")
    .eq("note", "Meal from nutrition plan")
    .eq("active", true)
    .gte("on_date", today)
    .lte("on_date", addDaysKey(today, 6));
  return new Set((data ?? []).map((r) => r.on_date)).size < 7;
}

/** Runs one member's standing orders with a client scoped to that member (RLS applies). */
export async function runOrdersFor(ctx: RunCtx, orders: Order[]) {
  const tools = await import("./coach-tools.server");
  const out: Record<string, unknown> = {};
  const toolCtx = { actions: [], evidenceRefs: [], safety: [], ...ctx } as ToolCtx;
  const today = localDayKey(new Date(), ctx.tz);
  for (const o of orders) {
    let result: unknown;
    try {
      if (o.kind === "weekly_plan") {
        const p = (o.params ?? {}) as Record<string, unknown>;
        const next = addDaysKey(weekKeyOf(new Date(), ctx.tz), 7);
        const { count } = await ctx.db
          .from("plan_blocks")
          .select("id", { count: "exact", head: true })
          .eq("source_type", "goal")
          .gte("starts_at", zonedInstant(next, 0, ctx.tz).toISOString())
          .lt("starts_at", zonedInstant(addDaysKey(next, 7), 0, ctx.tz).toISOString())
          .not("status", "in", "(cancelled,rescheduled)");
        let planned = 0;
        if (needsNextWeek(today, count ?? 0)) {
          const pf = await import("./planning.functions");
          const prop = (await pf.proposeWeekPlanCore(
            { supabase: ctx.db, userId: ctx.userId },
            { trigger: "system", week: "next" },
          )) as { id: string };
          const r = (await pf.applyProposal(ctx.db, ctx.userId, {
            proposalId: prop.id,
            mode: "permanent",
            trialDays: 14,
          })) as { blocksCreated?: number };
          planned = r.blocksCreated ?? 0;
          await (await admin()).from("audit_events").insert({
            user_id: ctx.userId,
            actor_type: "system",
            action: "plan.week_continued",
            resource_type: "plan_version",
            resource_id: prop.id,
            outcome: "succeeded",
            metadata: {
              authorised_by: "member_standing_instruction",
              standing_order: o.id,
              week_start: next,
            },
          } as never);
        }
        const kind = String(p["call_for_sessions"] ?? "none");
        const calls =
          kind === "training" || kind === "all"
            ? await tools.callsForSessions(toolCtx, kind, Number(p["call_lead_minutes"]) || 0)
            : null;
        result = {
          next_week_sessions_added: planned,
          calls_booked: (calls as { calls_booked?: number } | null)?.calls_booked ?? 0,
        };
      } else {
        result = await tools.rollMeals(toolCtx, (o.params ?? {}) as Record<string, unknown>, today);
      }
    } catch (e) {
      result = { error: (e as Error).message };
    }
    out[o.kind] = result;
    await (
      await admin()
    )
      .from("coach_standing_orders")
      .update({ last_run_at: new Date().toISOString(), last_result: result as never })
      .eq("id", o.id);
  }
  return out;
}

/** A short-lived client acting as the member (RLS applies), minted server-side without sending any email. */
async function memberClient(userId: string): Promise<Db | null> {
  const db = await admin();
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return null;
  const { data: u } = await db.auth.admin.getUserById(userId);
  const email = u?.user?.email;
  if (!email) return null;
  const { data: link, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link?.properties?.hashed_token) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const opts = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  };
  const anon = createClient<Database>(url, key, opts);
  const { data: s } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  const token = s?.session?.access_token;
  if (!token) return null;
  return createClient<Database>(url, key, {
    ...opts,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Background tick: every member with work outstanding on an active standing order. */
export async function runAllStandingOrders(limit = 200) {
  const db = await admin();
  const { data: orders } = await db
    .from("coach_standing_orders")
    .select("*")
    .eq("active", true)
    .order("last_run_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  const byUser = new Map<string, Order[]>();
  for (const o of (orders ?? []) as Order[])
    byUser.set(o.user_id, [...(byUser.get(o.user_id) ?? []), o]);
  let ran = 0;
  for (const [userId, list] of byUser) {
    const live: Order[] = [];
    const { data: prof } = await db
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .maybeSingle();
    const tz = prof?.timezone ?? "UTC";
    for (const o of list) if (!(await endIfFinished(o)) && (await pendingWork(o, tz))) live.push(o);
    if (!live.length) continue;
    const { data: tp } = await db.from("profiles").select("tier").eq("id", userId).maybeSingle();
    const client = await memberClient(userId);
    if (!client) continue;
    await runOrdersFor({ db: client, userId, tz, tier: tp?.tier ?? "free" }, live);
    ran++;
  }
  return { members: ran };
}
