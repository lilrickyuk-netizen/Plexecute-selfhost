import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* Owner Control Centre (docs/OWNER_CONTROL_CENTRE_SPEC.md). Admin role is checked first via
   the caller's own user_roles row; members appear only as short codes (M-XXXXXXXX), never
   names, emails, health values, coach content or call content. Every lookup and change is
   written to admin_access_log. Aggregates run in SQL (owner_overview) and lists are paginated. */

type Ctx = { supabase: any; userId: string };
async function owner(context: Ctx) {
  const { data } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  if (!(data ?? []).some((r: { role: string }) => r.role === "admin")) throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function audit(db: any, adminId: string, action: string, target: string | null, meta = {}) {
  await db.from("admin_access_log").insert({
    admin_id: adminId,
    action,
    target_ref: target,
    reason: "owner_control_centre",
    metadata: meta,
  });
}
export const memberCode = (id: string) => `M-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
function codeRange(code: string) {
  const hex = code
    .replace(/^M-/i, "")
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .slice(0, 8);
  if (!hex) return null;
  const lo = hex.padEnd(8, "0"),
    hi = hex.padEnd(8, "f");
  return [`${lo}-0000-0000-0000-000000000000`, `${hi}-ffff-ffff-ffff-ffffffffffff`] as const;
}

export const RANGES = [
  "today",
  "7d",
  "30d",
  "service_month",
  "prev_service_month",
  "quarter",
  "year",
  "custom",
] as const;
export function resolveRange(r: string, from?: string, to?: string, now = new Date()) {
  const d = (y: number, m: number, day = 1) => new Date(Date.UTC(y, m, day));
  const y = now.getUTCFullYear(),
    m = now.getUTCMonth();
  switch (r) {
    case "today":
      return { from: d(y, m, now.getUTCDate()), to: now };
    case "7d":
      return { from: new Date(+now - 7 * 864e5), to: now };
    case "service_month":
      return { from: d(y, m), to: now };
    case "prev_service_month":
      return { from: d(y, m - 1), to: d(y, m) };
    case "quarter":
      return { from: d(y, m - (m % 3)), to: now };
    case "year":
      return { from: d(y, 0), to: now };
    case "custom":
      return from && to
        ? { from: new Date(from), to: new Date(to) }
        : { from: new Date(+now - 30 * 864e5), to: now };
    default:
      return { from: new Date(+now - 30 * 864e5), to: now };
  }
}
const rangeInput = z.object({
  range: z.enum(RANGES).default("30d"),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
type OverviewRow = {
  total: number;
  free: number;
  pro: number;
  execute: number;
  paying: number;
  newToday: number;
  new7: number;
  new30: number;
  newInRange: number;
  activeInRange: number;
  wau: number;
  lifeAudit: number;
  planAccepted: number;
  retained30: number;
  eligible30: number;
  retained90: number;
  eligible90: number;
  cancelling: number;
  pastDue: number;
  billingEvents: number;
  rewardsEarned: number;
  rewardsApplied: number;
  blocksPlanned: number;
  blocksDone: number;
  voiceSeconds: number;
  calls: number;
  callsAnswered: number;
  callsAcked: number;
  supportOpen: number;
  feedbackOpen: number;
  jobFailures: number;
  integrationFailures: number;
  incidentsOpen: number;
};
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

export const ownerOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => rangeInput.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    const { from, to } = resolveRange(data.range, data.from, data.to);
    const { data: raw, error } = await context.supabase.rpc("owner_overview", {
      _from: from.toISOString(),
      _to: to.toISOString(),
    });
    if (error) throw new Error(error.message);
    const o = raw as unknown as OverviewRow;
    const { data: subs } = await db.from("subscriptions").select("tier,status,billing_interval");
    const stripeOn = Boolean(process.env["STRIPE_SECRET_KEY"]);
    await audit(db, context.userId, "owner_overview", null, { range: data.range });
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      ...o,
      revenueSource: stripeOn ? "stripe" : "not_connected",
      // MRR is only computed from provider-confirmed subscriptions; with no payment provider it is unknown.
      mrrPence: stripeOn ? mrrFromSubs(subs ?? []) : null,
      retention30: pct(o.retained30, o.eligible30),
      retention90: pct(o.retained90, o.eligible90),
      churnRate: pct(o.cancelling, o.paying),
      lifeAuditRate: pct(o.lifeAudit, o.total),
      activationRate: pct(o.planAccepted, o.total),
      completionRate: pct(o.blocksDone, o.blocksPlanned),
      ackRate: pct(o.callsAcked, o.callsAnswered),
    };
  });

const PRICE_PENCE: Record<string, Record<string, number>> = {
  pro: { month: 2399, year: Math.round(23999 / 12) },
  execute: { month: 5999, year: Math.round(59999 / 12) },
};
function mrrFromSubs(rows: { tier: string; status: string; billing_interval: string | null }[]) {
  let total = 0;
  for (const r of rows)
    if (r.status === "active" || r.status === "past_due")
      total += PRICE_PENCE[r.tier]?.[r.billing_interval ?? "month"] ?? 0;
  return total;
}

const usersInput = z.object({
  page: z.number().int().min(0).max(100000).default(0),
  pageSize: z.number().int().min(10).max(100).default(25),
  code: z.string().max(12).optional(),
  tier: z.enum(["free", "pro", "execute"]).optional(),
  onboarded: z.boolean().optional(),
  source: z.string().max(40).optional(),
  sort: z.enum(["newest", "oldest"]).default("newest"),
});
export const ownerUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => usersInput.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    let q = db
      .from("profiles")
      .select("id,tier,onboarded,created_at,acquisition_source,account_status,life_audit", {
        count: "exact",
      })
      .neq("account_status", "deleted");
    if (data.tier) q = q.eq("tier", data.tier);
    if (data.onboarded !== undefined) q = q.eq("onboarded", data.onboarded);
    if (data.source) q = q.eq("acquisition_source", data.source);
    if (data.code) {
      const r = codeRange(data.code);
      if (r) q = q.gte("id", r[0]).lte("id", r[1]);
    }
    const start = data.page * data.pageSize;
    const {
      data: rows,
      count,
      error,
    } = await q
      .order("created_at", { ascending: data.sort === "oldest" })
      .range(start, start + data.pageSize - 1);
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r) => r.id);
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    if (!ids.length)
      return { total: count ?? 0, page: data.page, pageSize: data.pageSize, rows: [] };
    const [subs, rewards, plans, acts, support, calls] = await Promise.all([
      db
        .from("subscriptions")
        .select("user_id,status,trial_ends_at,current_period_end,cancel_at_period_end")
        .in("user_id", ids),
      db
        .from("execution_rewards")
        .select("user_id,state,completed_count,required_count,created_at")
        .in("user_id", ids)
        .order("created_at", { ascending: false }),
      db.from("plan_versions").select("user_id").in("user_id", ids).not("approved_at", "is", null),
      db
        .from("plan_block_events")
        .select("user_id,occurred_at")
        .in("user_id", ids)
        .eq("actor_type", "user")
        .order("occurred_at", { ascending: false })
        .limit(2000),
      db.from("support_requests").select("user_id,status").in("user_id", ids),
      db.from("call_logs").select("user_id,connected_seconds").in("user_id", ids),
    ]);
    const first = <T extends { user_id: string }>(arr: T[] | null) => {
      const m = new Map<string, T>();
      for (const r of arr ?? []) if (!m.has(r.user_id)) m.set(r.user_id, r);
      return m;
    };
    const subM = first(subs.data),
      rewM = first(rewards.data),
      actM = first(acts.data);
    const planS = new Set((plans.data ?? []).map((r) => r.user_id));
    const supS = new Set(
      (support.data ?? []).filter((r) => r.status !== "CLOSED").map((r) => r.user_id),
    );
    const voice = new Map<string, number>();
    for (const c of calls.data ?? [])
      voice.set(c.user_id, (voice.get(c.user_id) ?? 0) + (c.connected_seconds ?? 0));
    await audit(db, context.userId, "owner_users_list", null, { page: data.page });
    return {
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
      rows: (rows ?? []).map((p) => {
        const s = subM.get(p.id),
          w = rewM.get(p.id),
          a = actM.get(p.id);
        return {
          code: memberCode(p.id),
          signup: p.created_at,
          source: p.acquisition_source,
          tier: p.tier,
          subscription: s?.status ?? "none",
          trial: s?.status === "trialing",
          renewal: s?.current_period_end ?? null,
          cancelling: Boolean(s?.cancel_at_period_end),
          onboarded: p.onboarded,
          lifeAudit: Boolean(p.life_audit && Object.keys(p.life_audit as object).length),
          planAccepted: planS.has(p.id),
          lastActivity: a?.occurred_at ?? null,
          activeThisWeek: Boolean(a && a.occurred_at >= since),
          reward: w?.state ?? null,
          monthCompletion:
            w && w.required_count ? Math.round((w.completed_count / w.required_count) * 100) : null,
          voiceMinutes: Math.round((voice.get(p.id) ?? 0) / 60),
          supportFlag: supS.has(p.id),
        };
      }),
    };
  });

async function resolveCode(db: any, code: string) {
  const r = codeRange(code);
  if (!r || code.replace(/^M-/i, "").length !== 8) throw new Error("Unknown member code");
  const { data } = await db.from("profiles").select("id").gte("id", r[0]).lte("id", r[1]).limit(2);
  if (!data || data.length !== 1) throw new Error("Unknown member code");
  return data[0].id as string;
}

export const ownerUserDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ code: z.string().min(10).max(12) }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    const id = await resolveCode(db, data.code);
    const [p, plans, blocks, calls, sub, rewards, outcomes, support, notes, cancel, firstDone] =
      await Promise.all([
        db
          .from("profiles")
          .select(
            "tier,created_at,onboarded,life_audit,acquisition_source,calls_stopped_at,account_status",
          )
          .eq("id", id)
          .single(),
        db
          .from("plan_versions")
          .select("version,status,approved_at,created_at")
          .eq("user_id", id)
          .order("created_at", { ascending: false })
          .limit(20),
        db
          .from("plan_blocks")
          .select("status,starts_at")
          .eq("user_id", id)
          .gte("starts_at", new Date(Date.now() - 30 * 864e5).toISOString())
          .limit(5000),
        db
          .from("call_logs")
          .select("outcome,connected_seconds,created_at")
          .eq("user_id", id)
          .order("created_at", { ascending: false })
          .limit(500),
        db
          .from("subscriptions")
          .select(
            "tier,status,trial_ends_at,current_period_start,current_period_end,cancel_at_period_end,billing_interval",
          )
          .eq("user_id", id)
          .maybeSingle(),
        db
          .from("execution_rewards")
          .select(
            "period_start,period_end,state,completed_count,required_count,amount_pence,applied_at",
          )
          .eq("user_id", id)
          .order("period_start", { ascending: false })
          .limit(12),
        db.from("outcome_ledger").select("evidence_class").eq("user_id", id).limit(5000),
        db
          .from("support_requests")
          .select("id,category,status,severity,created_at,resolved_at")
          .eq("user_id", id)
          .order("created_at", { ascending: false })
          .limit(50),
        db
          .from("owner_notes")
          .select("id,note,created_at")
          .eq("user_id", id)
          .order("created_at", { ascending: false })
          .limit(50),
        db
          .from("cancellation_reasons")
          .select("reason,created_at")
          .eq("user_id", id)
          .order("created_at", { ascending: false })
          .limit(1),
        db
          .from("plan_blocks")
          .select("completed_at")
          .eq("user_id", id)
          .eq("status", "done")
          .order("completed_at")
          .limit(1),
      ]);
    const bc: Record<string, number> = {};
    for (const b of blocks.data ?? []) bc[b.status] = (bc[b.status] ?? 0) + 1;
    const ev: Record<string, number> = {};
    for (const o of outcomes.data ?? [])
      ev[o.evidence_class ?? "unclassified"] = (ev[o.evidence_class ?? "unclassified"] ?? 0) + 1;
    const c = calls.data ?? [];
    await audit(db, context.userId, "owner_user_detail", data.code);
    return {
      code: data.code.toUpperCase(),
      activation: {
        signup: p.data?.created_at,
        lifeAudit: Boolean(p.data?.life_audit && Object.keys(p.data.life_audit as object).length),
        firstPlanAccepted:
          (plans.data ?? []).filter((v) => v.approved_at).at(-1)?.approved_at ?? null,
        firstTaskCompleted: firstDone.data?.[0]?.completed_at ?? null,
        firstCall: c.at(-1)?.created_at ?? null,
        source: p.data?.acquisition_source,
      },
      execution: {
        last30: bc,
        versions: (plans.data ?? []).length,
        accepted: (plans.data ?? []).filter((v) => v.approved_at).length,
      },
      accountability: {
        attempts: c.length,
        answered: c.filter((x) => (x.connected_seconds ?? 0) > 0).length,
        outcomes: c.reduce<Record<string, number>>(
          (a, x) => ((a[x.outcome ?? "none"] = (a[x.outcome ?? "none"] ?? 0) + 1), a),
          {},
        ),
        voiceMinutes: Math.round(c.reduce((s, x) => s + (x.connected_seconds ?? 0), 0) / 60),
        stopAll: Boolean(p.data?.calls_stopped_at),
      },
      commercial: {
        tier: p.data?.tier,
        subscription: sub.data,
        rewards: rewards.data ?? [],
        cancellationReason: cancel.data?.[0] ?? null,
      },
      outcomes: { byEvidence: ev, total: (outcomes.data ?? []).length },
      support: support.data ?? [],
      notes: notes.data ?? [],
    };
  });

export const ownerAddNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ code: z.string().min(10).max(12), note: z.string().trim().min(1).max(2000) })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    const id = await resolveCode(db, data.code);
    const { error } = await db
      .from("owner_notes")
      .insert({ user_id: id, author_id: context.userId, note: data.note });
    if (error) throw new Error(error.message);
    await audit(db, context.userId, "owner_add_note", data.code);
    return { ok: true };
  });

export const ownerSetSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        code: z.string().min(10).max(12),
        source: z.enum([
          "Waiting List",
          "Founding Tester",
          "Organic",
          "Paid Marketing",
          "Referral",
          "Partnership",
          "Other",
        ]),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    const id = await resolveCode(db, data.code);
    await db.from("profiles").update({ acquisition_source: data.source }).eq("id", id);
    await audit(db, context.userId, "owner_set_source", data.code, { source: data.source });
    return { ok: true };
  });

/* Support workspace: OPEN → INVESTIGATING → FIXED → CLOSED. */
export const ownerSupport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ status: z.string().max(20).optional(), page: z.number().int().min(0).default(0) })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    let q = db
      .from("support_requests")
      .select(
        "id,user_id,category,tier,priority,severity,status,created_at,resolved_at,resolution",
        { count: "exact" },
      );
    if (data.status) q = q.in("status", data.status === "OPEN" ? ["OPEN", "open"] : [data.status]);
    const { data: rows, count } = await q
      .order("created_at", { ascending: false })
      .range(data.page * 25, data.page * 25 + 24);
    await audit(db, context.userId, "owner_support_list", null);
    return {
      total: count ?? 0,
      rows: (rows ?? []).map(({ user_id, ...r }) => ({
        ...r,
        status: r.status === "open" ? "OPEN" : r.status,
        member: user_id ? memberCode(user_id) : null,
      })),
    };
  });
export const ownerUpdateSupport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["OPEN", "INVESTIGATING", "FIXED", "CLOSED"]),
        severity: z.enum(["low", "normal", "high", "critical"]).optional(),
        resolution: z.string().max(2000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    const done = data.status === "FIXED" || data.status === "CLOSED";
    const { error } = await db
      .from("support_requests")
      .update({
        status: data.status,
        ...(data.severity ? { severity: data.severity } : {}),
        resolution: data.resolution ?? null,
        assigned_to: context.userId,
        resolved_at: done ? new Date().toISOString() : null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(db, context.userId, "owner_support_update", data.id, { status: data.status });
    return { ok: true };
  });

export const FEEDBACK_CATEGORIES = [
  "bug",
  "confusing_ux",
  "poor_recommendation",
  "accountability",
  "billing",
  "integration",
  "missing_feature",
  "positive",
  "other",
] as const;
export const ownerFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ page: z.number().int().min(0).default(0) }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    const { data: rows, count } = await db
      .from("owner_feedback")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.page * 25, data.page * 25 + 24);
    await audit(db, context.userId, "owner_feedback_list", null, { page: data.page });
    return {
      total: count ?? 0,
      rows: (rows ?? []).map(({ user_id, created_by: _c, ...r }) => ({
        ...r,
        member: user_id ? memberCode(user_id) : null,
      })),
    };
  });
export const ownerSaveFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        code: z.string().max(12).optional(),
        category: z.enum(FEEDBACK_CATEGORIES),
        severity: z.enum(["low", "normal", "high", "critical"]),
        notes: z.string().trim().min(1).max(4000),
        source: z.string().trim().max(60).default("owner"),
        status: z.enum(["OPEN", "INVESTIGATING", "FIXED", "CLOSED"]).default("OPEN"),
        resolution: z.string().max(2000).optional(),
        linked_ref: z.string().max(120).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    const user_id = data.code ? await resolveCode(db, data.code) : null;
    const row = {
      category: data.category,
      severity: data.severity,
      notes: data.notes,
      source: data.source,
      status: data.status,
      resolution: data.resolution ?? null,
      linked_ref: data.linked_ref ?? null,
      updated_at: new Date().toISOString(),
    };
    const res = data.id
      ? await db.from("owner_feedback").update(row).eq("id", data.id)
      : await db.from("owner_feedback").insert({ ...row, user_id, created_by: context.userId });
    if (res.error) throw new Error(res.error.message);
    await audit(
      db,
      context.userId,
      data.id ? "owner_feedback_update" : "owner_feedback_create",
      data.id ?? null,
    );
    return { ok: true };
  });

/* Member-side, analytics only: never blocks or delays cancellation. */
export const CANCEL_REASONS = [
  "too_expensive",
  "not_used_enough",
  "not_helpful",
  "calling_not_useful",
  "too_complicated",
  "missing_feature",
  "technical_problem",
  "privacy_concern",
  "other",
] as const;
export const submitCancellationReason = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ reason: z.enum(CANCEL_REASONS), details: z.string().trim().max(1000).optional() })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: p } = await context.supabase
      .from("profiles")
      .select("tier")
      .eq("id", context.userId)
      .single();
    const { error } = await context.supabase.from("cancellation_reasons").insert({
      user_id: context.userId,
      reason: data.reason,
      details: data.details || null,
      tier: p?.tier ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** MRR/ARR from provider-confirmed active subscriptions at list price; null when Stripe is not
    connected so nothing is ever estimated. Yearly plans count as 1/12 per month. */
export function computeMoney(
  active: Record<string, number>,
  PRODUCTS: {
    pro: { month: { pence: number }; year: { pence: number } };
    execute: { month: { pence: number }; year: { pence: number } };
  },
  stripeOn: boolean,
) {
  if (!stripeOn) return null;
  const monthly = (tier: "pro" | "execute") =>
    (active[`${tier}_month`] ?? 0) * PRODUCTS[tier].month.pence +
    Math.round(((active[`${tier}_year`] ?? 0) * PRODUCTS[tier].year.pence) / 12);
  const pro = monthly("pro"),
    execute = monthly("execute");
  const paying = Object.values(active).reduce((x, n) => x + n, 0);
  return {
    mrr: pro + execute,
    arr: (pro + execute) * 12,
    pro,
    execute,
    annualPlans: (active["pro_year"] ?? 0) + (active["execute_year"] ?? 0),
    arppu: paying ? Math.round((pro + execute) / paying) : null,
  };
}

/* Revenue, Retention, Execution, Calls, AI & provider usage, Unit economics — one SQL aggregate
   (owner_analytics). Money appears only where real: list prices of provider-confirmed
   subscriptions (src/lib/billing.ts PRODUCTS) when Stripe is connected; provider costs are never
   estimated because usage is recorded as quantities only (src/lib/usage.server.ts). */
export const ownerAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => rangeInput.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    const { from, to } = resolveRange(data.range, data.from, data.to);
    const { data: raw, error } = await context.supabase.rpc("owner_analytics", {
      _from: from.toISOString(),
      _to: to.toISOString(),
    });
    if (error) throw new Error(error.message);
    const { PRODUCTS } = await import("./billing");
    const stripeOn = Boolean(process.env["STRIPE_SECRET_KEY"]);
    const a = raw as unknown as OwnerAnalytics;
    await audit(db, context.userId, "owner_analytics", null, { range: data.range });
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      stripeOn,
      money: computeMoney(a.revenue.active, PRODUCTS, stripeOn),
      ...a,
    };
  });
type Counts = Record<string, number>;
type Ret = Record<string, { eligible: number; kept: number }>;
export type OwnerAnalytics = {
  revenue: {
    active: Counts;
    trialing: number;
    newSubs: number;
    cancelling: number;
    cancelled: number;
    pastDue: number;
    bySource: Counts;
    byCohort: Counts;
    topups: number;
    billingEventTypes: Counts;
    rewardsEarned: number;
    rewardsApplied: number;
    rewardPenceApplied: number;
  };
  retention: {
    overall: Ret;
    byTier: Record<string, Ret>;
    bySource: Record<string, Ret>;
    byCohort: Record<string, Ret>;
    paying: number;
    cancelled: number;
    cancelling: number;
    inactive30: number;
  };
  execution: {
    members: number;
    lifeAudit: number;
    planAccepted: number;
    versionsInRange: number;
    acceptedInRange: number;
    recoveryUses: number;
    blocks: Counts;
    movedBlocks: number;
    movedDone: number;
    rewards: Counts;
    outcomes: number;
    evidence: Counts;
  };
  calls: {
    campaigns: number;
    campaignsByTier: Counts;
    campaignStates: Counts;
    attempts: number;
    answered: number;
    busy: number;
    noAnswer: number;
    failed: number;
    machine: number;
    acked: number;
    retries: number;
    connectedSeconds: number;
    connectedByTier: Counts;
    stopAll: number;
    providerErrors: number;
  };
  usage: {
    rows: {
      provider: string;
      feature: string;
      unit: string;
      tier: string;
      quantity: number;
      events: number;
      failed: number;
      members: number;
    }[];
    providers: { provider: string; calls: number; failed: number; latency: number | null }[];
    activeByTier: Counts;
  };
};

/* Saved cohorts (spec COHORTS). Rules filter members in SQL (owner_cohort_metrics); campaign and
   geography are not recorded by Plexecute, so they are not offered as filters. */
export const SOURCES = [
  "Waiting List",
  "Founding Tester",
  "Organic",
  "Paid Marketing",
  "Referral",
  "Partnership",
  "Other",
] as const;
export const cohortRules = z
  .object({
    signup_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    signup_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    tier: z.enum(["free", "pro", "execute"]).optional(),
    source: z.enum(SOURCES).optional(),
    sub_state: z.enum(["none", "trialing", "active", "past_due", "canceled"]).optional(),
    paying_only: z.enum(["true"]).optional(),
    active: z.enum(["true", "false"]).optional(),
    first_n: z.coerce.number().int().min(1).max(1_000_000).optional(),
    tag: z.string().trim().min(1).max(40).optional(),
  })
  .strict();
export type CohortRules = z.infer<typeof cohortRules>;
export type CohortMetrics = {
  members: number;
  lifeAudit: number;
  planAccepted: number;
  activeWeek: number;
  active30: number;
  blocksPlanned: number;
  blocksDone: number;
  rewardsEarned: number;
  paying: number;
  renewed: number;
  cancelled: number;
  byTier: Record<string, number>;
  supportIssues: number;
  callCampaigns: number;
  connectedSeconds: number;
  aiEvents: number;
  outcomes: number;
};

/** Built-in comparisons the spec asks to be permanent. */
export const PRESET_COHORTS: { name: string; rules: CohortRules }[] = [
  { name: "First 100 users", rules: { first_n: 100 } },
  { name: "First 100 paying users", rules: { paying_only: "true", first_n: 100 } },
  { name: "First 1,000 paying users", rules: { paying_only: "true", first_n: 1000 } },
  { name: "Pro members", rules: { tier: "pro" } },
  { name: "Execute members", rules: { tier: "execute" } },
  { name: "Founding testers", rules: { source: "Founding Tester" } },
];

export const ownerCohorts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await owner(context);
    const { data } = await db
      .from("owner_cohorts")
      .select("id,name,rules,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    const { data: tags } = await db.from("owner_member_tags").select("tag").limit(5000);
    await audit(db, context.userId, "owner_cohorts_list", null);
    return {
      saved: (data ?? []) as { id: string; name: string; rules: CohortRules; created_at: string }[],
      presets: PRESET_COHORTS,
      tags: [...new Set((tags ?? []).map((t: { tag: string }) => t.tag))].sort(),
    };
  });

export const ownerSaveCohort = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ name: z.string().trim().min(1).max(80), rules: cohortRules }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    const { error } = await db
      .from("owner_cohorts")
      .insert({ name: data.name, rules: data.rules, created_by: context.userId });
    if (error) throw new Error(error.message);
    await audit(db, context.userId, "owner_save_cohort", null, { name: data.name });
    return { ok: true };
  });

export const ownerDeleteCohort = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    await db.from("owner_cohorts").delete().eq("id", data.id);
    await audit(db, context.userId, "owner_delete_cohort", data.id);
    return { ok: true };
  });

export const ownerCohortMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ rules: cohortRules }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    const { data: r, error } = await context.supabase.rpc("owner_cohort_metrics", {
      _rules: data.rules,
    });
    if (error) throw new Error(error.message);
    await audit(db, context.userId, "owner_cohort_metrics", null, { rules: data.rules });
    return r as unknown as CohortMetrics;
  });

export const ownerTagMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        code: z.string().min(10).max(12),
        tag: z.string().trim().min(1).max(40),
        remove: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    const id = await resolveCode(db, data.code);
    if (data.remove)
      await db.from("owner_member_tags").delete().eq("user_id", id).eq("tag", data.tag);
    else
      await db
        .from("owner_member_tags")
        .upsert({ user_id: id, tag: data.tag, created_by: context.userId });
    await audit(
      db,
      context.userId,
      data.remove ? "owner_untag_member" : "owner_tag_member",
      data.code,
      { tag: data.tag },
    );
    return { ok: true };
  });

export const ownerMemberTags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ code: z.string().min(10).max(12) }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    const id = await resolveCode(db, data.code);
    const { data: t } = await db.from("owner_member_tags").select("tag").eq("user_id", id);
    await audit(db, context.userId, "owner_member_tags", data.code);
    return (t ?? []).map((x: { tag: string }) => x.tag) as string[];
  });

/* Releases: what is actually deployed — rule-set versions, flags, migrations applied. Release
   notes and test status come from docs kept in the repo; nothing is invented. */
export const ownerRelease = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await owner(context);
    const { ENGINE_VERSIONS } = await import("./versions");
    const { data: flags } = await db.from("feature_flags").select("*").limit(200);
    await audit(db, context.userId, "owner_release", null);
    return {
      environment: process.env["APP_ENV"] ?? "Not set",
      appVersion: process.env["APP_RELEASE"] ?? null,
      deployedAt: process.env["DEPLOYED_AT"] ?? null,
      engines: ENGINE_VERSIONS as Record<string, string>,
      flags: (flags ?? []).map((f: { key: string; enabled: boolean; note: string | null }) => ({
        key: f.key,
        enabled: f.enabled,
        note: f.note ?? "",
      })),
    };
  });

/** Appointment booking and allowance/credit metrics from real records (last 30 days). Aggregates only. */
export const ownerBookingsSpend = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await owner(context);
    await audit(db, context.userId, "owner_bookings_spend", null);
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [{ data: bk }, { data: sp }, { data: cr }, { data: calls }] = await Promise.all([
      db
        .from("appointment_bookings")
        .select(
          "status,method,failure_reason,replaces_booking_id,kind,category,payment_state,checkout_created_at",
        )
        .gte("created_at", since)
        .limit(5000),
      db
        .from("spend_ledger")
        .select("kind,feature,provider_cost_micro,retail_micro,funded_by")
        .gte("created_at", since)
        .limit(50000),
      db
        .from("ai_credit_ledger")
        .select("reason,amount_micro")
        .gte("created_at", since)
        .limit(20000),
      db
        .from("call_logs")
        .select("duration_sec")
        .not("booking_id", "is", null)
        .gte("created_at", since)
        .limit(5000),
    ]);
    const b = bk ?? [];
    const reasons: Record<string, number> = {};
    for (const x of b)
      if (x.status === "failed" && x.failure_reason)
        reasons[x.failure_reason] = (reasons[x.failure_reason] ?? 0) + 1;
    const sum = (rows: { provider_cost_micro: number }[]) =>
      rows.reduce((s, r) => s + Number(r.provider_cost_micro), 0) / 1e6;
    const s = sp ?? [];
    const bookingAi = s.filter(
      (r) => r.feature === "appointment_search" || r.feature === "coach_chat",
    );
    const confirmed = b.filter((x) => x.status === "confirmed").length;
    return {
      attempts: b.length,
      online: b.filter((x) => x.method === "online").length,
      phone: b.filter((x) => x.method === "phone").length,
      confirmed,
      failed: b.filter((x) => x.status === "failed").length,
      cancelled: b.filter((x) => x.status === "cancelled").length,
      reschedules: b.filter((x) => x.replaces_booking_id).length,
      appointments: b.filter((x) => x.kind === "appointment").length,
      reservations: b.filter((x) => x.kind === "reservation").length,
      restaurantReservations: b.filter((x) => x.category === "restaurant").length,
      orders: b.filter((x) => x.kind === "order").length,
      checkoutHandoffs: b.filter((x) => x.checkout_created_at).length,
      paidConfirmed: b.filter((x) => x.payment_state === "paid_confirmed").length,
      checkoutsExpired: b.filter((x) => x.payment_state === "expired").length,
      checkoutsAbandoned: b.filter((x) => x.payment_state === "abandoned").length,
      bookingCallMinutes: Math.round(
        (calls ?? []).reduce((t, c) => t + (c.duration_sec ?? 0), 0) / 60,
      ),
      topFailures: Object.entries(reasons)
        .sort((a, z) => z[1] - a[1])
        .slice(0, 5),
      aiCostGbp: sum(s.filter((r) => r.kind === "ai")),
      callCostGbp: sum(s.filter((r) => r.kind === "call")),
      retailGbp: s.reduce((t, r) => t + Number(r.retail_micro), 0) / 1e6,
      creditSpentGbp: sum(s.filter((r) => r.funded_by === "credit")),
      overAllowanceGbp: sum(s.filter((r) => r.funded_by === "over")),
      creditPurchases: (cr ?? []).filter((r) => r.reason === "purchase").length,
      creditSoldGbp: (cr ?? []).filter((r) => r.reason === "purchase").length * 10,
      avgCostPerConfirmedBookingGbp: confirmed
        ? (sum(bookingAi) + sum(s.filter((r) => r.kind === "call"))) / confirmed
        : null,
    };
  });

/** Journey Planning metrics: real counts only, no member-identifiable data. */
export const ownerJourneys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await owner(context);
    await audit(db, context.userId, "owner_journeys", null);
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [{ data: js }, { data: ev }, { data: usage }] = await Promise.all([
      db.from("journeys").select("mode,status,traffic_aware").gte("created_at", since).limit(10000),
      db.from("journey_events").select("kind").gte("created_at", since).limit(20000),
      db
        .from("usage_events")
        .select("feature,ok,quantity")
        .eq("provider", "google_maps")
        .gte("created_at", since)
        .limit(20000),
    ]);
    const journeys = js ?? [];
    const events = ev ?? [];
    const api = usage ?? [];
    const count = (
      rows: { kind?: string; status?: string; mode?: string }[],
      k: string,
      v: string,
    ) => rows.filter((r) => (r as Record<string, string>)[k] === v).length;
    return {
      journeys: journeys.length,
      driving: count(journeys, "mode", "drive"),
      transit: count(journeys, "mode", "transit"),
      walking: count(journeys, "mode", "walk"),
      trafficAware: journeys.filter((x) => x.traffic_aware).length,
      byStatus: Object.fromEntries(
        [
          "planned",
          "monitoring",
          "leave_soon",
          "in_progress",
          "completed",
          "cancelled",
          "needs_attention",
        ].map((st) => [st, count(journeys, "status", st)]),
      ),
      leaveTimeUpdates: count(events, "kind", "leave_time_updated"),
      leaveCallsScheduled: count(events, "kind", "leave_call_scheduled"),
      googleApiRequests: api.reduce((t, u) => t + Number(u.quantity), 0),
      googleApiFailures: api.filter((u) => !u.ok).length,
    };
  });

/** Life Intelligence aggregates (counts only; no member content). */
export const ownerIntelligence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => rangeInput.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const db = await owner(context);
    const { from, to } = resolveRange(data.range, data.from, data.to);
    const { data: raw, error } = await context.supabase.rpc("owner_intelligence", {
      _from: from.toISOString(),
      _to: to.toISOString(),
    });
    if (error) throw new Error(error.message);
    await audit(db, context.userId, "owner_intelligence", null, { range: data.range });
    return raw as unknown as {
      multiDomain: number;
      dailyBriefs: number;
      weeklyReviews: number;
      signals: number;
      signalsAccepted: number;
      conflicts: number;
      goalsBehind: number;
      blockers: number;
      confidence: Record<string, number>;
      failureReasons: Record<string, number>;
      goalDomains: Record<string, number>;
    };
  });
