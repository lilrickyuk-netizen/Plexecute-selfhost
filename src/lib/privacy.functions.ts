import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  EXPORT_TABLES,
  RETENTION_SCHEDULE,
  RIGHTS_TYPES,
  USER_TABLES,
  WIPE_TABLES,
  deletionOrder,
  isOverdue,
  rightsDueAt,
} from "./privacy";

type Any = any;

async function admin(): Promise<Any> {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}
async function audit(
  db: Any,
  userId: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  await db.from("audit_events").insert({
    user_id: userId,
    actor_type: "user",
    action,
    resource_type: "data_rights",
    outcome: "succeeded",
    metadata,
  });
}
async function logRequest(
  db: Any,
  userId: string,
  type: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
  const now = new Date();
  const { data } = await db
    .from("data_rights_requests")
    .insert({
      user_id: userId,
      request_type: type,
      status,
      received_at: now.toISOString(),
      due_at: rightsDueAt(now).toISOString(),
      completed_at: status === "completed" ? now.toISOString() : null,
      ...extra,
    })
    .select("id")
    .single();
  return data?.id as string | undefined;
}

/** Access + portability: full machine-readable copy of every domain table (secrets excluded). */
export const exportMyData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ kind: z.enum(["access", "portability"]).default("access") }).parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    if (!(await (await import("./security.server")).rateLimit("data_export", context.userId)))
      throw new Error("Too many downloads. Try again in an hour.");
    const db = await admin();
    const u = context.userId;
    const out: Record<string, Any> = {
      format: "plexecute-export-v1",
      exported_at: new Date().toISOString(),
    };
    const prof = (await db.from("profiles").select("*").eq("id", u).maybeSingle()).data;
    // Credentials and their hashes never leave the server, even to the member (V3 §59/§79).
    const strip = (r: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(r).filter(([k]) => !/token|secret|hash|pkce|api_key|password/i.test(k)),
      );
    out["profile"] = prof ? strip(prof) : null;
    for (const t of EXPORT_TABLES)
      out[t] = ((await db.from(t).select("*").eq("user_id", u).limit(50000)).data ?? []).map(strip);
    out["retention_policy"] = RETENTION_SCHEDULE;
    await logRequest(db, u, data.kind, "completed", {
      search_scope: ["profiles", ...EXPORT_TABLES],
      response: "Self-service export delivered",
    });
    await audit(db, u, `data_export.${data.kind}`, { tables: EXPORT_TABLES.length + 1 });
    return JSON.stringify(out);
  });

/** Restriction: pauses AI coaching, automated calls, nudges and automatic plan changes until lifted. */
export const setProcessingRestriction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ restricted: z.boolean(), reason: z.string().max(1000).optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const u = context.userId;
    await db
      .from("profiles")
      .update({
        processing_restricted: data.restricted,
        processing_restricted_at: data.restricted ? new Date().toISOString() : null,
      })
      .eq("id", u);
    if (data.restricted) {
      await db
        .from("call_campaigns")
        .update({ state: "CANCELLED", stop_reason: "processing_restricted", next_attempt_at: null })
        .eq("user_id", u)
        .in("state", ["CALL_ELIGIBLE", "CALL_QUEUED", "RETRY_SCHEDULED"]);
    }
    await logRequest(db, u, "restriction", "completed", {
      details: data.reason ?? null,
      response: data.restricted ? "Processing restricted" : "Restriction lifted",
    });
    await audit(db, u, data.restricted ? "processing.restricted" : "processing.restriction_lifted");
    return { ok: true };
  });

/** Requests that need a person: rectification, objection, complaint (and any request made in plain words). */
export const submitRightsRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ type: z.enum(RIGHTS_TYPES), details: z.string().trim().min(3).max(4000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    if (!(await (await import("./security.server")).rateLimit("rights_request", context.userId)))
      throw new Error("Too many requests today.");
    const db = await admin();
    const id = await logRequest(db, context.userId, data.type, "received", {
      details: data.details,
    });
    const due = rightsDueAt(new Date());
    // Requests needing a person go to the support inbox (SUPPORT_EMAIL) as a durable job with retries; admins only ever see counts.
    const job = id
      ? await (
          await import("./jobs.server")
        ).runJob(db, "email.data_rights", `rights-email:${id}`, { request_id: id })
      : null;
    const emailed = job?.status === "succeeded";
    await audit(db, context.userId, "data_rights.request_received", {
      type: data.type,
      request_id: id,
      support_emailed: emailed,
    });
    return { ok: true, id, dueAt: due.toISOString() };
  });

export const withdrawRightsRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const db = await admin();
    await db
      .from("data_rights_requests")
      .update({ status: "withdrawn", completed_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .in("status", ["received", "in_progress", "paused"]);
    await audit(db, context.userId, "data_rights.request_withdrawn", { request_id: data.id });
    return { ok: true };
  });

export const getMyPrivacy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: p } = await context.supabase
      .from("profiles")
      .select("processing_restricted,processing_restricted_at")
      .eq("id", context.userId)
      .single();
    const { data: reqs } = await context.supabase
      .from("data_rights_requests")
      .select("id,request_type,status,received_at,due_at,completed_at,response")
      .order("received_at", { ascending: false })
      .limit(50);
    return {
      restricted: !!p?.processing_restricted,
      restrictedAt: p?.processing_restricted_at ?? null,
      requests: reqs ?? [],
      retention: RETENTION_SCHEDULE,
    };
  });

/** "Delete all my data": every domain table; account, billing and legal evidence stay. */
export async function wipeUserData(db: Any, userId: string) {
  const removed: Record<string, number> = {};
  for (const t of deletionOrder(WIPE_TABLES)) {
    const { count, error } = await db.from(t).delete({ count: "exact" }).eq("user_id", userId);
    if (error) throw new Error(`wipe failed at ${t}`);
    removed[t] = count ?? 0;
  }
  await db
    .from("profiles")
    .update({ onboarded: false, life_audit: {}, calendar_token: null, health_token: null })
    .eq("id", userId);
  return removed;
}

/** §79 account deletion lifecycle: revoke → stop → DELETION_PENDING → purge → auditable completion. */
export async function deleteAccountJob(
  db: Any,
  userId: string,
  cancelBilling: () => Promise<void>,
) {
  const { createHash } = await import("crypto");
  const subject = createHash("sha256").update(userId).digest("hex");
  const steps: { step: string; at: string; detail?: unknown }[] = [];
  const mark = (step: string, detail?: unknown) =>
    steps.push({ step, at: new Date().toISOString(), detail });
  const { data: job } = await db
    .from("deletion_jobs")
    .insert({ subject_ref: subject, status: "revoking" })
    .select("id")
    .single();
  const save = (patch: Record<string, unknown>) =>
    db
      .from("deletion_jobs")
      .update({ steps, ...patch })
      .eq("id", job.id);
  try {
    await db
      .from("profiles")
      .update({
        account_status: "deletion_pending",
        calls_stopped_at: new Date().toISOString(),
        reminders_enabled: false,
        calls_enabled: false,
        calendar_token: null,
        health_token: null,
      })
      .eq("id", userId);
    mark("account_marked_deletion_pending");
    await db
      .from("call_campaigns")
      .update({ state: "CANCELLED", stop_reason: "account_deleted", next_attempt_at: null })
      .eq("user_id", userId);
    await db.from("notifications").delete().eq("user_id", userId);
    mark("calls_and_notifications_stopped");
    for (const t of [
      "calendar_credentials",
      "wearable_credentials",
      "push_devices",
      "phone_numbers",
    ])
      await db.from(t).delete().eq("user_id", userId);
    await db.from("professional_shares").delete().eq("user_id", userId);
    mark("integrations_and_sharing_revoked");
    await cancelBilling();
    mark("subscription_cancelled");
    await save({ status: "purging" });
    const removed: Record<string, number> = {};
    for (const t of deletionOrder(USER_TABLES)) {
      const { count, error } = await db.from(t).delete({ count: "exact" }).eq("user_id", userId);
      if (error) throw new Error(`purge failed at ${t}`);
      removed[t] = count ?? 0;
    }
    await db.from("profiles").delete().eq("id", userId);
    mark("personal_data_purged", {
      tables: Object.keys(removed).length + 1,
      rows: Object.values(removed).reduce((a, b) => a + b, 0),
    });
    const { error } = await db.auth.admin.deleteUser(userId);
    if (error) throw new Error("sign-in account removal failed");
    mark("sessions_revoked_and_login_removed");
    await save({ status: "completed", completed_at: new Date().toISOString() });
    return { ok: true, jobId: job.id as string };
  } catch (e) {
    await save({ status: "failed", error: (e as Error).message });
    throw e;
  }
}

/** Admin: aggregates only, never PII or request text. */
export const getPrivacyOps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(roles ?? []).some((r) => r.role === "admin")) throw new Error("Forbidden");
    const db = await admin();
    const { data: reqs } = await db
      .from("data_rights_requests")
      .select("request_type,status,due_at")
      .limit(10000);
    const open = (reqs ?? []).filter((r: Any) =>
      ["received", "in_progress", "paused"].includes(r.status),
    );
    const byType: Record<string, number> = {};
    for (const r of open) byType[r.request_type] = (byType[r.request_type] ?? 0) + 1;
    const { data: jobs } = await db.from("deletion_jobs").select("status").limit(10000);
    const jobCounts: Record<string, number> = {};
    for (const j of jobs ?? []) jobCounts[j.status] = (jobCounts[j.status] ?? 0) + 1;
    const { data: run } = await db
      .from("retention_runs")
      .select("ran_at,removed")
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      open: open.length,
      overdue: open.filter((r: Any) => isOverdue(r)).length,
      openByType: byType,
      deletionJobs: jobCounts,
      lastRetention: run ?? null,
    };
  });

export const runRetentionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (!(roles ?? []).some((r) => r.role === "admin")) throw new Error("Forbidden");
    const db = await admin();
    const { data, error } = await db.rpc("apply_retention");
    if (error) throw new Error("Retention run failed");
    await db.from("audit_events").insert({
      user_id: context.userId,
      actor_type: "admin",
      action: "retention.run_manual",
      resource_type: "retention",
      outcome: "succeeded",
      metadata: data ?? {},
    });
    return data as Record<string, number>;
  });
