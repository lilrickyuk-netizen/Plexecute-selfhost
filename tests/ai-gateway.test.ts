import { describe, it, expect } from "vitest";
import { routeAiRequest, splitModel } from "../src/lib/ai-gateway.server";

const K = { openai: "sk-test", gemini: "gm-test" };
const G = "https://ai.gateway.lovable.dev/v1/";
const body = (r: { init: RequestInit }) => JSON.parse(String(r.init.body));
const auth = (r: { init: RequestInit }) => new Headers(r.init.headers).get("authorization");

describe("direct AI provider routing", () => {
  it("sends OpenAI chat to api.openai.com with usage on streams and no gateway headers", () => {
    const r = routeAiRequest(
      `${G}chat/completions`,
      {
        method: "POST",
        headers: { Authorization: "Bearer old", "X-Lovable-AIG-SDK": "fetch" },
        body: JSON.stringify({ model: "openai/gpt-6-luna", stream: true, messages: [] }),
      },
      K,
    );
    expect(r.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(auth(r)).toBe("Bearer sk-test");
    expect(new Headers(r.init.headers).get("x-lovable-aig-sdk")).toBeNull();
    expect(body(r).model).toBe("gpt-6-luna");
    expect(body(r).stream_options).toEqual({ include_usage: true });
  });

  it("routes the Responses API and embeddings to OpenAI", () => {
    const a = routeAiRequest(
      `${G}responses`,
      { headers: { "Lovable-API-Key": "x" }, body: JSON.stringify({ model: "openai/gpt-6-luna" }) },
      K,
    );
    expect(a.url).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(a.init.headers).get("lovable-api-key")).toBeNull();
    const e = routeAiRequest(
      `${G}embeddings`,
      { body: JSON.stringify({ model: "openai/text-embedding-3-small", input: ["a"] }) },
      K,
    );
    expect(e.url).toBe("https://api.openai.com/v1/embeddings");
  });

  it("sends Gemini to its OpenAI-compatible endpoint with max_tokens", () => {
    const r = routeAiRequest(
      `${G}chat/completions`,
      {
        body: JSON.stringify({
          model: "google/gemini-3.8-flash",
          max_completion_tokens: 100,
          reasoning_effort: "none",
        }),
      },
      K,
    );
    expect(r.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(auth(r)).toBe("Bearer gm-test");
    expect(body(r)).toMatchObject({ model: "gemini-3.8-flash", max_tokens: 100 });
    expect(body(r).max_completion_tokens).toBeUndefined();
    expect(body(r).reasoning_effort).toBeUndefined();
  });

  it("rewrites the model in multipart transcription uploads", () => {
    const fd = new FormData();
    fd.append("model", "openai/gpt-transcribe");
    fd.append("file", new Blob(["abc"], { type: "audio/wav" }), "a.wav");
    const r = routeAiRequest(`${G}audio/transcriptions`, { body: fd }, K);
    expect(r.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect((r.init.body as FormData).get("model")).toBe("gpt-transcribe");
  });

  it("keeps fault-injection keys so outage drills still fail", () => {
    const r = routeAiRequest(
      `${G}chat/completions`,
      {
        headers: { Authorization: "Bearer fault-injected-invalid-key" },
        body: JSON.stringify({ model: "openai/gpt-6-luna" }),
      },
      K,
    );
    expect(auth(r)).toBe("Bearer fault-injected-invalid-key");
  });

  it("refuses when a key is missing or a route is unsupported", () => {
    expect(() =>
      routeAiRequest(`${G}chat/completions`, { body: JSON.stringify({ model: "openai/x" }) }, {}),
    ).toThrow();
    expect(() =>
      routeAiRequest(`${G}responses`, { body: JSON.stringify({ model: "google/x" }) }, K),
    ).toThrow();
    expect(splitModel("lovable_ai:openai/gpt-6-luna")).toEqual({
      provider: "openai",
      model: "gpt-6-luna",
    });
  });
});
