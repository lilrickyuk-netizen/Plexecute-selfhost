import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const securityHeaders = createMiddleware().server(async ({ next }) => {
  const res = await next();
  const { SECURITY_HEADERS } = await import("./lib/security");
  const r = (res as { response?: Response }).response ?? (res instanceof Response ? res : null);
  if (r)
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      try {
        if (!r.headers.has(k)) r.headers.set(k, v);
      } catch {
        /* immutable headers */
      }
    }
  return res;
});

// V3 §85: request id + trace id per request, one structured log line, errors captured; outside-service health probe.
const observability = createMiddleware().server(async ({ next, request }) => {
  const o = await import("./lib/observability.server");
  const { safeRoute } = await import("./lib/observability");
  o.installProviderProbe();
  const requestId = request.headers.get("x-request-id")?.slice(0, 64) || crypto.randomUUID();
  const ctx = {
    requestId,
    traceId: crypto.randomUUID().replace(/-/g, ""),
    route: safeRoute(request.url),
  };
  return o.requestContext.run(ctx, async () => {
    const t0 = Date.now();
    try {
      const res = await next();
      const r = (res as { response?: Response }).response ?? (res instanceof Response ? res : null);
      try {
        r?.headers.set("X-Request-Id", requestId);
      } catch {
        /* immutable */
      }
      const status = r?.status ?? 200;
      if (status >= 500)
        void o.captureError(`HTTP ${status} on ${ctx.route}`, { source: "server" });
      o.log({
        level: status >= 500 ? "error" : "info",
        action: "request",
        method: request.method,
        latency_ms: Date.now() - t0,
        result_code: status,
      });
      return res;
    } catch (error) {
      if (
        !(error != null && typeof error === "object" && "statusCode" in error) &&
        !(error instanceof Response)
      )
        await o.captureError(error, { source: "server" });
      o.log({
        level: "error",
        action: "request",
        method: request.method,
        latency_ms: Date.now() - t0,
        result_code: 500,
      });
      throw error;
    }
  });
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [securityHeaders, observability, errorMiddleware, csrfMiddleware],
}));
