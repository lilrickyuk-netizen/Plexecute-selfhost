import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { FLAG_CATALOGUE, flagDef } from "./flags";

/* V3 §91 admin console. Every function checks the caller's admin role first (own role
   row via RLS), returns aggregates or operational metadata only, and writes
   admin_access_log for lookups and changes. Coach chats and health detail are never returned. */

type Ctx = { supabase: any; userId: string };
async function admin(context: Ctx) {
  const { data } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  if (!(data ?? []).some((r: { role: string }) => r.role === "admin")) throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}
async function log(
  db: any,
  adminId: string,
  action: string,
  target: string | null,
  reason: string | null,
  metadata: object = {},
) {
  await db
    .from("admin_access_log")
    .insert({ admin_id: adminId, action, target_ref: target, reason, metadata });
}
const tally = (rows: Record<string, unknown>[] | null, key: string) => {
  const out: Record<string, number> = {};
  for (const r of rows ?? []) {
    const k = String(r[key] ?? "unknown");
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};
const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
const short = (id: string) => id.slice(0, 8);

/** Users: counts only. Individuals are found by exact email with a stated reason (audited). */
export const adminUsersSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const { data } = await db.from("profiles").select("tier,account_status,onboarded,created_at");
    const rows = data ?? [];
    return {
      total: rows.length,
      onboarded: rows.filter((r) => r.onboarded).length,
      new7: rows.filter((r) => r.created_at >= daysAgo(7)).length,
      new30: rows.filter((r) => r.created_at >= daysAgo(30)).length,
      byTier: tally(rows, "tier"),
      byStatus: tally(rows, "account_status"),
    };
  });

export const adminFindUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(255),
        reason: z.string().trim().min(5).max(300),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const email = data.email.toLowerCase();
    let found: string | null = null;
    for (let page = 1; page <= 50 && !found; page++) {
      const { data: res } = await db.auth.admin.listUsers({ page, perPage: 200 });
      const users = res?.users ?? [];
      found = users.find((u: { email?: string }) => u.email?.toLowerCase() === email)?.id ?? null;
      if (users.length < 200) break;
    }
    await log(db, context.userId, "user_lookup", found, data.reason, { matched: !!found });
    return { userId: found };
  });

/** User details: account metadata, consents, request states and record counts. No content. */
export const adminUserDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const id = data.id;
    const [
      { data: p },
      { data: sub },
      { data: consents },
      { data: reqs },
      { data: camps },
      { data: flags },
      { data: auth },
    ] = await Promise.all([
      db
        .from("profiles")
        .select(
          "tier,account_status,onboarded,timezone,created_at,processing_restricted,calls_enabled",
        )
        .eq("id", id)
        .maybeSingle(),
      db
        .from("subscriptions")
        .select(
          "tier,status,billing_interval,current_period_end,trial_ends_at,trial_used,cancel_at_period_end,provider",
        )
        .eq("user_id", id)
        .maybeSingle(),
      db
        .from("consent_records")
        .select("domain,purpose,action,policy_version,source,occurred_at")
        .eq("user_id", id)
        .order("occurred_at", { ascending: false })
        .limit(50),
      db
        .from("data_rights_requests")
        .select("request_type,status,due_at,created_at")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
      db
        .from("call_campaigns")
        .select("state,attempts,connected_seconds,created_at")
        .eq("user_id", id)
        .gte("created_at", daysAgo(30)),
      db.from("safety_flags").select("id").eq("user_id", id).is("cleared_at", null),
      db.auth.admin.getUserById(id),
    ]);
    if (!p) return { found: false as const };
    const counts: Record<string, number> = {};
    await Promise.all(
      (
        [
          "plan_blocks",
          "workout_sessions",
          "food_entries",
          "coach_messages",
          "health_samples",
        ] as const
      ).map(async (t) => {
        const { count } = await db
          .from(t)
          .select("*", { count: "exact", head: true })
          .eq("user_id", id);
        counts[t] = count ?? 0;
      }),
    );
    await log(db, context.userId, "user_detail_view", id, null);
    return {
      found: true as const,
      ref: short(id),
      profile: p,
      subscription: sub,
      consents: consents ?? [],
      requests: reqs ?? [],
      calls30: {
        campaigns: camps?.length ?? 0,
        byState: tally(camps ?? [], "state"),
        connectedMinutes: Math.round(
          (camps ?? []).reduce((a, c) => a + (c.connected_seconds ?? 0), 0) / 60,
        ),
      },
      activeSafetyNotes: flags?.length ?? 0,
      counts,
      lastSignIn: auth?.user?.last_sign_in_at ?? null,
    };
  });

export const adminSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const [{ data: subs }, { data: ev }, { data: jobs }, { data: led }] = await Promise.all([
      db
        .from("subscriptions")
        .select("tier,status,billing_interval,cancel_at_period_end,trial_ends_at"),
      db
        .from("billing_events")
        .select("type,received_at")
        .gte("received_at", daysAgo(30))
        .order("received_at", { ascending: false }),
      db.from("background_jobs").select("status").eq("kind", "stripe.event"),
      db
        .from("entitlement_ledger")
        .select("capability,amount,reason")
        .gte("created_at", daysAgo(30)),
    ]);
    const s = subs ?? [];
    return {
      byTier: tally(s, "tier"),
      byStatus: tally(s, "status"),
      byInterval: tally(s, "billing_interval"),
      cancelling: s.filter((r) => r.cancel_at_period_end).length,
      trialsActive: s.filter((r) => r.trial_ends_at && r.trial_ends_at > new Date().toISOString())
        .length,
      webhook: {
        last: ev?.[0]?.received_at ?? null,
        count30: ev?.length ?? 0,
        byType: tally(ev ?? [], "type"),
        jobs: tally(jobs ?? [], "status"),
      },
      ledger30: tally(led ?? [], "reason"),
    };
  });

export const adminIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const m = await import("./integrations.server");
    const [{ data: cal }, { data: wear }, { data: health }] = await Promise.all([
      db.from("calendar_connections").select("provider,status"),
      db.from("wearable_connections").select("provider,status"),
      db.from("health_connections").select("platform,status"),
    ]);
    const group = (rows: Record<string, unknown>[] | null, k: string) => {
      const o: Record<string, Record<string, number>> = {};
      for (const r of rows ?? []) {
        const p = String(r[k]);
        o[p] ??= {};
        o[p][String(r["status"])] = (o[p][String(r["status"])] ?? 0) + 1;
      }
      return o;
    };
    return {
      configured: {
        payments: m.stripeConfigured(),
        calls: m.twilioConfigured(),
        email: m.emailConfigured(),
        scheduledRuns: !!m.env("CRON_SECRET"),
      },
      calendars: group(cal, "provider"),
      wearables: group(wear, "provider"),
      healthApps: group(health, "platform"),
    };
  });

export const adminCalls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const { data } = await db
      .from("call_campaigns")
      .select("state,policy,attempts,connected_seconds,stop_reason,trigger")
      .gte("created_at", daysAgo(30));
    const c = data ?? [];
    return {
      campaigns30: c.length,
      byState: tally(c, "state"),
      byPlan: tally(c, "policy"),
      byTrigger: tally(c, "trigger"),
      stopReasons: tally(
        c.filter((r) => r.stop_reason),
        "stop_reason",
      ),
      attempts: c.reduce((a, r) => a + (r.attempts ?? 0), 0),
      connectedMinutes: Math.round(c.reduce((a, r) => a + (r.connected_seconds ?? 0), 0) / 60),
    };
  });

export const adminSafety = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const [{ data: ev }, { data: fl }] = await Promise.all([
      db
        .from("safety_events")
        .select("state,domain,intervention,policy_version")
        .gte("created_at", daysAgo(30)),
      db.from("safety_flags").select("signal,cleared_at"),
    ]);
    return {
      events30: ev?.length ?? 0,
      byState: tally(ev ?? [], "state"),
      byDomain: tally(ev ?? [], "domain"),
      byIntervention: tally(ev ?? [], "intervention"),
      policies: tally(ev ?? [], "policy_version"),
      activeNotes: tally(
        (fl ?? []).filter((f) => !f.cleared_at),
        "signal",
      ),
    };
  });

export const adminKnowledge = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const [{ data: src }, { count: chunks }] = await Promise.all([
      db
        .from("knowledge_sources")
        .select(
          "source_id,title,domain,trust_tier,last_reviewed,review_cadence_months,indexed_at,superseded_by",
        )
        .order("domain"),
      db.from("knowledge_chunks").select("*", { count: "exact", head: true }),
    ]);
    const now = Date.now();
    // Routing record of the latest Coach turns: ids, domains, scores and tool names only. No member text or ids.
    const { data: turns } = await db
      .from("coach_messages")
      .select("created_at,contract")
      .eq("role", "assistant")
      .not("contract->routing", "is", null)
      .order("created_at", { ascending: false })
      .limit(40);
    const routing = (turns ?? []).map((t: any) => ({
      at: t.created_at,
      ...(t.contract?.routing ?? {}),
    }));
    return {
      routing,
      chunks: chunks ?? 0,
      sources: (src ?? []).map((s) => ({
        ...s,
        reviewDue: s.last_reviewed
          ? new Date(s.last_reviewed).getTime() + (s.review_cadence_months ?? 12) * 30.44 * 864e5 <
            now
          : true,
      })),
    };
  });

export const adminExperiments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const { data } = await db
      .from("experiments")
      .select("status,metric,design,policy_version,created_at");
    const e = data ?? [];
    return {
      total: e.length,
      new30: e.filter((r) => r.created_at >= daysAgo(30)).length,
      byStatus: tally(e, "status"),
      byMetric: tally(e, "metric"),
      byDesign: tally(e, "design"),
      policies: tally(e, "policy_version"),
    };
  });

export const adminAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const [{ data: access }, { data: ev }] = await Promise.all([
      db
        .from("admin_access_log")
        .select("id,admin_id,action,target_ref,reason,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      db.from("audit_events").select("action,actor_type,outcome").gte("created_at", daysAgo(7)),
    ]);
    return {
      adminActions: (access ?? []).map((a) => ({
        ...a,
        admin_id: short(a.admin_id),
        target_ref: a.target_ref ? short(a.target_ref) : null,
      })),
      events7: ev?.length ?? 0,
      byAction: tally(ev ?? [], "action"),
      byActor: tally(ev ?? [], "actor_type"),
      byOutcome: tally(ev ?? [], "outcome"),
    };
  });

export const adminQuotas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const since = monthStart.toISOString();
    const [{ data: prov }, { count: coach }, { data: camps }, { count: tools }] = await Promise.all(
      [
        db.from("provider_calls").select("provider,ok").gte("created_at", since),
        db
          .from("coach_messages")
          .select("*", { count: "exact", head: true })
          .eq("role", "assistant")
          .gte("created_at", since),
        db.from("call_campaigns").select("connected_seconds,attempts").gte("created_at", since),
        db
          .from("coach_tool_calls")
          .select("*", { count: "exact", head: true })
          .gte("created_at", since),
      ],
    );
    const byProvider: Record<string, { calls: number; failed: number }> = {};
    for (const r of prov ?? []) {
      const p = (byProvider[r.provider] ??= { calls: 0, failed: 0 });
      p.calls++;
      if (!r.ok) p.failed++;
    }
    return {
      since,
      byProvider,
      coachReplies: coach ?? 0,
      coachToolCalls: tools ?? 0,
      callAttempts: (camps ?? []).reduce((a, c) => a + (c.attempts ?? 0), 0),
      callMinutes: Math.round(
        (camps ?? []).reduce((a, c) => a + (c.connected_seconds ?? 0), 0) / 60,
      ),
    };
  });

/** Step 89: measured usage for cost (COGS) review — quantities by tier, provider, feature, market and platform for one service month. Totals only. */
export const adminUnitEconomics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const { data: rows, error } = await db.rpc("usage_summary", { _month: `${data.month}-01` });
    if (error) throw new Error("Usage could not be loaded.");
    return {
      month: data.month,
      rows: (rows ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        quantity: Number(r["quantity"]),
        events: Number(r["events"]),
        failed: Number(r["failed"]),
        members: Number(r["members"]),
      })) as {
        tier: string;
        provider: string;
        feature: string;
        unit: string;
        market: string;
        platform: string;
        quantity: number;
        events: number;
        failed: number;
        members: number;
      }[],
    };
  });

/* Flags */
export const adminFlags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const { data } = await db.from("feature_flags").select("key,enabled,cap_value,note,updated_at");
    const rows = new Map((data ?? []).map((r) => [r.key, r]));
    return FLAG_CATALOGUE.map((f) => ({
      ...f,
      enabled: rows.get(f.key)?.enabled ?? true,
      cap: rows.get(f.key)?.cap_value ?? null,
      note: rows.get(f.key)?.note ?? null,
      updatedAt: rows.get(f.key)?.updated_at ?? null,
    }));
  });

export const adminSetFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        key: z.string(),
        enabled: z.boolean(),
        cap: z.number().int().min(0).nullable().optional(),
        note: z.string().trim().min(3).max(300),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const def = flagDef(data.key);
    if (!def) throw new Error("Unknown flag.");
    const cap = def.kind === "cap" ? Math.min(data.cap ?? 0, def.maxCap ?? 0) : null;
    await db.from("feature_flags").upsert({
      key: data.key,
      enabled: data.enabled,
      cap_value: cap,
      note: data.note,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    });
    await log(db, context.userId, "flag_change", null, data.note, {
      key: data.key,
      enabled: data.enabled,
      cap,
    });
    return { ok: true };
  });

/* Incidents */
const incidentInput = z.object({
  title: z.string().trim().min(3).max(120),
  member_message: z.string().trim().min(10).max(500),
  severity: z.enum(["minor", "major", "critical"]),
  affected: z.array(z.string().max(40)).max(10).default([]),
});
export const adminIncidents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const { data } = await db
      .from("incidents")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(50);
    return data ?? [];
  });
export const adminOpenIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => incidentInput.parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const { data: row, error } = await db
      .from("incidents")
      .insert({ ...data, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error("Couldn't open the incident.");
    await log(db, context.userId, "incident_open", row.id, data.title, { severity: data.severity });
    return { id: row.id };
  });
export const adminUpdateIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["investigating", "monitoring", "resolved"]),
        member_message: z.string().trim().min(10).max(500).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = await admin(context);
    const now = new Date().toISOString();
    await db
      .from("incidents")
      .update({
        status: data.status,
        ...(data.member_message ? { member_message: data.member_message } : {}),
        resolved_at: data.status === "resolved" ? now : null,
        updated_at: now,
      })
      .eq("id", data.id);
    await log(db, context.userId, "incident_update", data.id, null, { status: data.status });
    return { ok: true };
  });
