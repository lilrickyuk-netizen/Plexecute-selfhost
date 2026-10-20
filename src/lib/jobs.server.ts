// Durable background work ledger (V3 step 63). Every unit of work has an idempotency key, bounded retries,
// a dead-letter state, an append-only event trail and admin replay. Payloads hold ids only, never personal details.
import {
  JOB_KINDS,
  LEASE_MS,
  PermanentJobError,
  afterFailure,
  canReplay,
  scrubError,
  tickKey,
  type JobKind,
} from "./jobs";

type Db = any;
type Json = Record<string, unknown>;
type Handler = (db: Db, payload: Json, inline?: unknown) => Promise<Json>;

export type RunOutcome = {
  status: "succeeded" | "retrying" | "dead" | "duplicate" | "busy";
  id: string;
  result?: Json | null;
  error?: string;
};

async function event(
  db: Db,
  jobId: string,
  ev: string,
  attempt: number,
  detail?: string | null,
  actor = "system",
) {
  await db
    .from("background_job_events")
    .insert({ job_id: jobId, event: ev, attempt, detail: detail ?? null, actor });
}

/** Registry of work that can be re-run from its stored payload (retries and replay). */
const HANDLERS: Partial<Record<JobKind, Handler>> = {
  "stripe.event": async (db, payload, inline) => {
    // First attempt uses the verified webhook body; retries and replays re-fetch the event from Stripe by id.
    const ev =
      (inline as StripeEvent | undefined) ??
      ((await (
        await import("./integrations.server")
      ).stripe(
        `events/${encodeURIComponent(String(payload["event_id"]))}`,
        "GET",
      )) as unknown as StripeEvent);
    await (await import("./stripe-events.server")).processStripeEvent(db, ev);
    return { type: ev.type };
  },
  "email.data_rights": async (db, payload) => {
    const m = await import("./integrations.server");
    const support = m.env("SUPPORT_EMAIL");
    if (!support || !m.emailConfigured()) throw new Error("Support email is not switched on yet");
    const { data: r } = await db
      .from("data_rights_requests")
      .select("id,user_id,request_type,status,details,due_at,created_at")
      .eq("id", payload["request_id"])
      .maybeSingle();
    if (!r) throw new PermanentJobError("Request no longer exists");
    if (r.status === "withdrawn") return { skipped: "withdrawn" };
    const email = (await db.auth.admin.getUserById(r.user_id)).data.user?.email ?? "unknown";
    const due = String(r.due_at ?? "").slice(0, 10);
    await m.sendEmail(
      support,
      `Plexecute privacy request: ${r.request_type} (reply by ${due})`,
      `Request ID: ${r.id}\nType: ${r.request_type}\nFrom account: ${email} (user ${r.user_id})\nReceived: ${r.created_at}\nReply by: ${r.due_at}\nIdentity check: signed-in session\n\nWhat they wrote:\n${r.details ?? ""}\n`,
    );
    return { emailed: true };
  },
  "email.support": async (db, payload) => {
    const m = await import("./integrations.server");
    const support = m.env("SUPPORT_EMAIL");
    if (!support || !m.emailConfigured()) throw new Error("Support email is not switched on yet");
    const { data: r } = await db
      .from("support_requests")
      .select("*")
      .eq("id", payload["request_id"])
      .maybeSingle();
    if (!r) throw new PermanentJobError("Request no longer exists");
    const email = (await db.auth.admin.getUserById(r.user_id)).data.user?.email ?? "unknown";
    const { supportEmailBody } = await import("./support");
    await m.sendEmail(
      support,
      `${r.priority === "priority" ? "[PRIORITY] " : ""}Plexecute help: ${r.category} (${r.tier}, target ${r.target_label})`,
      supportEmailBody(r, email),
    );
    return { emailed: true };
  },
};

export type StripeEvent = { id: string; type: string; data: { object: Record<string, unknown> } };

/** Creates the job if new (idempotent on key); returns the stored row. */
async function ensureJob(db: Db, kind: JobKind, key: string, payload: Json) {
  const { error } = await db
    .from("background_jobs")
    .insert({ kind, idempotency_key: key, payload, max_attempts: JOB_KINDS[kind].maxAttempts });
  if (error && error.code !== "23505") throw error;
  const { data } = await db.from("background_jobs").select("*").eq("idempotency_key", key).single();
  if (!error) await event(db, data.id, "created", 0);
  return data;
}

/** Claims a job with a lease so concurrent runners never process it twice. Expired leases can be reclaimed. */
async function claim(db: Db, job: { id: string; attempts: number }, now: Date) {
  const { data } = await db
    .from("background_jobs")
    .update({
      status: "running",
      attempts: job.attempts + 1,
      lease_until: new Date(now.getTime() + LEASE_MS).toISOString(),
    })
    .eq("id", job.id)
    .eq("attempts", job.attempts)
    .or(`status.in.(queued,retrying),and(status.eq.running,lease_until.lt.${now.toISOString()})`)
    .select("id,attempts,max_attempts");
  return data?.[0] ?? null;
}

async function execute(
  db: Db,
  job: { id: string; kind: string; attempts: number; payload: Json },
  fn: () => Promise<Json>,
  now: Date,
): Promise<RunOutcome> {
  const c = await claim(db, job, now);
  if (!c) return { status: "busy", id: job.id };
  await event(db, job.id, "started", c.attempts);
  const t0 = Date.now();
  try {
    const result = (await fn()) ?? {};
    await db
      .from("background_jobs")
      .update({
        status: "succeeded",
        result,
        last_error: null,
        lease_until: null,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - t0,
      })
      .eq("id", job.id);
    await event(db, job.id, "succeeded", c.attempts);
    return { status: "succeeded", id: job.id, result };
  } catch (e) {
    const err = scrubError(e);
    const f = afterFailure(c.attempts, c.max_attempts, new Date(), e instanceof PermanentJobError);
    await db
      .from("background_jobs")
      .update({
        status: f.status,
        last_error: err,
        lease_until: null,
        next_attempt_at: f.nextAttemptAt?.toISOString() ?? new Date().toISOString(),
        duration_ms: Date.now() - t0,
        finished_at: f.status === "dead" ? new Date().toISOString() : null,
      })
      .eq("id", job.id);
    await event(db, job.id, f.status === "dead" ? "dead_lettered" : "failed", c.attempts, err);
    // Operational alert for dead-lettered work (§83): structured log line, no personal details.
    if (f.status === "dead")
      void (await import("./observability.server")).captureError(
        `${job.kind} failed after all retries: ${err}`,
        { source: "job" },
      );
    if (f.status === "dead")
      console.error(
        JSON.stringify({
          level: "error",
          service: "jobs",
          action: "dead_letter",
          kind: job.kind,
          job_id: job.id,
          attempts: c.attempts,
          error: err,
        }),
      );
    return { status: f.status, id: job.id, error: err };
  }
}

/** Runs a registered unit of work exactly once per idempotency key, with retries on failure. */
export async function runJob(
  db: Db,
  kind: JobKind,
  key: string,
  payload: Json,
  inline?: unknown,
  now = new Date(),
): Promise<RunOutcome> {
  const h = HANDLERS[kind];
  if (!h) throw new Error(`No handler for ${kind}`);
  const job = await ensureJob(db, kind, key, payload);
  if (job.status === "succeeded") return { status: "duplicate", id: job.id, result: job.result };
  if (job.status === "dead") return { status: "dead", id: job.id, error: job.last_error };
  return execute(db, job, () => h(db, job.payload, inline), now);
}

/** A scheduled run, single-flight per time slot. Failures are recorded; the next slot is the retry. */
export async function runTick(
  db: Db,
  name:
    "reminders" | "prompts" | "calls" | "calendar" | "wearables" | "standing_orders" | "missions",
  slotMs: number,
  fn: () => Promise<Json>,
  now = new Date(),
): Promise<RunOutcome> {
  const kind = `tick.${name}` as JobKind;
  const job = await ensureJob(db, kind, tickKey(name, now, slotMs), {
    slot_start: new Date(Math.floor(now.getTime() / slotMs) * slotMs).toISOString(),
  });
  if (job.status === "succeeded") return { status: "duplicate", id: job.id, result: job.result };
  return execute(db, job, fn, now);
}

/** Retries every due job whose kind can run from its stored payload. Bounded per call. */
export async function drainJobs(db: Db, now = new Date(), limit = 25) {
  const kinds = Object.keys(HANDLERS);
  const { data } = await db
    .from("background_jobs")
    .select("id,kind,attempts,payload,status")
    .in("kind", kinds)
    .in("status", ["queued", "retrying"])
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at")
    .limit(limit);
  const out: Record<string, number> = {};
  for (const j of data ?? []) {
    const r = await execute(db, j, () => HANDLERS[j.kind as JobKind]!(db, j.payload), now);
    out[r.status] = (out[r.status] ?? 0) + 1;
  }
  return out;
}

/** Admin replay of a dead-lettered job: resets its attempts, records who replayed it, runs it now. */
export async function replayJob(db: Db, id: string, actorId: string): Promise<RunOutcome> {
  const { data: j } = await db
    .from("background_jobs")
    .select("id,kind,status,attempts,payload")
    .eq("id", id)
    .maybeSingle();
  if (!j) throw new Error("Job not found");
  if (!canReplay(j.kind, j.status)) throw new Error("This job can't be replayed");
  const { data: reset } = await db
    .from("background_jobs")
    .update({
      status: "queued",
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      finished_at: null,
    })
    .eq("id", id)
    .eq("status", "dead")
    .select("id");
  if (!reset?.length) throw new Error("Job already replayed");
  await event(db, id, "replayed", j.attempts, null, `admin:${actorId}`);
  await db.from("audit_events").insert({
    user_id: actorId,
    actor_type: "admin",
    action: "job.replay",
    resource_type: "background_job",
    resource_id: id,
    outcome: "requested",
    metadata: { kind: j.kind },
  });
  return execute(
    db,
    { ...j, attempts: 0 },
    () => HANDLERS[j.kind as JobKind]!(db, j.payload),
    new Date(),
  );
}
