/**
 * Notification delivery rules (V3 §69/§70). Pure and deterministic.
 * Every notification row stores intent, plan/session reference, dedupe key, scheduled-at,
 * sent-at, provider result and interaction result. Delivery itself lives in notify.server.ts.
 */
import { inQuietHours, localDayKey, zonedInstant, addDaysKey, zonedParts } from "@/lib/tz";

export const CATEGORIES = [
  "UPCOMING",
  "DUE",
  "MISSED",
  "PLAN_CHANGED",
  "WEEKLY_REVIEW",
  "EXPERIMENT",
  "ACCOUNT",
  "BILLING",
  "SAFETY",
] as const;
export type Category = (typeof CATEGORIES)[number];
export type DeliveryChannel = "in_app" | "push" | "email";

export const CATEGORY_LABEL: Record<Category, { title: string; detail: string }> = {
  UPCOMING: { title: "Upcoming sessions", detail: "Your reminder before a session starts." },
  DUE: { title: "Due now", detail: "A check-in when a session is due and not started." },
  MISSED: { title: "Missed sessions", detail: "When a session passes without being started." },
  PLAN_CHANGED: { title: "Plan changes", detail: "When a plan you approved takes effect." },
  WEEKLY_REVIEW: { title: "Weekly summary", detail: "A short summary of your week." },
  EXPERIMENT: {
    title: "Experiments",
    detail: "When an experiment switches option or has a result.",
  },
  ACCOUNT: { title: "Account and security", detail: "Sign-in, security and data export notices." },
  BILLING: { title: "Billing", detail: "Receipts and subscription notices." },
  SAFETY: { title: "Safety", detail: "Safety notices. Always shown in the app." },
};

/** V3 §70: only these classes may be emailed. Weekly and plan-change summaries are opt-in. */
export const EMAIL_ALLOWED: Record<Category, boolean> = {
  UPCOMING: true,
  DUE: false,
  MISSED: false,
  PLAN_CHANGED: true,
  WEEKLY_REVIEW: true,
  EXPERIMENT: false,
  ACCOUNT: true,
  BILLING: true,
  SAFETY: false,
};
/** Categories that cannot be switched off in the app (account security, billing notices, safety). */
export const IN_APP_REQUIRED = new Set<Category>(["ACCOUNT", "BILLING", "SAFETY"]);
/** Categories delivered even in quiet hours (account security and safety are time-critical). */
export const QUIET_EXEMPT = new Set<Category>(["ACCOUNT", "SAFETY"]);

export type Pref = { in_app: boolean; push: boolean; email: boolean };
/** Defaults: in-app and push on; email off except account/billing (opt-in per V3 §70). */
export function defaultPref(c: Category): Pref {
  return { in_app: true, push: c !== "WEEKLY_REVIEW", email: c === "ACCOUNT" || c === "BILLING" };
}
export function prefsMap(
  rows: Array<{ category: string } & Pref> | null | undefined,
): Record<Category, Pref> {
  const out = {} as Record<Category, Pref>;
  for (const c of CATEGORIES) out[c] = defaultPref(c);
  for (const r of rows ?? [])
    if ((CATEGORIES as readonly string[]).includes(r.category))
      out[r.category as Category] = { in_app: r.in_app, push: r.push, email: r.email };
  return out;
}

/** Which channels a notification should go to, given preferences and what is available. */
export function resolveChannels(
  c: Category,
  pref: Pref,
  avail: { push: boolean; email: boolean; legacyEmail?: boolean },
): DeliveryChannel[] {
  const ch: DeliveryChannel[] = [];
  if (pref.in_app || IN_APP_REQUIRED.has(c)) ch.push("in_app");
  if (pref.push && avail.push) ch.push("push");
  if ((pref.email || (c === "UPCOMING" && avail.legacyEmail)) && EMAIL_ALLOWED[c] && avail.email)
    ch.push("email");
  return ch;
}

export function dedupeKey(parts: Array<string | number | null | undefined>): string {
  return parts.map((p) => String(p ?? "-")).join(":");
}

/** Retry schedule after a failed attempt: 1, 5, 15, 60 minutes, then give up. */
export const RETRY_MIN = [1, 5, 15, 60];
export const MAX_ATTEMPTS = RETRY_MIN.length + 1;
export function nextRetry(attempts: number, now: Date, retryAfterSec?: number | null): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const mins = RETRY_MIN[Math.max(0, attempts - 1)] ?? 60;
  const ms = Math.max(mins * 60000, (retryAfterSec ?? 0) * 1000);
  return new Date(now.getTime() + ms);
}
/** Permanent failures are not retried (bad token, unknown recipient, provider says invalid). */
export function isPermanent(status: number | null, code?: string | null): boolean {
  if (code === "DeviceNotRegistered" || code === "InvalidCredentials" || code === "not_configured")
    return true;
  if (status == null) return false;
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * Quiet hours: in-app is stored silently straight away; push and email wait until quiet hours end
 * (local time, DST-correct). Returns null when it may go now.
 */
export function quietDeferral(
  now: Date,
  c: Category,
  ch: DeliveryChannel,
  q: { start: string; end: string; tz: string },
): Date | null {
  if (ch === "in_app" || QUIET_EXEMPT.has(c)) return null;
  if (!inQuietHours(now, q.start, q.end, q.tz)) return null;
  const [eh, em] = q.end.split(":").map(Number);
  const endMin = eh! * 60 + (em ?? 0);
  const today = localDayKey(now, q.tz);
  const nowMin = zonedParts(now, q.tz).minutes;
  const day = nowMin < endMin ? today : addDaysKey(today, 1);
  return zonedInstant(day, endMin, q.tz);
}

/** V3 §70: no health/body details in subject lines. Subjects come only from this fixed list. */
export const EMAIL_SUBJECT: Record<Category, string> = {
  UPCOMING: "Plexecute: a session is coming up",
  DUE: "Plexecute: a session is due",
  MISSED: "Plexecute: a session was missed",
  PLAN_CHANGED: "Plexecute: your plan has changed",
  WEEKLY_REVIEW: "Plexecute: your weekly summary",
  EXPERIMENT: "Plexecute: experiment update",
  ACCOUNT: "Plexecute: account notice",
  BILLING: "Plexecute: billing notice",
  SAFETY: "Plexecute: notice",
};

export const STATUS_LABEL: Record<string, string> = {
  queued: "Waiting to send",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  retrying: "Will retry",
  skipped: "Not sent",
  suppressed: "Blocked by the email service",
};

/** Own choice: the weekly summary goes out Sunday 18:00 local time. */
export const WEEKLY_SUMMARY = { isoDow: 7, minutes: 18 * 60 };
export function weeklySummaryDue(now: Date, tz: string): boolean {
  const p = zonedParts(now, tz);
  return p.isoDow === WEEKLY_SUMMARY.isoDow && p.minutes >= WEEKLY_SUMMARY.minutes;
}
