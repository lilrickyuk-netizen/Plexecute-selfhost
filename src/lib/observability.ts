// V3 step 64 / §85 observability rules (pure, testable): structured logs, privacy filtering, error grouping,
// Sentry/PostHog payload shapes and provider health maths.
import { scrubError } from "./jobs";

/** Outside services we measure, by host. */
export const PROVIDER_BY_HOST: Record<string, string> = {
  "api.stripe.com": "Stripe payments",
  "api.resend.com": "Resend email",
  "api.twilio.com": "Twilio calls",
  "verify.twilio.com": "Twilio verify",
  "ai.gateway.lovable.dev": "AI coach",
  "connector-gateway.lovable.dev": "Connected apps",
  "api.openai.com": "AI coach",
  "generativelanguage.googleapis.com": "AI coach",
  "maps.googleapis.com": "Connected apps",
  "routes.googleapis.com": "Connected apps",
  "places.googleapis.com": "Connected apps",
  "oauth2.googleapis.com": "Google calendar",
  "www.googleapis.com": "Google calendar",
  "graph.microsoft.com": "Microsoft calendar",
  "login.microsoftonline.com": "Microsoft calendar",
  "api.prod.whoop.com": "WHOOP",
  "api.ouraring.com": "Oura",
  "api.fitbit.com": "Fitbit",
  "www.strava.com": "Strava",
  "apis.garmin.com": "Garmin",
  "connectapi.garmin.com": "Garmin",
  "diauth.garmin.com": "Garmin",
  "exp.host": "Push notifications",
  "oauth.fatsecret.com": "FatSecret food",
  "platform.fatsecret.com": "FatSecret food",
  "api.nal.usda.gov": "USDA food",
  "api.firecrawl.dev": "Research search",
};

export function providerFor(url: string): string | null {
  try {
    return PROVIDER_BY_HOST[new URL(url).hostname.toLowerCase()] ?? null;
  } catch {
    return null;
  }
}

/** §85 forbidden log fields: never written to logs, error records or analytics. */
export const FORBIDDEN_KEYS = [
  "password",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "cookie",
  "phone",
  "phone_number",
  "email",
  "transcript",
  "food",
  "weight",
  "weight_kg",
  "sleep",
  "message",
  "content",
  "details",
  "note",
  "payload",
  "body",
  "secret",
  "api_key",
];

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (FORBIDDEN_KEYS.some((f) => k.toLowerCase().includes(f))) continue;
    out[k] =
      typeof v === "string"
        ? scrubError(v)
        : typeof v === "number" || typeof v === "boolean" || v == null
          ? v
          : "[object]";
  }
  return out;
}

export type LogFields = {
  level: "info" | "warn" | "error";
  service: string;
  action: string;
  request_id?: string;
  trace_id?: string;
  user_surrogate_id?: string;
  route?: string;
  latency_ms?: number;
  result_code?: number | string;
  provider?: string;
} & Record<string, unknown>;

/** One JSON log line with the §85 field set; anything forbidden is dropped. */
export function logLine(f: LogFields, env = "production", now = new Date()): string {
  return JSON.stringify({ timestamp: now.toISOString(), environment: env, ...redact(f) });
}

/** Groups the same error together: numbers, ids and quoted values are normalised away. */
export function fingerprint(message: string, route?: string | null): string {
  const norm = `${route ?? ""}|${message}`
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/(["'`]).*?\1/g, "<s>")
    .slice(0, 200);
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/** Only the path is kept: query strings can carry tokens or personal data. */
export function safeRoute(urlOrPath: string): string {
  try {
    return new URL(urlOrPath, "http://x").pathname
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id")
      .slice(0, 120);
  } catch {
    return "unknown";
  }
}

export function parseSentryDsn(dsn: string | undefined) {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    if (!u.username || !projectId || u.protocol !== "https:") return null;
    return {
      host: u.hostname,
      publicKey: u.username,
      projectId,
      envelopeUrl: `https://${u.hostname}/api/${projectId}/envelope/`,
    };
  } catch {
    return null;
  }
}

/** Sentry envelope for one error event (no user details, surrogate id only). */
export function sentryEnvelope(
  dsn: NonNullable<ReturnType<typeof parseSentryDsn>>,
  e: {
    id: string;
    message: string;
    route: string | null;
    source: string;
    release?: string | undefined;
    environment?: string | undefined;
    userRef?: string | null;
    requestId?: string | null;
    at: Date;
  },
) {
  const event = {
    event_id: e.id.replace(/-/g, ""),
    timestamp: e.at.getTime() / 1000,
    platform: "javascript",
    level: "error",
    release: e.release,
    environment: e.environment,
    transaction: e.route ?? undefined,
    tags: { source: e.source, request_id: e.requestId ?? undefined },
    user: e.userRef ? { id: e.userRef } : undefined,
    exception: { values: [{ type: "Error", value: e.message }] },
  };
  return `${JSON.stringify({ event_id: event.event_id, dsn: `https://${dsn.publicKey}@${dsn.host}/${dsn.projectId}` })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}`;
}

/** Privacy-filtered product analytics: fixed event names, small safe properties only. */
export const PRODUCT_EVENTS = {
  plan_approved: ["mode"],
  workout_finished: [],
  subscription_changed: ["tier", "interval"],
  session_action: ["action"],
  client_error: [],
} as const satisfies Record<string, readonly string[]>;
export type ProductEvent = keyof typeof PRODUCT_EVENTS;

export function productProps(
  event: ProductEvent,
  props: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const k of PRODUCT_EVENTS[event] as readonly string[]) {
    const v = props[k];
    if (typeof v === "string" && v.length <= 40) out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

export function p95(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]!;
}

/** Provider health: success rate, p95 latency, last failure. Degraded under 95% success, down under 50%. */
export function summariseProviders(
  rows: { provider: string; ok: boolean; latency_ms: number; created_at: string }[],
) {
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.provider, [...(by.get(r.provider) ?? []), r]);
  return [...by.entries()]
    .map(([provider, rs]) => {
      const ok = rs.filter((r) => r.ok).length;
      const rate = ok / rs.length;
      const fails = rs
        .filter((r) => !r.ok)
        .map((r) => r.created_at)
        .sort();
      return {
        provider,
        calls: rs.length,
        successRate: Math.round(rate * 1000) / 10,
        p95Ms: p95(rs.map((r) => r.latency_ms)),
        lastFailureAt: fails.at(-1) ?? null,
        state: rate < 0.5 ? "down" : rate < 0.95 ? "degraded" : "ok",
      };
    })
    .sort((a, b) => a.provider.localeCompare(b.provider));
}
