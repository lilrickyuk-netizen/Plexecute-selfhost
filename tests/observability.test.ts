import { describe, expect, it } from "vitest";
import {
  fingerprint,
  logLine,
  parseSentryDsn,
  productProps,
  providerFor,
  redact,
  safeRoute,
  sentryEnvelope,
  summariseProviders,
} from "../src/lib/observability";

describe("observability", () => {
  it("drops forbidden log fields and scrubs strings", () => {
    const r = redact({
      email: "a@b.com",
      phone_number: "+447700900123",
      weight_kg: 80,
      access_token: "x",
      latency_ms: 12,
      error: "user a@b.com failed",
    });
    expect(Object.keys(r).sort()).toEqual(["error", "latency_ms"]);
    expect(r["error"]).not.toContain("a@b.com");
    const line = JSON.parse(
      logLine({
        level: "info",
        service: "web",
        action: "request",
        request_id: "r1",
        message: "secret text",
      }),
    );
    expect(line.request_id).toBe("r1");
    expect(line.message).toBeUndefined();
    expect(line.timestamp).toBeTruthy();
  });
  it("groups the same error regardless of ids and numbers", () => {
    expect(fingerprint("Block 123 not found", "/app")).toBe(
      fingerprint("Block 987 not found", "/app"),
    );
    expect(fingerprint("Block 1 not found", "/app")).not.toBe(fingerprint("Other", "/app"));
  });
  it("keeps paths only", () => {
    expect(safeRoute("https://x.app/app/today?token=abc")).toBe("/app/today");
    expect(safeRoute("/p/0b0e8c2a-1111-2222-3333-444455556666/x")).toBe("/p/:id/x");
  });
  it("parses Sentry DSNs and builds envelopes", () => {
    const d = parseSentryDsn("https://pub123@o1.ingest.de.sentry.io/456")!;
    expect(d.envelopeUrl).toBe("https://o1.ingest.de.sentry.io/api/456/envelope/");
    expect(parseSentryDsn("nonsense")).toBeNull();
    const env = sentryEnvelope(d, {
      id: "0b0e8c2a-1111-2222-3333-444455556666",
      message: "boom",
      route: "/app",
      source: "server",
      at: new Date(),
    }).split("\n");
    expect(env).toHaveLength(3);
    expect(JSON.parse(env[2]!).exception.values[0].value).toBe("boom");
  });
  it("filters product analytics to allowed properties", () => {
    expect(productProps("plan_approved", { mode: "trial", email: "a@b.com" })).toEqual({
      mode: "trial",
    });
    expect(productProps("workout_finished", { weight: 80 })).toEqual({});
  });
  it("maps hosts to providers and summarises health", () => {
    expect(providerFor("https://api.stripe.com/v1/x")).toBe("Stripe payments");
    expect(providerFor("https://evil.com")).toBeNull();
    const s = summariseProviders([
      { provider: "A", ok: true, latency_ms: 100, created_at: "1" },
      { provider: "A", ok: false, latency_ms: 900, created_at: "2" },
      { provider: "B", ok: true, latency_ms: 50, created_at: "1" },
    ]);
    expect(s[0]).toMatchObject({
      provider: "A",
      calls: 2,
      successRate: 50,
      state: "degraded",
      p95Ms: 900,
      lastFailureAt: "2",
    });
    expect(s[1]!.state).toBe("ok");
  });
});
