// Server-side observability (§85): request context, structured logs, error capture (stored + Sentry when SENTRY_DSN is set),
// privacy-filtered product analytics (PostHog when POSTHOG_KEY is set) and outbound provider health.
import { AsyncLocalStorage } from "node:async_hooks";
import {
  fingerprint,
  logLine,
  parseSentryDsn,
  productProps,
  providerFor,
  safeRoute,
  sentryEnvelope,
  type LogFields,
  type ProductEvent,
} from "./observability";
import { scrubError } from "./jobs";
import { hashSubject } from "./security.server";

type Ctx = { requestId: string; traceId: string; route: string; userRef?: string };
export const requestContext = new AsyncLocalStorage<Ctx>();

const envName = () => process.env["APP_ENV"] ?? "production";
const release = () => process.env["APP_RELEASE"] ?? undefined;

export function log(f: Omit<LogFields, "service"> & { service?: string }) {
  const c = requestContext.getStore();
  const line = logLine(
    {
      service: "web",
      request_id: c?.requestId,
      trace_id: c?.traceId,
      route: c?.route,
      user_surrogate_id: c?.userRef,
      ...f,
    } as LogFields,
    envName(),
  );
  if (f["level"] === "error") console.error(line);
  else if (f["level"] === "warn") console.warn(line);
  else console.log(line);
}

let original: typeof fetch | null = null;
/** Wraps fetch once so every call to a known outside service records success and latency. Never records URLs or bodies. */
export function installProviderProbe() {
  if (original) return;
  original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const provider = providerFor(url);
    if (!provider) return original!(input, init);
    const t0 = Date.now();
    try {
      const res = await original!(input, init);
      void recordProvider(provider, res.ok || res.status < 500, res.status, Date.now() - t0);
      return res;
    } catch (e) {
      void recordProvider(provider, false, null, Date.now() - t0);
      throw e;
    }
  }) as typeof fetch;
}

async function recordProvider(
  provider: string,
  ok: boolean,
  status: number | null,
  latency: number,
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("provider_calls")
      .insert({ provider, ok, status, latency_ms: latency });
    if (!ok)
      log({
        level: "warn",
        action: "provider_call_failed",
        provider,
        result_code: status ?? "network",
        latency_ms: latency,
      });
  } catch {
    /* health recording must never break the call */
  }
}

/** Stores a privacy-scrubbed error and forwards it to Sentry when configured. */
export async function captureError(
  err: unknown,
  o: {
    source: "server" | "client" | "job";
    route?: string | null;
    userId?: string | null;
    requestId?: string | null;
  },
) {
  try {
    const c = requestContext.getStore();
    const message = scrubError(err);
    const route = o.route ? safeRoute(o.route) : (c?.route ?? null);
    const userRef = o.userId ? await hashSubject(o.userId) : (c?.userRef ?? null);
    const requestId = o.requestId ?? c?.requestId ?? null;
    const id = crypto.randomUUID();
    const dsn = parseSentryDsn(process.env["SENTRY_DSN"]);
    let forwarded = false;
    if (dsn) {
      const res = await fetch(dsn.envelopeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-sentry-envelope",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=plexecute/1.0`,
        },
        body: sentryEnvelope(dsn, {
          id,
          message,
          route,
          source: o.source,
          release: release(),
          environment: envName(),
          userRef,
          requestId,
          at: new Date(),
        }),
      }).catch(() => null);
      forwarded = !!res?.ok;
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("error_events").insert({
      id,
      source: o.source,
      fingerprint: fingerprint(message, route),
      route,
      message,
      request_id: requestId,
      user_ref: userRef,
      release: release() ?? null,
      forwarded,
    });
    log({
      level: "error",
      action: "error_captured",
      source: o.source,
      error: message,
      fingerprint: fingerprint(message, route),
    });
  } catch (e) {
    console.error("error capture failed", scrubError(e));
  }
}

/** Privacy-filtered product event; only sent when PostHog is configured. Identity is a one-way surrogate. */
export async function track(
  event: ProductEvent,
  userId: string,
  props: Record<string, unknown> = {},
) {
  const key = process.env["POSTHOG_KEY"];
  if (!key) return false;
  try {
    const host = process.env["POSTHOG_HOST"] ?? "https://eu.i.posthog.com";
    const res = await fetch(`${host.replace(/\/$/, "")}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: await hashSubject(userId),
        properties: {
          ...productProps(event, props),
          $process_person_profile: false,
          environment: envName(),
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
