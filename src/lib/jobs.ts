// Pure rules for durable background work (V3 step 63, §83): retries, ceilings, dead-letter, replay, health.

export type JobStatus = "queued" | "running" | "retrying" | "succeeded" | "dead";

/** Each kind of background work, its retry ceiling and whether an admin may replay it once dead. */
export const JOB_KINDS = {
  "tick.reminders": {
    label: "Reminders, nudges, calls and delivery run",
    maxAttempts: 1,
    replayable: false,
  },
  "tick.prompts": { label: "Coach prompts sent on time", maxAttempts: 1, replayable: false },
  "tick.calls": { label: "Requested and planned calls run", maxAttempts: 1, replayable: false },
  "tick.calendar": { label: "Calendar sync run", maxAttempts: 1, replayable: false },
  "tick.wearables": { label: "Wearable sync run", maxAttempts: 1, replayable: false },
  "tick.standing_orders": {
    label: "Ongoing plans and meals run",
    maxAttempts: 1,
    replayable: false,
  },
  "tick.missions": { label: "Goal mission check", maxAttempts: 1, replayable: false },
  "stripe.event": { label: "Payment event", maxAttempts: 8, replayable: true },
  "email.data_rights": {
    label: "Privacy request email to support",
    maxAttempts: 6,
    replayable: true,
  },
  "email.support": { label: "Help request email to support", maxAttempts: 6, replayable: true },
} as const;
export type JobKind = keyof typeof JOB_KINDS;

export const LEASE_MS = 5 * 60_000;
const BASE_MS = 60_000;
const CAP_MS = 6 * 3600_000;

/** Bounded exponential backoff: 1, 2, 4, 8 ... minutes, never more than 6 hours. */
export function backoffMs(attempt: number): number {
  return Math.min(CAP_MS, BASE_MS * 2 ** Math.max(0, attempt - 1));
}

/** What happens after a failed attempt: retry later, or park in the dead-letter state. */
export function afterFailure(
  attempts: number,
  maxAttempts: number,
  now: Date,
  permanent = false,
): { status: "retrying" | "dead"; nextAttemptAt: Date | null } {
  if (permanent || attempts >= maxAttempts) return { status: "dead", nextAttemptAt: null };
  return { status: "retrying", nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) };
}

/** Errors are stored without personal details or secrets (§85 forbidden log fields). */
export function scrubError(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
  return (raw ?? "unknown error")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{7,}\d/g, "[number]")
    .replace(/\b(sk|rk|pk|whsec|re)_[A-Za-z0-9_]+/g, "[secret]")
    .replace(/Bearer\s+\S+/gi, "Bearer [secret]")
    .replace(
      /\b(token|access_token|refresh_token|api[_-]?key|key|password|secret|code|auth)=([^\s&"']+)/gi,
      "$1=[secret]",
    )
    .slice(0, 300);
}

/** A permanent failure will never succeed by retrying (bad input, missing record, refused). */
export class PermanentJobError extends Error {}

export function canReplay(kind: string, status: string): boolean {
  const k = JOB_KINDS[kind as JobKind];
  return !!k?.replayable && status === "dead";
}

/** A tick's idempotency key: one run per job per time slot, so overlapping schedulers never double-run. */
export function tickKey(name: string, now: Date, slotMs: number): string {
  return `tick:${name}:${Math.floor(now.getTime() / slotMs)}`;
}

export type JobRow = {
  kind: string;
  status: string;
  next_attempt_at: string;
  created_at: string;
  finished_at: string | null;
  duration_ms: number | null;
};

/** Queue health for the Admin page: counts only, plus the oldest overdue wait (lag). */
export function summariseJobs(rows: JobRow[], now: Date) {
  const byKind: Record<
    string,
    Record<JobStatus, number> & { lastSuccess: string | null; avgMs: number | null }
  > = {};
  let oldestDueMs = 0;
  for (const r of rows) {
    const k = (byKind[r.kind] ??= {
      queued: 0,
      running: 0,
      retrying: 0,
      succeeded: 0,
      dead: 0,
      lastSuccess: null,
      avgMs: null,
    });
    k[r.status as JobStatus] = (k[r.status as JobStatus] ?? 0) + 1;
    if (
      r.status === "succeeded" &&
      r.finished_at &&
      (!k.lastSuccess || r.finished_at > k.lastSuccess)
    )
      k.lastSuccess = r.finished_at;
    if ((r.status === "queued" || r.status === "retrying") && new Date(r.next_attempt_at) <= now) {
      oldestDueMs = Math.max(oldestDueMs, now.getTime() - new Date(r.next_attempt_at).getTime());
    }
  }
  for (const [kind, k] of Object.entries(byKind)) {
    const d = rows
      .filter((r) => r.kind === kind && r.status === "succeeded" && r.duration_ms != null)
      .map((r) => r.duration_ms!);
    k.avgMs = d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : null;
  }
  const dead = rows.filter((r) => r.status === "dead").length;
  const waiting = rows.filter((r) => r.status === "queued" || r.status === "retrying").length;
  return {
    byKind,
    dead,
    waiting,
    oldestDueMinutes: Math.round(oldestDueMs / 60_000),
    healthy: dead === 0 && oldestDueMs < 30 * 60_000,
  };
}
