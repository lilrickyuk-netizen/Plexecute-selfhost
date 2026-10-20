/**
 * Plexecute voice gateway (V3 §64.1): Twilio bidirectional Media Stream <-> realtime AI provider
 * (Gemini Live primary, OpenAI fallback). Outcomes are delegated to backend engines (applyAck);
 * no audio or transcript is stored. Server-only; runs on the edge runtime's WebSocket support.
 */
import { env } from "@/lib/integrations.server";
import { VoiceClosing, isGoodbye, isSimpleSignoff, acceptsCallAudio } from "@/lib/voice-closing";
import {
  elevenVoiceId,
  ELEVEN_SPEAKING_GUIDE,
  isAnythingElseQuestion,
} from "@/lib/elevenlabs-voice";
import type { ElevenSpeaker } from "@/lib/elevenlabs-voice.server";
import { localHm, zonedParts } from "@/lib/tz";
import { log as voiceLog } from "@/lib/observability.server";
import { callTimeLimitSec, type Ack } from "@/lib/calling";
import {
  VOICE_TOOLS,
  toolResult,
  cleanReason,
  voiceInstructions,
  withCallAccent,
  isBritishAccent,
  beginPrompt,
  shouldPlayHoldLine,
  geminiReconnectDelayMs,
  backupVoiceName,
  providerOrder,
  createVoiceCodec,
  b64ToBytes,
  bytesToB64,
  mulawDecodeSample,
  type VoiceProvider,
} from "@/lib/voice";
import {
  OPENING_MS,
  OPENING_ULAW_B64,
  BOOKING_OPENING_MS,
  BOOKING_OPENING_ULAW_B64,
  HOLD_MS,
  HOLD_ULAW_B64,
  OPENING_GB_MS,
  OPENING_GB_ULAW_B64,
  BOOKING_OPENING_GB_MS,
  BOOKING_OPENING_GB_ULAW_B64,
  HOLD_GB_MS,
  HOLD_GB_ULAW_B64,
} from "@/lib/call-opening-audio.server";

/** Rough speech detector on one Twilio mu-law frame (mean absolute level). */
export function frameIsSpeech(twilioB64: string, threshold = 700): boolean {
  const u = b64ToBytes(twilioB64);
  if (!u.length) return false;
  let sum = 0;
  for (let i = 0; i < u.length; i++) sum += Math.abs(mulawDecodeSample(u[i]!));
  return sum / u.length > threshold;
}
import { detectSignals } from "@/lib/safety";

type WS = {
  send(d: string): void;
  close(code?: number, reason?: string): void;
  accept(): void;
  addEventListener(t: string, f: (e: any) => void): void;
};

export function openaiVoiceConfigured() {
  return !!env("OPENAI_REALTIME_API_KEY");
}
export function geminiVoiceConfigured() {
  return !!env("GEMINI_LIVE_API_KEY");
}
export function voiceLiveReady() {
  return !!env("VOICE_STREAM_SECRET") && (openaiVoiceConfigured() || geminiVoiceConfigured());
}

async function hmac(data: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env("VOICE_STREAM_SECRET")!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Short-lived per-call token passed as a Stream <Parameter>; the stream is refused without it. */
export async function streamToken(logId: string, now = Date.now()) {
  const exp = String(Math.floor(now / 1000) + 120);
  return `${exp}.${await hmac(`${logId}.${exp}`)}`;
}
export async function checkStreamToken(logId: string, token: string, now = Date.now()) {
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Math.floor(now / 1000)) return false;
  const want = await hmac(`${logId}.${exp}`);
  if (want.length !== sig.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}

type Handlers = {
  onAudio(twilioB64: string): void;
  onInterrupt(): void;
  /** Ignore late activity events once a booking outcome is saved and closing. */
  canInterrupt?(): boolean;
  onTool(id: string, name: string, args: unknown): void;
  onTranscript(t: string): void;
  /** What the voice itself said (booking calls keep both sides for the end-of-call check). */
  onSpoken?(t: string): void;
  onTurnComplete?(): void;
  /** A reply is being generated (ElevenLabs path): the member is not waiting on silence. */
  onGenerating?(): void;
  onClose(failed: boolean): void;
};
type Adapter = {
  sendAudio(twilioB64: string): void;
  /** Ask the voice to speak first (sent once the provider is ready). */
  begin(): void;
  /** A short text cue to the voice (booking calls: the line went quiet after the business replied). */
  nudge?(text: string): void;
  toolOutput(id: string, name: string, out: string): void;
  close(): void;
};

async function openSocket(url: string, headers: Record<string, string>): Promise<WS> {
  const r = await fetch(url, { headers: { Upgrade: "websocket", ...headers } });
  const ws = (r as any).webSocket as WS | undefined;
  if (!ws) throw new Error(`voice provider refused (${r.status})`);
  ws.accept();
  return ws;
}

const FATAL_OPENAI = new Set([
  "insufficient_quota",
  "invalid_api_key",
  "model_not_found",
  "session_expired",
]);
export async function connectOpenAI(
  instructions: string,
  h: Handlers,
  tools: readonly unknown[] = VOICE_TOOLS,
  _pre?: Promise<WS>,
  bookingCall = false,
): Promise<Adapter> {
  const model = env("OPENAI_REALTIME_MODEL") ?? "gpt-realtime";
  const ws = await openSocket(
    `https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
    { Authorization: `Bearer ${env("OPENAI_REALTIME_API_KEY")}` },
  );
  ws.send(
    JSON.stringify({
      type: "session.update",
      session: {
        type: "realtime",
        instructions,
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            ...(bookingCall ? { noise_reduction: { type: "near_field" } } : {}),
            turn_detection: {
              type: "server_vad",
              ...(bookingCall ? { threshold: 0.7, interrupt_response: false } : {}),
              silence_duration_ms: 400,
              prefix_padding_ms: 300,
            },
            transcription: { model: env("OPENAI_TRANSCRIBE_MODEL") ?? "gpt-4o-mini-transcribe" },
          },
          output: {
            format: { type: "audio/pcmu" },
            voice: backupVoiceName(
              instructions,
              env("OPENAI_REALTIME_VOICE"),
              env("OPENAI_REALTIME_VOICE_GB"),
            ),
          },
        },
        tools: tools.map((t) => ({ type: "function", ...(t as object) })),
        tool_choice: "auto",
      },
    }),
  );
  let done = false;
  let heard = false;
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    if (m.type === "response.output_audio.delta" || m.type === "response.audio.delta") {
      heard = true;
      h.onAudio(m.delta);
    } else if (m.type === "input_audio_buffer.speech_started") {
      if (h.canInterrupt?.() === false) return;
      h.onInterrupt();
      ws.send(JSON.stringify({ type: "response.cancel" }));
    } else if (m.type === "response.function_call_arguments.done") {
      let a: unknown = {};
      try {
        a = JSON.parse(m.arguments || "{}");
      } catch {
        /* ignore */
      }
      h.onTool(m.call_id, m.name, a);
    } else if (m.type === "conversation.item.input_audio_transcription.completed")
      h.onTranscript(m.transcript ?? "");
    else if (
      m.type === "response.output_audio_transcript.done" ||
      m.type === "response.audio_transcript.done"
    )
      h.onSpoken?.(m.transcript ?? "");
    else if (m.type === "response.done") h.onTurnComplete?.();
    else if (m.type === "error") {
      console.error("openai realtime", m.error?.code, m.error?.message);
      // Errors before any audio (no credits, bad model, bad key) leave a dead session: fail over.
      if (!done && (!heard || FATAL_OPENAI.has(m.error?.code))) {
        done = true;
        try {
          ws.close(1000);
        } catch {
          /* closed */
        }
        h.onClose(true);
      }
    }
  });
  ws.addEventListener("close", () => {
    if (!done) h.onClose(true);
  });
  ws.addEventListener("error", () => {
    if (!done) {
      done = true;
      h.onClose(true);
    }
  });
  return {
    sendAudio: (b) => ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b })),
    begin: () => ws.send(JSON.stringify({ type: "response.create" })),
    nudge: (text) => {
      ws.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
        }),
      );
      ws.send(JSON.stringify({ type: "response.create" }));
    },
    toolOutput: (id, _n, out) => {
      ws.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: id, output: out },
        }),
      );
      ws.send(JSON.stringify({ type: "response.create" }));
    },
    close: () => {
      done = true;
      try {
        ws.close(1000);
      } catch {
        /* closed */
      }
    },
  };
}

/** Opens the Gemini Live socket early so it is ready while the call context is still loading. */
export function prewarmGemini(): Promise<WS> {
  return openSocket(
    `https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(env("GEMINI_LIVE_API_KEY") ?? "")}`,
    {},
  );
}

export async function connectGemini(
  instructions: string,
  h: Handlers,
  tools: readonly unknown[] = VOICE_TOOLS,
  pre?: Promise<WS>,
  bookingCall = false,
): Promise<Adapter> {
  const model = env("GEMINI_LIVE_MODEL") ?? "gemini-2.5-flash-native-audio-latest";
  const ws = await (pre ?? prewarmGemini());
  let done = false;
  let ready = false;
  let wantBegin = false;
  const early: string[] = [];
  const pendingText: string[] = [];
  // One streaming codec per call: filter state carries across chunks so speech stays smooth.
  const codec = createVoiceCodec();
  const sendBegin = () =>
    ws.send(
      JSON.stringify({
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [
                {
                  text: beginPrompt(instructions),
                },
              ],
            },
          ],
          turnComplete: true,
        },
      }),
    );
  // Serialize asynchronous Blob decoding: chunks must not overtake each other.
  let messages = Promise.resolve();
  const handleMessage = async (e: { data: unknown }) => {
    if (done) return;
    const raw =
      typeof e.data === "string"
        ? e.data
        : new TextDecoder().decode(
            e.data instanceof ArrayBuffer ? e.data : await (e.data as Blob).arrayBuffer(),
          );
    if (done) return;
    const m = JSON.parse(raw);
    if (m.setupComplete && !ready) {
      ready = true;
      // Flush anything the member said while the voice was starting (e.g. their "hello").
      for (const b of early.splice(0))
        ws.send(
          JSON.stringify({
            realtimeInput: {
              audio: { data: codec.toGemini(b), mimeType: "audio/pcm;rate=16000" },
            },
          }),
        );
      for (const text of pendingText.splice(0))
        ws.send(
          JSON.stringify({
            clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true },
          }),
        );
      if (wantBegin) sendBegin();
    }
    const sc = m.serverContent;
    if (sc?.interrupted && h.canInterrupt?.() !== false) h.onInterrupt();
    for (const p of sc?.modelTurn?.parts ?? [])
      if (p.inlineData?.data) h.onAudio(codec.toTwilio(p.inlineData.data));
    if (sc?.inputTranscription?.text) h.onTranscript(sc.inputTranscription.text);
    if (sc?.outputTranscription?.text) h.onSpoken?.(sc.outputTranscription.text);
    for (const fc of m.toolCall?.functionCalls ?? []) h.onTool(fc.id, fc.name, fc.args ?? {});
    if (sc?.turnComplete) h.onTurnComplete?.();
  };
  ws.addEventListener("message", (e) => {
    messages = messages
      .then(() => handleMessage(e))
      .catch(() => {
        if (!done) {
          done = true;
          h.onClose(true);
        }
      });
  });
  ws.addEventListener("close", (ev: any) => {
    if (!done) {
      // Secret-free: the close code and provider reason only, never audio or words.
      console.error("gemini live closed", ev?.code, String(ev?.reason ?? "").slice(0, 200));
      done = true;
      h.onClose(true);
    }
  });
  ws.addEventListener("error", () => {
    if (!done) {
      console.error("gemini live socket error");
      done = true;
      h.onClose(true);
    }
  });
  ws.send(
    JSON.stringify({
      setup: {
        model: `models/${model}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          // No hidden thinking before speaking: it adds seconds of dead air between turns.
          thinkingConfig: { thinkingBudget: 0 },
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: env("GEMINI_LIVE_VOICE") ?? "Charon",
              },
            },
          },
        },
        systemInstruction: { parts: [{ text: instructions }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        realtimeInputConfig: {
          // Short business replies finish before background voices can cut them off.
          ...(bookingCall ? { activityHandling: "NO_INTERRUPTION" } : {}),
          automaticActivityDetection: {
            startOfSpeechSensitivity: bookingCall
              ? "START_SENSITIVITY_LOW"
              : "START_SENSITIVITY_HIGH",
            endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
            prefixPaddingMs: 200,
            silenceDurationMs: 300,
          },
        },
        tools: [{ functionDeclarations: tools }],
      },
    }),
  );
  return {
    sendAudio: (b) => {
      if (done) return;
      if (!ready) {
        if (early.length < 150) early.push(b);
        return;
      }
      ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: { data: codec.toGemini(b), mimeType: "audio/pcm;rate=16000" },
          },
        }),
      );
    },
    begin: () => {
      if (done) return;
      if (ready) sendBegin();
      else wantBegin = true;
    },
    nudge: (text) => {
      if (done) return;
      if (!ready) {
        pendingText.push(text);
        return;
      }
      ws.send(
        JSON.stringify({
          clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true },
        }),
      );
    },
    toolOutput: (id, name, out) =>
      ws.send(
        JSON.stringify({
          toolResponse: { functionResponses: [{ id, name, response: { result: out } }] },
        }),
      ),
    close: () => {
      done = true;
      try {
        ws.close(1000);
      } catch {
        /* closed */
      }
    },
  };
}

const CONNECT: Record<VoiceProvider, typeof connectOpenAI> = {
  openai: connectOpenAI,
  gemini: connectGemini,
};

/** WebSocket upgrade handler for /api/public/voice/stream. */
export function handleVoiceStream(keepAlive?: (work: Promise<unknown>) => void): Response {
  const Pair = (globalThis as any).WebSocketPair;
  if (!Pair) return new Response("WebSocket not supported here", { status: 426 });
  const pair = new Pair();
  const [client, server] = Object.values(pair) as [WS, WS];
  server.accept();
  runSession(server, keepAlive).catch((e) => {
    console.error("voice session", e);
    try {
      server.close(1011);
    } catch {
      /* closed */
    }
  });
  return new Response(null, { status: 101, webSocket: client } as any);
}

async function runSession(tw: WS, keepAlive?: (work: Promise<unknown>) => void) {
  const [{ supabaseAdmin: db }, cs] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("@/lib/calling.server"),
  ]);
  let pre: Promise<WS> | undefined;
  let streamSid = "",
    logId = "",
    userId = "",
    provider: VoiceProvider | "degraded" | null = null,
    failovers = 0,
    ended = false;
  let ai: Adapter | null = null,
    startedAt = 0,
    endReason = "hangup";
  const trace: { t: string; tool: string; ok: boolean }[] = [];
  let summary: string | null = null;
  let order: VoiceProvider[] = [];
  let instructions = "";
  let tools: readonly unknown[] = VOICE_TOOLS;
  let bookingCall = false;
  const closing = new VoiceClosing();
  let closingWatch: ReturnType<typeof setInterval> | null = null;
  let closingReason = "outcome";
  let closingMark = 0;
  let expectedClosingMark = "";
  let firstAudioAt = 0;
  let streamStartedAt = 0;
  let firstSentAt = 0;
  const turnLatencies: number[] = [];
  let interruptions = 0;
  const startClosing = (reason: string) => {
    if (closing.phase === "CLOSING" || closing.phase === "WAIT_FOR_OTHER_PERSON") return;
    closingReason = reason;
    closing.close(Date.now());
    closingWatch = setInterval(() => {
      if (closing.shouldEnd(Date.now())) void finish(closingReason);
    }, 100);
  };
  // Both sides' words, kept in memory only (booking end-of-call check, resuming after a voice drop); never stored.
  const said: { who: "business" | "member" | "assistant"; text: string }[] = [];
  // The live voice sometimes goes quiet after a short "yes", or reads a tool call aloud instead of
  // making it. Both are caught here so an agreed booking is never left unrecorded.
  let quietCue: ReturnType<typeof setTimeout> | null = null;
  let spokenTool = false;
  const heardLine = (who: "business" | "member" | "assistant", t: string) => {
    if (!t) return;
    const last = said[said.length - 1];
    if (last && last.who === who) last.text += t;
    else if (said.length < 400) said.push({ who, text: t });
    if (!bookingCall) return;
    if (who === "business") {
      if (quietCue) clearTimeout(quietCue);
      quietCue = setTimeout(() => {
        quietCue = null;
        const reply = said[said.length - 1];
        if (
          ended ||
          closing.phase === "CLOSING" ||
          closing.phase === "WAIT_FOR_OTHER_PERSON" ||
          !reply ||
          reply.who !== "business"
        )
          return;
        ai?.nudge?.(
          `(The business just said: "${reply.text.trim().slice(0, 200)}". Reply now. If they agreed the time you proposed, call confirm_booking now.)`,
        );
      }, 2500);
    } else {
      if (quietCue) clearTimeout(quietCue);
      quietCue = null;
      const m =
        !spokenTool && /confirm_booking\W*\{([^}]*)\}/.exec(last?.who === who ? last.text : t);
      if (m) {
        const date = /(\d{4}-\d{2}-\d{2})/.exec(m[1]!)?.[1];
        const start = /start\W+(\d{1,2}:\d{2})/.exec(m[1]!)?.[1];
        if (date && start) {
          spokenTool = true;
          void handlers.onTool(`spoken-${Date.now()}`, "confirm_booking", { date, start });
        }
      }
    }
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Opening line played from the stream itself, so the voice connects while it plays.
  const preOpen: string[] = [];
  let openingActive = false,
    openingEndsAt = 0,
    openingDoneAt = 0,
    begun = false,
    coachSpoke = false,
    voicedRun = 0,
    speechAt = 0,
    lastVoiceAt = 0;
  let watch: ReturnType<typeof setInterval> | null = null;
  // Never leave the other person on dead air: if they finished speaking and no reply audio has
  // started, play the prerecorded holding line once per turn (only into silence, never over them).
  let playEndAt = 0;
  let lastAiAudioAt = 0,
    holdPlayedForTurn = false,
    awaitingReply = false,
    turnEndAt = 0,
    holdingUntil = 0;
  let holdWatch: ReturnType<typeof setInterval> | null = null;
  const sendClip = (b64: string) => {
    const bytes = b64ToBytes(b64);
    for (let i = 0; i < bytes.length; i += 1600)
      tw.send(
        JSON.stringify({
          event: "media",
          streamSid,
          media: { payload: bytesToB64(bytes.subarray(i, i + 1600)) },
        }),
      );
  };
  let britishClips = false;
  const playHold = () => {
    if (ended || !streamSid || holdPlayedForTurn) return;
    // Member Coach calls never hear the prerecorded "one moment", not even while the voice reconnects.
    if (!shouldPlayHoldLine(bookingCall)) return;
    holdPlayedForTurn = true;
    holdingUntil = Date.now() + (britishClips ? HOLD_GB_MS : HOLD_MS);
    sendClip(britishClips ? HOLD_GB_ULAW_B64 : HOLD_ULAW_B64);
  };
  const beginNow = () => {
    if (begun || !ai) return;
    begun = true;
    ai.begin();
  };
  // Coach's first line is generated while the prerecorded opening plays and held here, then released
  // the instant the person finishes their hello (or stays quiet). Their hello is not sent to the voice,
  // so it answers one turn only: no slow wait on its own end-of-speech check, no start-stop-restart.
  let released = true;
  const outBuf: string[] = [];
  const release = () => {
    if (released) return;
    released = true;
    if (!begun) beginNow();
    closing.request();
    if (outBuf.length && !firstSentAt) firstSentAt = Date.now();
    for (const b of outBuf.splice(0))
      if (!ended && streamSid)
        tw.send(JSON.stringify({ event: "media", streamSid, media: { payload: b } }));
  };
  const openingDone = () => {
    if (!openingActive) return;
    openingActive = false;
    openingDoneAt = Date.now();
    preOpen.length = 0; // the hello stays local; Coach's prepared reply answers it
    watch = setInterval(() => {
      if (ended || released) {
        if (watch) clearInterval(watch);
        watch = null;
        return;
      }
      const now = Date.now();
      if (!speechAt && now - openingDoneAt > 700) release();
      else if (speechAt && now - lastVoiceAt > 300) release();
      else if (now - openingDoneAt > 5000) release();
    }, 100);
  };

  let finishing: Promise<void> | null = null;
  const finish = (reason: string): Promise<void> => {
    if (finishing) return finishing;
    finishing = finishSession(reason);
    keepAlive?.(finishing);
    return finishing;
  };
  const finishSession = async (reason: string) => {
    if (ended) return;
    ended = true;
    endReason = reason;
    if (timer) clearTimeout(timer);
    if (watch) clearInterval(watch);
    if (holdWatch) clearInterval(holdWatch);
    if (quietCue) clearTimeout(quietCue);
    if (closingWatch) clearInterval(closingWatch);
    closing.phase = "END";
    voiceLog({
      level: "info",
      action: "voice_call_timing",
      provider: provider ?? "unknown",
      result_code: reason,
      first_generated_ms: firstAudioAt && streamStartedAt ? firstAudioAt - streamStartedAt : null,
      first_sent_ms: firstSentAt && streamStartedAt ? firstSentAt - streamStartedAt : null,
      opening_buffer_ms: firstSentAt && firstAudioAt ? firstSentAt - firstAudioAt : null,
      mean_turn_ms: turnLatencies.length
        ? Math.round(turnLatencies.reduce((a, b) => a + b, 0) / turnLatencies.length)
        : null,
      longest_turn_ms: turnLatencies.length ? Math.max(...turnLatencies) : null,
      interruptions,
    });
    // Let the opening finish playing before handing back to the keypad.
    if (reason === "degraded" && openingActive)
      await new Promise((r) => setTimeout(r, Math.max(0, openingEndsAt - Date.now())));
    ai?.close();
    const ttsChars = speaker?.characters() ?? 0;
    speaker?.close();
    const voiceSeconds = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    // Booking call that ended with no recorded outcome: check what was actually agreed.
    if (
      logId &&
      bookingCall &&
      !trace.some((x) => x.ok && x.tool !== "needs_member") &&
      said.length
    ) {
      try {
        const ap = await import("@/lib/appointments.server");
        // Booking calls only ever record the business and the assistant.
        const lines = said.filter(
          (x): x is { who: "business" | "assistant"; text: string } => x.who !== "member",
        );
        if ((await ap.settleBookingFromTranscript(db, logId, lines)) === "confirmed") {
          trace.push({ t: new Date().toISOString(), tool: "confirm_booking_after_call", ok: true });
          summary = "Booking call: confirmed (checked after the call).";
        }
      } catch (e) {
        console.error("booking call check", e);
      }
    }
    if (logId)
      await db
        .from("call_logs")
        .update({
          voice_provider: provider,
          voice_seconds: voiceSeconds,
          voice_end_reason: endReason,
          voice_failovers: failovers,
          tool_trace: trace as never,
          summary,
        })
        .eq("id", logId);
    if (logId && voiceSeconds > 0) {
      const { data: lg } = await db
        .from("call_logs")
        .select("user_id")
        .eq("id", logId)
        .maybeSingle();
      await (
        await import("./usage.server")
      ).recordUsage({
        userId: lg?.user_id ?? null,
        provider: `voice:${provider}`,
        feature: "live_voice",
        unit: "voice_seconds",
        quantity: voiceSeconds,
      });
      if (lg?.user_id)
        await (
          await import("./spend.server")
        ).chargeCall(lg.user_id, "live_voice", voiceSeconds, "voice", `voice:${logId}`);
      if (ttsChars > 0) {
        await (
          await import("./usage.server")
        ).recordUsage({
          userId: lg?.user_id ?? null,
          provider: "voice:elevenlabs",
          feature: "live_voice_tts",
          unit: "characters",
          quantity: ttsChars,
        });
        if (lg?.user_id)
          await (await import("./spend.server")).chargeTts(lg.user_id, ttsChars, logId);
      }
    }
    try {
      tw.close(1000);
    } catch {
      /* closed */
    } // TwiML continues to the after-stream step
  };

  let speaker: ElevenSpeaker | null = null;
  // Double goodbye guard: once a goodbye has been said in the closing, nothing else is voiced
  // unless the other person raises something new.
  let goodbyeSaid = false;
  let lastGoodbyeAt = 0;
  let turnSaid = "";
  const inClosing = () => closing.phase === "CLOSING" || closing.phase === "WAIT_FOR_OTHER_PERSON";
  const muted = () => goodbyeSaid && inClosing();
  const makeSpeaker = async (): Promise<ElevenSpeaker | null> => {
    const key = env("ELEVENLABS_API_KEY");
    const voiceId = elevenVoiceId(isBritishAccent(instructions), {
      gb: env("ELEVENLABS_VOICE_ID_GB") ?? null,
      us: env("ELEVENLABS_VOICE_ID_US") ?? null,
    });
    if (!key || !voiceId) return null;
    try {
      const { createElevenSpeaker } = await import("@/lib/elevenlabs-voice.server");
      return createElevenSpeaker({
        apiKey: key,
        voiceId,
        bookingCall,
        muted,
        dropSentence: (t) => !bookingCall && isAnythingElseQuestion(t),
      });
    } catch {
      voiceLog({
        level: "warn",
        action: "voice_tts_fallback",
        provider: "elevenlabs",
        result_code: "init_failed",
      });
      return null;
    }
  };
  let geminiRetries = 0,
    geminiWaitMs = 0;
  const connectNext = async (): Promise<void> => {
    while (order.length) {
      const p = order.shift();
      if (!p) break;
      if (p === "gemini" && geminiWaitMs) {
        await new Promise((r) => setTimeout(r, geminiWaitMs));
        geminiWaitMs = 0;
        if (ended) return;
      }
      try {
        const warm = p === "gemini" ? pre : undefined;
        pre = undefined;
        // ElevenLabs is only the voice on the Gemini path; the existing voice stays the fallback.
        if (p === "gemini" && !speaker) speaker = await makeSpeaker();
        const h = p === "gemini" && speaker?.active() ? speaker.wrap(handlers) : handlers;
        ai = await CONNECT[p](
          speaker?.active() && p === "gemini"
            ? `${instructions}\n${bookingCall ? ELEVEN_SPEAKING_GUIDE.replace("then call end_call and say nothing more.", "then say nothing more; use only the booking tools provided.") : ELEVEN_SPEAKING_GUIDE}`
            : instructions,
          h,
          tools,
          warm,
          bookingCall,
        );
        provider = p;
        if (!startedAt) startedAt = Date.now();
        // Restore only the current call's in-memory context, so the backup never starts
        // another booking or silently waits for a business that has already answered.
        if (begun && said.length)
          ai.nudge?.(
            `Continue this same call${isBritishAccent(instructions) ? " in your British accent" : ""}; do not introduce yourself or greet again, and do not say "one moment" or "bear with me". Conversation so far:\n${said
              .map((x) => `${x.who}: ${x.text}`)
              .join("\n")
              .slice(-6000)}\n${
              bookingCall
                ? "Respond to the business's latest reply, using the booking tools if they agreed."
                : "Respond naturally to the member's latest reply, using the call tools to record their answer if they gave one."
            }`,
          );
        else if (begun && !coachSpoke) ai.begin();
        return;
      } catch (e) {
        console.error("voice connect", p, e);
      }
      failovers++;
    }
    provider = "degraded";
    await finish("degraded");
  };

  const handlers: Handlers = {
    canInterrupt: () => acceptsCallAudio(bookingCall, closing.phase),
    onAudio: (b) => {
      if (ended) return;
      if (muted() && !turnSaid) return; // a fresh turn after the goodbye is never voiced
      if (!firstAudioAt) firstAudioAt = Date.now();
      closing.audio();
      if (!released) {
        if (outBuf.length < 2000) outBuf.push(b);
        return;
      }
      coachSpoke = true;
      if (!firstSentAt) firstSentAt = Date.now();
      if (awaitingReply && turnEndAt) turnLatencies.push(Date.now() - turnEndAt);
      lastAiAudioAt = Date.now();
      // Audio is sent faster than it plays: track when the caller will actually stop hearing it.
      playEndAt = Math.max(playEndAt, Date.now()) + (b.length * 3) / 4 / 8;
      if (quietCue) clearTimeout(quietCue);
      quietCue = null;
      awaitingReply = false;
      if (!ended && streamSid)
        tw.send(JSON.stringify({ event: "media", streamSid, media: { payload: b } }));
    },
    onInterrupt: () => {
      playEndAt = 0;
      if (!released) return; // nothing has played yet; never cut the opening
      interruptions++;
      closing.interrupted();
      expectedClosingMark = ""; // clear returns marks for audio that was not played
      if (bookingCall && closingReason === "closing_done") closingReason = "outcome";
      if (streamSid) tw.send(JSON.stringify({ event: "clear", streamSid }));
    },
    onGenerating: () => {
      lastAiAudioAt = Math.max(lastAiAudioAt, Date.now());
      awaitingReply = false;
      if (quietCue) clearTimeout(quietCue);
      quietCue = null;
    },
    onSpoken: (t) => {
      heardLine("assistant", t);
      if (!muted()) turnSaid += t;
    },
    onTurnComplete: () => {
      if (inClosing() && isGoodbye(turnSaid)) goodbyeSaid = true;
      const wasGoodbye = isGoodbye(turnSaid);
      turnSaid = "";
      if (wasGoodbye && !inClosing()) lastGoodbyeAt = Date.now();
      if (ended || !closing.completed() || !streamSid) return;
      expectedClosingMark = `closing-${++closingMark}`;
      tw.send(JSON.stringify({ event: "mark", streamSid, mark: { name: expectedClosingMark } }));
    },
    onTranscript: async (t) => {
      if (bookingCall) {
        if (closing.phase === "CLOSING" || closing.phase === "WAIT_FOR_OTHER_PERSON") return;
        heardLine("business", t); // the other party is a business, not the member
        return;
      }
      heardLine("member", t);
      // After the goodbye, a plain "thanks, bye" just lets the call end; a new question reopens it.
      if (goodbyeSaid && inClosing() && !isSimpleSignoff(t)) {
        goodbyeSaid = false;
        if (closingWatch) clearInterval(closingWatch);
        closingWatch = null;
        closing.reopen();
      }
      // Ephemeral safety screening; the transcript itself is never stored (§64.11).
      const sig = detectSignals(t);
      if (sig.length && userId) {
        const { recordSafety } = await import("@/lib/safety.server");
        await recordSafety(userId, "calling", "input", sig);
        summary = "Check-in paused for your safety.";
        await finish("safety");
      }
    },
    onTool: async (id, name, args) => {
      if (quietCue) clearTimeout(quietCue);
      quietCue = null;
      // Tool work (saving the booking) can take a moment: cover it with the holding line.
      const holdTimer = setTimeout(playHold, 700);
      try {
        await onToolInner(id, name, args);
      } catch (e) {
        console.error("voice outcome failed", e);
        if (bookingCall) await finish("degraded");
      } finally {
        clearTimeout(holdTimer);
      }
    },
    onClose: (failed) => {
      if (ended) return;
      if (failed) {
        failovers++;
        // A dropped Gemini session (provider "1011 internal error") is reopened with this call's context,
        // after a short pause, before any backup voice: back-to-back reopens failed together on 17 Oct.
        const delay = geminiReconnectDelayMs(geminiRetries);
        if (provider === "gemini" && delay !== null) {
          geminiRetries++;
          geminiWaitMs = delay;
          order.unshift("gemini");
        }
        ai = null;
        // Booking calls keep the business on the line with the holding line; member calls reconnect silently.
        holdPlayedForTurn = false;
        playHold();
        void connectNext();
      }
    },
  };
  async function onToolInner(id: string, name: string, args: unknown) {
    // A goodbye must never repeat the already-applied transaction or acknowledgement.
    if (
      (closing.phase === "CLOSING" || closing.phase === "WAIT_FOR_OTHER_PERSON") &&
      name !== "stop_all_calls" &&
      name !== "safety_concern"
    ) {
      ai?.toolOutput(
        id,
        name,
        "The outcome is already recorded. No further action. Finish your brief goodbye and listen.",
      );
      return;
    }
    {
      if (bookingCall) {
        const entry = { t: new Date().toISOString(), tool: name, ok: false };
        trace.push(entry);
        const ap = await import("@/lib/appointments.server");
        const reply = await ap.bookingVoiceOutcome(
          db,
          logId,
          name,
          (args ?? {}) as Record<string, unknown>,
        );
        entry.ok = true;
        summary = `Booking call: ${name.replace(/_/g, " ")}.`;
        if (/decline it and ask/.test(reply)) {
          entry.ok = false;
          if (id.startsWith("spoken-")) ai?.nudge?.(`(The booking result: ${reply})`);
          else ai?.toolOutput(id, name, reply);
        } else {
          // Keep Gemini for the farewell; the signed TTS path remains the failure safety net.
          const signoff = await ap.bookingCallSignoff(db, logId);
          startClosing("outcome");
          const closeCue = `The saved result: ${reply}. Say this closing once, naturally: ${signoff} Then listen for their acknowledgement; do not start another booking.`;
          if (id.startsWith("spoken-")) ai?.nudge?.(closeCue);
          else ai?.toolOutput(id, name, closeCue);
        }
        return;
      }
      const r = toolResult(name);
      trace.push({ t: new Date().toISOString(), tool: name, ok: true });
      if (r.safety) {
        const sig = detectSignals(cleanReason(args));
        const { recordSafety } = await import("@/lib/safety.server");
        await recordSafety(userId, "calling", "input", sig.length ? sig : ["pain"]);
        summary = "Check-in paused for your safety.";
        await finish("safety");
        return;
      }
      if (r.ack) {
        await cs.applyAck(db, logId, r.ack as Ack);
        summary = `On the call you chose: ${r.ack.toLowerCase().replace(/_/g, " ")}${cleanReason(args) ? ` (${cleanReason(args)})` : ""}.`;
      }
      // Root cause of the double goodbye: the voice usually says goodbye and then calls end_call, and
      // the tool reply asked for another goodbye. If one was just said, end on that one.
      const inTurn = isGoodbye(turnSaid);
      const already = inTurn || (!!lastGoodbyeAt && Date.now() - lastGoodbyeAt < 20_000);
      if (r.end) {
        startClosing(r.ack ? "outcome" : "no_choice");
        if (already) {
          goodbyeSaid = true;
          closing.goodbyeAlreadySpoken();
          if (streamSid && !inTurn) {
            expectedClosingMark = `closing-${++closingMark}`;
            tw.send(
              JSON.stringify({ event: "mark", streamSid, mark: { name: expectedClosingMark } }),
            );
          }
        }
      }
      ai?.toolOutput(
        id,
        name,
        already
          ? "Recorded. You have already said goodbye; do not say anything else."
          : r.ack
            ? "Recorded. Say a one-sentence goodbye now."
            : "Say a one-sentence goodbye now.",
      );
    }
  }

  // Unauthenticated sockets are closed quickly and every non-start frame is ignored until the
  // stream token has been verified.
  let authed = false;
  const authDeadline = setTimeout(() => {
    if (authed) return;
    ended = true;
    try {
      tw.close(1008);
    } catch {
      /* closed */
    }
  }, 10_000);
  tw.addEventListener("message", async (e) => {
    let m: any;
    try {
      m = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (!authed && m?.event !== "start") return;
    if (m.event === "start") {
      if (authed) return;
      streamSid = m.start.streamSid;
      const p = m.start.customParameters ?? {};
      logId = String(p.log ?? "");
      if (!(await checkStreamToken(logId, String(p.token ?? "")))) {
        logId = "";
        clearTimeout(authDeadline);
        try {
          tw.close(1008);
        } catch {
          /* closed */
        }
        ended = true;
        return;
      }
      authed = true;
      streamStartedAt = Date.now();
      clearTimeout(authDeadline);
      const op = String(p.opening ?? "");
      britishClips = String(p.accent ?? "") === "gb";
      if (op === "1" || op === "booking") {
        // Play the prerecorded opening immediately (no AI needed), then a mark so Twilio tells us when it has finished.
        const ms =
          op === "booking"
            ? britishClips
              ? BOOKING_OPENING_GB_MS
              : BOOKING_OPENING_MS
            : britishClips
              ? OPENING_GB_MS
              : OPENING_MS;
        openingActive = true;
        released = false;
        openingEndsAt = Date.now() + ms;
        sendClip(
          op === "booking"
            ? britishClips
              ? BOOKING_OPENING_GB_ULAW_B64
              : BOOKING_OPENING_ULAW_B64
            : britishClips
              ? OPENING_GB_ULAW_B64
              : OPENING_ULAW_B64,
        );
        tw.send(JSON.stringify({ event: "mark", streamSid, mark: { name: "opening" } }));
        setTimeout(openingDone, ms + 300);
      }
      holdWatch = setInterval(() => {
        if (ended) {
          if (holdWatch) clearInterval(holdWatch);
          return;
        }
        const now = Date.now();
        if (
          closing.phase !== "CLOSING" &&
          closing.phase !== "WAIT_FOR_OTHER_PERSON" &&
          awaitingReply &&
          !openingActive &&
          now - turnEndAt > 2500 &&
          now - lastAiAudioAt > 2500
        )
          playHold();
      }, 100);
      order = providerOrder({ openai: openaiVoiceConfigured(), gemini: geminiVoiceConfigured() });
      // Open the voice connection while the call details load, so Coach speaks as soon as possible.
      if (order[0] === "gemini") {
        pre = prewarmGemini();
        pre.catch(() => undefined);
      }
      const [{ data: log }, bk] = await Promise.all([
        db.from("call_logs").select("user_id,campaign_id").eq("id", logId).single(),
        import("@/lib/appointments.server").then((ap) => ap.bookingCallContext(db, logId)),
        // Member picked up: recorded here so the answer webhook can return the stream instantly.
        openingActive ? cs.markConnected(db, logId) : Promise.resolve(),
      ]);
      userId = log!.user_id;
      if (bk) {
        const ap = await import("@/lib/appointments");
        bookingCall = true;
        tools = ap.BOOKING_VOICE_TOOLS;
        const { data: profile, error: profileError } = await db
          .from("profiles")
          .select("billing_country")
          .eq("id", userId)
          .single();
        if (profileError) throw profileError;
        instructions = withCallAccent(
          ap.bookingCallInstructions({ ...bk, maxMinutes: 6 }),
          profile?.billing_country,
        );
        timer = setTimeout(() => void finish("time_limit"), 400 * 1000);
        await connectNext();
        // Prepare the next line now; it plays as soon as the greeting and any reply have finished.
        beginNow();
        return;
      }
      const [{ data: camp }, { data: pr }] = await Promise.all([
        db
          .from("call_campaigns")
          .select("block_id,trigger,dedupe_key")
          .eq("id", log!.campaign_id!)
          .single(),
        db
          .from("profiles")
          .select(
            "call_style,coaching_style,call_max_minutes,display_name,timezone,billing_country",
          )
          .eq("id", userId)
          .single(),
      ]);
      // Calls the member booked (e.g. "ring me to check the oven") carry their reason on the scheduled call.
      const schedId = /^sched:(.+)$/.exec(
        String((camp as { dedupe_key?: string } | null)?.dedupe_key ?? ""),
      )?.[1];
      const [{ data: blk }, { data: sc }] = await Promise.all([
        camp?.block_id
          ? db.from("plan_blocks").select("title").eq("id", camp.block_id).maybeSingle()
          : Promise.resolve({ data: null as { title: string } | null }),
        !camp?.block_id && schedId
          ? db
              .from("scheduled_calls")
              .select("purpose,commitment_id")
              .eq("id", schedId)
              .maybeSingle()
          : Promise.resolve({
              data: null as { purpose: string | null; commitment_id: string | null } | null,
            }),
      ]);
      let reason: string | null = null;
      if (!blk && sc) {
        const { data: cm } = sc.commitment_id
          ? await db.from("commitments").select("title").eq("id", sc.commitment_id).maybeSingle()
          : { data: null };
        reason = cm?.title ?? sc.purpose?.replace(/^Before\s+/i, "") ?? null;
      }
      const maxMin = pr?.call_max_minutes ?? 3;
      const now = new Date();
      const { data: commitments } = await db
        .from("commitments")
        .select("title,start_time,recurrence,days,on_date")
        .eq("user_id", userId)
        .eq("active", true);
      const day = zonedParts(now, pr?.timezone);
      const upcoming = (commitments ?? [])
        .filter(
          (c) =>
            (c.recurrence === "once" ? c.on_date === day.key : c.days.includes(day.isoDow)) &&
            c.start_time.slice(0, 5) >= localHm(now, pr?.timezone),
        )
        .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
      instructions = voiceInstructions({
        title: blk?.title ?? null,
        reason,
        trigger: camp?.trigger ?? "due",
        style: pr?.call_style ?? pr?.coaching_style,
        maxMinutes: maxMin,
        firstName: pr?.display_name?.trim().split(/\s+/)[0] ?? null,
        billingCountry: pr?.billing_country ?? null,
        localTime: localHm(now, pr?.timezone),
        upcoming: upcoming ? `${upcoming.title} at ${upcoming.start_time.slice(0, 5)}` : null,
      });
      // Hard stop slightly before the provider TimeLimit so the keypad wrap-up can still play.
      timer = setTimeout(
        () => void finish("time_limit"),
        Math.max(30, callTimeLimitSec(maxMin, 99999) - 20) * 1000,
      );
      await connectNext();
      // Prepare Coach's first line during the opening (held until the hello ends), or speak at once.
      if (!released || (!openingActive && !openingDoneAt)) beginNow();
    } else if (m.event === "mark" && m.mark?.name === "opening") openingDone();
    else if (m.event === "mark" && expectedClosingMark && m.mark?.name === expectedClosingMark) {
      closing.played(Date.now());
      expectedClosingMark = "";
      if (bookingCall) closingReason = "closing_done";
    } else if (m.event === "media" && !ended && openingActive) {
      // Buffer speech during the opening so an early hello is not lost.
      if (preOpen.length < 200) preOpen.push(m.media.payload);
      if (frameIsSpeech(m.media.payload)) {
        closing.heard(Date.now());
        closing.discussion();
        const now = Date.now();
        if (!speechAt) speechAt = now;
        lastVoiceAt = now;
      }
    } else if (m.event === "media" && !ended) {
      // The outcome is saved: let the thank-you play and its playback mark end the call.
      // Ambient speech must neither clear the farewell nor extend acknowledgement silence.
      if (!acceptsCallAudio(bookingCall, closing.phase)) return;
      if (!released && openingDoneAt) {
        // Listen for the member's hello so Coach can answer it.
        const now = Date.now();
        if (frameIsSpeech(m.media.payload)) {
          voicedRun++;
          if (voicedRun >= 2 && !speechAt) speechAt = now;
          if (speechAt) lastVoiceAt = now;
        } else voicedRun = 0;
        return; // the hello stays local until Coach's prepared reply is released
      }
      // End-of-turn tracking for the holding line: they spoke, then went quiet.
      if (frameIsSpeech(m.media.payload)) {
        closing.heard(Date.now());
        closing.discussion();
        lastVoiceAt = Date.now();
        awaitingReply = false;
        holdPlayedForTurn = false;
      } else if (
        lastVoiceAt &&
        !awaitingReply &&
        Date.now() - lastVoiceAt > 300 &&
        lastVoiceAt > lastAiAudioAt &&
        Date.now() > holdingUntil
      ) {
        awaitingReply = true;
        turnEndAt = Date.now();
        // Member calls: if Coach stays silent after they finish, prompt it once to answer or wrap up.
        if (!bookingCall) {
          const at = turnEndAt;
          setTimeout(() => {
            if (ended || !awaitingReply || turnEndAt !== at || lastAiAudioAt > at) return;
            if (Date.now() < playEndAt) return; // Coach is still being heard
            if (closing.phase === "CLOSING" || closing.phase === "WAIT_FOR_OTHER_PERSON") return;
            const lastMember = [...said].reverse().find((x) => x.who === "member")?.text ?? "";
            // Only a real sign-off invites a goodbye; a "hello" or an answer gets a reply, never an ending.
            ai?.nudge?.(
              lastMember.trim() && isSimpleSignoff(lastMember) && isGoodbye(lastMember)
                ? "(The member is saying goodbye. Say a short goodbye and call end_call.)"
                : "(The member has finished speaking. Reply now, briefly, to what they actually said. If they only said hello, greet them and ask your question. Do not record a choice or end the call unless they clearly answered.)",
            );
          }, 2500);
        }
      }
      ai?.sendAudio(m.media.payload);
    } else if (m.event === "stop") await finish(endReason === "hangup" ? "hangup" : endReason);
  });
  tw.addEventListener("close", () => void finish("hangup"));
}
