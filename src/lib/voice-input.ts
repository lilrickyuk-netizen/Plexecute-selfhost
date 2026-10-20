// Browser-side helpers for voice input. Captures PCM and uploads one complete WAV, so every
// clip decodes on any browser (including iOS Safari). Audio lives only in memory until upload.

export function encodeWav(chunks: readonly Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((sum, c) => sum + c.length, 0);
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const tag = (o: number, v: string) => {
    for (let i = 0; i < v.length; i++) view.setUint8(o + i, v.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, length * 2, true);
  let off = 44;
  for (const c of chunks)
    for (const v of c) {
      const s = Math.max(-1, Math.min(1, v));
      view.setInt16(off, s * (s < 0 ? 32768 : 32767), true);
      off += 2;
    }
  return new Blob([bytes], { type: "audio/wav" });
}

export interface Recording {
  stop: () => Promise<File>;
  cancel: () => void;
}

/** Max ~4 minutes at 48kHz mono 16-bit stays under the upload cap. */
export const MAX_RECORD_SECONDS = 120;

export async function startRecording(): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia) throw new VoiceError("unavailable");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    throw new VoiceError(
      name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable",
    );
  }
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let peak = 0;
  node.onaudioprocess = (ev) => {
    const d = ev.inputBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i += 64) peak = Math.max(peak, Math.abs(d[i] ?? 0));
    chunks.push(new Float32Array(d));
  };
  source.connect(node);
  node.connect(ctx.destination);
  let ended = false;
  const teardown = () => {
    ended = true;
    stream.getTracks().forEach((t) => t.stop());
    node.onaudioprocess = null;
    try {
      node.disconnect();
      source.disconnect();
    } catch {
      /* already disconnected */
    }
    void ctx.close().catch(() => {});
  };
  return {
    async stop() {
      if (ended) throw new VoiceError("empty");
      const rate = ctx.sampleRate;
      teardown();
      const blob = encodeWav(chunks, rate);
      chunks.length = 0;
      if (blob.size < 2048 || peak < 0.01) throw new VoiceError("silence");
      return new File([blob], "recording.wav", { type: "audio/wav" });
    },
    cancel() {
      if (!ended) teardown();
      chunks.length = 0;
    },
  };
}

export type VoiceErrorKind = "denied" | "unavailable" | "silence" | "empty" | "network" | "failed";
export class VoiceError extends Error {
  constructor(
    public kind: VoiceErrorKind,
    message?: string,
  ) {
    super(message ?? VOICE_MESSAGES[kind]);
  }
}
export const VOICE_MESSAGES: Record<VoiceErrorKind, string> = {
  denied: "Microphone access was blocked. Allow it in your browser settings, or keep typing.",
  unavailable: "No microphone was found on this device. You can keep typing.",
  silence: "No speech was heard. Please try again.",
  empty: "Nothing was recorded. Please try again.",
  network: "Couldn't reach the transcription service. Your text is unchanged.",
  failed: "Transcription failed. Your text is unchanged.",
};

/** Append a transcript to existing text predictably: existing text first, then a space, then the transcript. */
export function appendTranscript(existing: string, transcript: string): string {
  const t = transcript.trim();
  if (!t) return existing;
  if (!existing.trim()) return t;
  return /\s$/.test(existing) ? existing + t : existing + " " + t;
}

export async function transcribe(file: File, token: string, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("file", file, file.name);
  let res: Response;
  try {
    res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: signal ?? null,
    });
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") throw e;
    throw new VoiceError("network");
  }
  const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || !body.text)
    throw new VoiceError(res.status === 422 ? "silence" : "failed", body.error);
  return body.text;
}
