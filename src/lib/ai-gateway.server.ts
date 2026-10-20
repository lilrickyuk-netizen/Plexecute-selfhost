/**
 * Direct AI provider routing (replaces the Lovable AI gateway).
 *
 * Callers keep using gateway-style URLs ("https://ai.gateway.lovable.dev/v1/<path>") and
 * provider-prefixed model ids ("openai/gpt-6-luna", "google/gemini-3.8-flash") so pricing,
 * metering and tests are unchanged. `aiFetch` rewrites each request to the real provider:
 *
 *   openai/*  -> https://api.openai.com/v1/<path>                      (OPENAI_API_KEY)
 *   google/*  -> Gemini OpenAI-compatible chat completions endpoint     (GEMINI_API_KEY)
 *
 * Server-only. Keys never reach the browser.
 */

const OPENAI_BASE = "https://api.openai.com/v1";
const GEMINI_CHAT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

/** Headers only the Lovable gateway understood; stripped before calling a provider. */
const GATEWAY_ONLY_HEADERS = ["lovable-api-key", "x-lovable-aig-sdk", "authorization"];

export function openaiKey(): string | undefined {
  return process.env["OPENAI_API_KEY"] || undefined;
}

export function geminiKey(): string | undefined {
  return process.env["GEMINI_API_KEY"] || process.env["GEMINI_LIVE_API_KEY"] || undefined;
}

/** True when the primary text AI provider is configured (used for "AI switched on" checks). */
export function aiConfigured(): boolean {
  return !!openaiKey();
}

/** "openai/gpt-6-luna" -> { provider: "openai", model: "gpt-6-luna" } */
export function splitModel(id: string): { provider: string; model: string } {
  const clean = id.replace(/^lovable_ai:/, "");
  const i = clean.indexOf("/");
  if (i < 0) return { provider: "openai", model: clean };
  return { provider: clean.slice(0, i), model: clean.slice(i + 1) };
}

/** Path after "/v1/", e.g. "chat/completions", "responses", "embeddings", "audio/transcriptions". */
export function gatewayPath(url: string): string {
  const m = /\/v1\/(.+)$/.exec(url.split("?")[0] ?? url);
  if (!m?.[1]) throw new Error(`Unrecognised AI endpoint: ${url}`);
  return m[1];
}

/** Fault-injection drills pass a deliberately invalid key; keep it so the real outage path runs. */
const FAULT_KEY = "fault-injected-invalid-key";

function cleanHeaders(init: RequestInit, key: string, json: boolean): Headers {
  const h = new Headers(init.headers ?? {});
  const drill = (h.get("authorization") ?? "").includes(FAULT_KEY);
  for (const name of GATEWAY_ONLY_HEADERS) h.delete(name);
  h.set("Authorization", `Bearer ${drill ? FAULT_KEY : key}`);
  if (json) h.set("Content-Type", "application/json");
  else h.delete("Content-Type"); // let fetch set the multipart boundary
  return h;
}

/** Pure request rewrite, exported for tests. */
export function routeAiRequest(
  url: string,
  init: RequestInit,
  keys: { openai?: string | undefined; gemini?: string | undefined } = {
    openai: openaiKey(),
    gemini: geminiKey(),
  },
): { url: string; init: RequestInit } {
  const path = gatewayPath(url);

  // Multipart (speech-to-text): model travels as a form field.
  if (typeof FormData !== "undefined" && init.body instanceof FormData) {
    const form = new FormData();
    let provider = "openai";
    for (const [k, v] of init.body.entries()) {
      if (k === "model" && typeof v === "string") {
        const s = splitModel(v);
        provider = s.provider;
        form.append(k, s.model);
      } else form.append(k, v);
    }
    if (provider !== "openai") throw new Error(`Model provider "${provider}" is not supported for ${path}`);
    if (!keys.openai) throw new Error("OPENAI_API_KEY is not configured");
    return {
      url: `${OPENAI_BASE}/${path}`,
      init: { ...init, headers: cleanHeaders(init, keys.openai, false), body: form },
    };
  }

  const payload = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
  const { provider, model } = splitModel(String(payload["model"] ?? ""));
  payload["model"] = model;

  if (provider === "openai") {
    if (!keys.openai) throw new Error("OPENAI_API_KEY is not configured");
    // Direct OpenAI streams only report token usage when asked; metering needs it.
    if (path === "chat/completions" && payload["stream"] === true) {
      payload["stream_options"] = { include_usage: true };
    }
    return {
      url: `${OPENAI_BASE}/${path}`,
      init: { ...init, headers: cleanHeaders(init, keys.openai, true), body: JSON.stringify(payload) },
    };
  }

  if (provider === "google") {
    if (path !== "chat/completions")
      throw new Error(`Gemini models are only routed for chat/completions, not ${path}`);
    if (!keys.gemini) throw new Error("GEMINI_API_KEY is not configured");
    // Gemini's OpenAI-compatible endpoint uses max_tokens and has no reasoning_effort "none".
    if (payload["max_completion_tokens"] !== undefined) {
      payload["max_tokens"] = payload["max_completion_tokens"];
      delete payload["max_completion_tokens"];
    }
    delete payload["reasoning_effort"];
    delete payload["stream_options"];
    return {
      url: GEMINI_CHAT,
      init: { ...init, headers: cleanHeaders(init, keys.gemini, true), body: JSON.stringify(payload) },
    };
  }

  throw new Error(`Unknown AI model provider "${provider}"`);
}

/** Drop-in replacement for fetch() against the old gateway URLs. */
export async function aiFetch(url: string, init: RequestInit): Promise<Response> {
  const routed = routeAiRequest(url, init);
  return fetch(routed.url, routed.init);
}
