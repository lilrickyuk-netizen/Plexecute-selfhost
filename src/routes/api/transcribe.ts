import { createFileRoute } from "@tanstack/react-router";

/**
 * Voice input for free-text fields: speech in, text out. The member's bearer token is verified here.
 * Audio is forwarded to the OpenAI transcription endpoint and never stored; only the
 * transcript text is returned, which the member reviews in the same field before the normal submit.
 */
const MAX_BYTES = 12 * 1024 * 1024;
const MODEL = "openai/gpt-transcribe";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!token) return json({ error: "Please sign in again." }, 401);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: u, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !u.user) return json({ error: "Please sign in again." }, 401);
        const userId = u.user.id;

        const sec = await import("@/lib/security.server");
        if (!(await sec.rateLimit("voice_input", userId)))
          return json({ error: "Too many voice entries this hour. Please type for now." }, 429);
        const { flagOn } = await import("@/lib/flags.server");
        if (!(await flagOn("voice_input")))
          return json({ error: "Voice input is paused right now. Typing still works." }, 503);

        const declared = Number(request.headers.get("content-length") ?? "0");
        if (declared > MAX_BYTES + 64 * 1024)
          return json({ error: "That recording is too long. Please record a shorter clip." }, 413);
        const apiKey = process.env["OPENAI_API_KEY"];
        if (!apiKey) return json({ error: "Voice input is not switched on yet." }, 503);

        let file: File | null = null;
        try {
          const form = await request.formData();
          const f = form.get("file");
          file = f instanceof File ? f : null;
        } catch {
          return json({ error: "The recording could not be read." }, 400);
        }
        if (!file || file.size < 2048 || file.size > MAX_BYTES || !file.type.startsWith("audio/"))
          return json({ error: "Nothing was recorded. Please try again." }, 400);

        const upstreamForm = new FormData();
        upstreamForm.append("model", MODEL);
        upstreamForm.append("file", file, file.name || "recording.wav");
        upstreamForm.append("response_format", "json");
        upstreamForm.append("stream", "true");

        const { recordUsage } = await import("@/lib/usage.server");
        let res: Response;
        try {
          res = await (await import("@/lib/ai-gateway.server")).aiFetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: upstreamForm,
            signal: request.signal,
          });
        } catch {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          await recordUsage({
            userId,
            provider: "openai",
            feature: "voice_input",
            unit: "requests",
            quantity: 1,
            ok: false,
          });
          return json(
            { error: "Couldn't reach the transcription service. Your text is unchanged." },
            502,
          );
        }
        if (!res.ok || !res.body) {
          await recordUsage({
            userId,
            provider: "openai",
            feature: "voice_input",
            unit: "requests",
            quantity: 1,
            ok: false,
          });
          const msg =
            res.status === 429
              ? "Voice input is busy. Please try again in a moment."
              : res.status === 402 || res.status === 403
                ? "Voice input is unavailable right now. Typing still works."
                : "Transcription failed. Your text is unchanged.";
          return json({ error: msg }, res.status >= 500 ? 502 : res.status);
        }

        // Read the SSE stream to the end; the done event carries the final text and usage.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let text = "";
        let deltas = "";
        let seconds = 0;
        let failed = false;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, idx).trim();
              buf = buf.slice(idx + 1);
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (!data || data === "[DONE]") continue;
              try {
                const ev = JSON.parse(data) as {
                  type?: string;
                  delta?: string;
                  text?: string;
                  usage?: { seconds?: number; duration?: number };
                };
                if (ev.type === "transcript.text.delta" && ev.delta) deltas += ev.delta;
                else if (ev.type === "transcript.text.done") {
                  text = ev.text ?? deltas;
                  seconds = Number(ev.usage?.seconds ?? ev.usage?.duration ?? 0);
                } else if (ev.type === "error") failed = true;
              } catch {
                /* ignore partial line */
              }
            }
          }
        } catch {
          if (request.signal.aborted) return new Response(null, { status: 499 });
          failed = true;
        }
        const finalText = (text || deltas).trim();
        await recordUsage([
          {
            userId,
            provider: "openai",
            feature: "voice_input",
            unit: "requests",
            quantity: 1,
            ok: !failed,
          },
          {
            userId,
            provider: "openai",
            feature: "voice_input",
            unit: "voice_seconds",
            quantity: Math.ceil(seconds),
          },
        ]);
        if (failed) return json({ error: "Transcription failed. Your text is unchanged." }, 502);
        if (!finalText) return json({ error: "No speech was heard. Please try again." }, 422);
        return json({ text: finalText });
      },
    },
  },
});
