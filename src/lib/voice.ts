/**
 * Realtime AI voice (V3 §64.1/§64.12, Step 48). Pure, browser-safe helpers: audio codec,
 * tool definitions, outcome mapping, instructions and provider routing. No I/O here.
 */
import type { Ack } from "@/lib/calling";
import { STYLE_BOUNDARIES, stylePrompt } from "@/lib/coaching-style";

export type VoiceProvider = "openai" | "gemini";

/** Only the explicit UK country overrides delivery; everyone else keeps the existing voice. */
export function callAccent(billingCountry?: string | null): "en-GB" | null {
  return billingCountry?.trim().toUpperCase() === "GB" ? "en-GB" : null;
}

/** Leads the instructions: the voice model ignores a soft accent note placed at the end (it stayed American). */
export const BRITISH_ACCENT_INSTRUCTION =
  'ACCENT AND VOICE (highest priority): You are a British man from southern England. Speak every word with a clear, natural British English accent (standard Southern British / RP pronunciation): non-rhotic r, British vowels (e.g. "can\'t" with a long ah, "dance", "bath"), British intonation and British vocabulary. Never use an American accent, including on your first reply and your goodbye. Keep a calm, warm, unhurried pace with a relaxed, slightly lower pitch, and do not speed up at the end of sentences.';

export function withCallAccent(instructions: string, billingCountry?: string | null): string {
  if (callAccent(billingCountry) !== "en-GB") return instructions;
  return `${BRITISH_ACCENT_INSTRUCTION}\n${instructions}`;
}

export function isBritishAccent(instructions: string): boolean {
  return instructions.startsWith(BRITISH_ACCENT_INSTRUCTION);
}

/** First turn sent to the live voice; UK calls restate the accent so the very first reply is British too. */
export function beginPrompt(instructions: string): string {
  const uk = isBritishAccent(instructions);
  return /phoning a business/.test(instructions)
    ? `(The business has answered and the greeting has played. ${uk ? "Speaking in your British accent, say" : "Say"} your opening line now.)`
    : `(The person is on the line. ${uk ? "Speaking in your British accent, follow" : "Follow"} your instructions and begin one brief, calm check-in.)`;
}

/** Pauses before reopening a dropped live voice (ms); null = stop retrying and use the backup voice. */
export const GEMINI_RECONNECT_DELAYS_MS = [400, 1200] as const;
export function geminiReconnectDelayMs(retriesSoFar: number): number | null {
  return GEMINI_RECONNECT_DELAYS_MS[retriesSoFar] ?? null;
}

/** Backup voice: UK calls use OpenAI's British-sounding "ballad" so a failover does not switch to an American voice. */
export function backupVoiceName(
  instructions: string,
  configured?: string | null,
  configuredGb?: string | null,
): string {
  if (isBritishAccent(instructions)) return configuredGb || "ballad";
  return configured || "ash";
}

/** Calls respond directly; prerecorded holding speech must not interrupt either call type. */
export function shouldPlayHoldLine(_bookingCall: boolean): boolean {
  return false;
}

/** Primary then fallback (§64.1). Only configured providers are tried. */
export function providerOrder(cfg: { openai: boolean; gemini: boolean }): VoiceProvider[] {
  // Gemini Live is the primary call voice; OpenAI Realtime is the fallback.
  return [cfg.gemini ? "gemini" : null, cfg.openai ? "openai" : null].filter(
    Boolean,
  ) as VoiceProvider[];
}

// ---------- G.711 mu-law <-> PCM16 ----------
const BIAS = 0x84,
  CLIP = 32635;
export function mulawDecodeSample(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80,
    exp = (u >> 4) & 0x07,
    man = u & 0x0f;
  let s = ((man << 3) + BIAS) << exp;
  s -= BIAS;
  return sign ? -s : s;
}
export function mulawEncodeSample(s: number): number {
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; mask >>= 1) exp--;
  const man = (s >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | man) & 0xff;
}
export function mulawToPcm16(u: Uint8Array): Int16Array {
  const out = new Int16Array(u.length);
  for (let i = 0; i < u.length; i++) out[i] = mulawDecodeSample(u[i]!);
  return out;
}
export function pcm16ToMulaw(p: Int16Array): Uint8Array {
  const out = new Uint8Array(p.length);
  for (let i = 0; i < p.length; i++) out[i] = mulawEncodeSample(p[i]!);
  return out;
}
/** Linear resampler (telephony 8 kHz <-> provider 16/24 kHz). */
export function resample(p: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return p;
  const n = Math.max(1, Math.round((p.length * to) / from));
  const out = new Int16Array(n);
  const ratio = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * ratio,
      i0 = Math.floor(x),
      i1 = Math.min(i0 + 1, p.length - 1),
      f = x - i0;
    out[i] = Math.round((p[i0] ?? 0) * (1 - f) + (p[i1] ?? 0) * f);
  }
  return out;
}
export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export function bytesToB64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function pcmToBytes(p: Int16Array): Uint8Array {
  const u = new Uint8Array(p.length * 2);
  const v = new DataView(u.buffer);
  p.forEach((s, i) => v.setInt16(i * 2, s, true));
  return u;
}
export function bytesToPcm(u: Uint8Array): Int16Array {
  const v = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const p = new Int16Array(Math.floor(u.length / 2));
  for (let i = 0; i < p.length; i++) p[i] = v.getInt16(i * 2, true);
  return p;
}
/** Twilio mu-law 8k base64 -> PCM16 16k base64 (Gemini input). */
/** Stateful low-pass + 3:1 decimation (24 kHz -> 8 kHz) that carries filter history across chunks,
 * so streamed speech has no aliasing hiss or clicks at chunk boundaries. */
const LP_TAPS = (() => {
  const n = 47,
    fc = 3400 / 24000,
    t: number[] = [];
  for (let i = 0; i < n; i++) {
    const k = i - (n - 1) / 2;
    const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    t.push(sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1))));
  }
  const sum = t.reduce((a, b) => a + b, 0);
  return t.map((x) => x / sum);
})();
export function createDownsampler24to8() {
  let hist = new Float32Array(LP_TAPS.length - 1);
  let phase = 0;
  return (p: Int16Array): Int16Array => {
    const buf = new Float32Array(hist.length + p.length);
    buf.set(hist);
    for (let i = 0; i < p.length; i++) buf[hist.length + i] = p[i]!;
    const out: number[] = [];
    for (let i = phase; i < p.length; i += 3) {
      let acc = 0;
      for (let k = 0; k < LP_TAPS.length; k++) acc += LP_TAPS[k]! * buf[i + k]!;
      out.push(Math.max(-32768, Math.min(32767, Math.round(acc))));
    }
    phase = (phase + 3 * out.length - p.length + 3 * 1000) % 3;
    hist = buf.slice(buf.length - hist.length);
    return Int16Array.from(out);
  };
}
/** Stateful 8 kHz -> 16 kHz interpolation that joins chunks smoothly. */
export function createUpsampler8to16() {
  let prev = 0;
  return (p: Int16Array): Int16Array => {
    const out = new Int16Array(p.length * 2);
    for (let i = 0; i < p.length; i++) {
      const s = p[i]!;
      out[2 * i] = Math.round((prev + s) / 2);
      out[2 * i + 1] = s;
      prev = s;
    }
    return out;
  };
}
/** Per-call streaming converters (use one pair per call so filter state never mixes between calls). */
export function createVoiceCodec() {
  const down = createDownsampler24to8();
  const up = createUpsampler8to16();
  return {
    toGemini: (b64: string) => bytesToB64(pcmToBytes(up(mulawToPcm16(b64ToBytes(b64))))),
    toTwilio: (b64: string) => bytesToB64(pcm16ToMulaw(down(bytesToPcm(b64ToBytes(b64))))),
  };
}
export function twilioToGemini(b64: string): string {
  return bytesToB64(pcmToBytes(resample(mulawToPcm16(b64ToBytes(b64)), 8000, 16000)));
}
/** Gemini PCM16 24k base64 -> Twilio mu-law 8k base64. */
export function geminiToTwilio(b64: string): string {
  return bytesToB64(pcm16ToMulaw(resample(bytesToPcm(b64ToBytes(b64)), 24000, 8000)));
}

// ---------- backend tool delegation: only the allowed call outcomes (§24/§64.9) ----------
export const VOICE_TOOL_ACK: Record<string, Ack> = {
  start_now: "START_NOW",
  snooze: "SNOOZE",
  reschedule: "RESCHEDULE",
  skip_with_reason: "SKIP_WITH_REASON",
  blocked: "BLOCKED",
  stop_calling_for_this_task: "STOP_CALLING_FOR_THIS_TASK",
  stop_all_calls: "STOP_ALL_CALLS",
};
export type VoiceTool = { name: string; description: string; parameters: Record<string, unknown> };
const reason = {
  type: "object",
  properties: {
    reason: {
      type: "string",
      description: "Short reason in the user's words, max 120 characters.",
    },
  },
  required: [],
};
const none = { type: "object", properties: {}, required: [] };
export const VOICE_TOOLS: VoiceTool[] = [
  {
    name: "start_now",
    description: "The user says they are starting the session now.",
    parameters: none,
  },
  { name: "snooze", description: "The user wants a 10 minute snooze.", parameters: none },
  {
    name: "reschedule",
    description:
      "The user wants to move the session to another time. They will pick the time in the app.",
    parameters: reason,
  },
  {
    name: "skip_with_reason",
    description: "The user is skipping this session and gives a reason.",
    parameters: reason,
  },
  {
    name: "blocked",
    description: "Something is stopping the user doing the session.",
    parameters: reason,
  },
  {
    name: "stop_calling_for_this_task",
    description: "The user wants no more calls about this session.",
    parameters: none,
  },
  {
    name: "stop_all_calls",
    description: "The user wants all calls to stop. Call immediately, no confirmation.",
    parameters: none,
  },
  {
    name: "safety_concern",
    description:
      "The user mentions pain, injury, feeling unwell, crisis or danger. Call immediately.",
    parameters: reason,
  },
  {
    name: "end_call",
    description: "The conversation is finished with no choice made.",
    parameters: none,
  },
];
export function toolResult(name: string): { ack: Ack | null; end: boolean; safety: boolean } {
  if (name === "safety_concern") return { ack: null, end: true, safety: true };
  if (name === "end_call") return { ack: null, end: true, safety: false };
  const ack = VOICE_TOOL_ACK[name] ?? null;
  return { ack, end: !!ack, safety: false };
}
export function cleanReason(args: unknown): string | null {
  const r = (args as { reason?: unknown } | null)?.reason;
  return typeof r === "string" && r.trim() ? r.trim().slice(0, 120) : null;
}

/** System instructions. The AI disclosure and account-holder check already happened on the keypad (§64.3/§64.4). */
export function voiceInstructions(i: {
  title: string | null;
  reason?: string | null;
  trigger: string;
  style: string | null | undefined;
  maxMinutes: number;
  firstName?: string | null;
  localTime?: string | null;
  upcoming?: string | null;
  billingCountry?: string | null;
}): string {
  const task = i.title
    ? `The scheduled session is "${i.title}" (${i.trigger === "missed" ? "it was missed" : "it is due now"}).`
    : i.reason
      ? `The user asked for this call as a reminder about: "${i.reason}". Your first sentence after the opening must remind them of exactly this (for example "This is your reminder to ${i.reason.charAt(0).toLowerCase()}${i.reason.slice(1)}."), then ask if they've done it or need anything.`
      : "This is the check-in the user asked for about today's plan.";
  return withCallAccent(
    [
      'You are Plexecute\'s automated AI accountability coach on a phone call. You are an AI, never claim to be human. The user has just heard "This is a call from Plexecute." You speak first; the member may say hello at the same time.',
      task,
      ...(i.firstName
        ? [
            `The member's first name is ${JSON.stringify(i.firstName)}. Use it naturally once, not in every reply.`,
          ]
        : []),
      ...(i.localTime
        ? [`The member's local time is ${i.localTime}. Do not invent their routine.`]
        : []),
      ...(i.upcoming
        ? [
            `Next saved commitment: ${JSON.stringify(i.upcoming)}. Mention only if relevant to this check-in.`,
          ]
        : []),
      `Keep the whole call under ${i.maxMinutes} minute${i.maxMinutes === 1 ? "" : "s"}. Keep it brief by saying less, never by speaking faster. Stop talking at once if the user interrupts.`,
      "You sound like Plexecute Coach: professional, confident, calm, warm and quietly motivating, not a customer-service bot. Use a warm, natural conversational voice at a calm, unhurried pace. Keep each thought together; never pause halfway through a short sentence. Ask one short question at a time, then listen and give the user room to finish. Use contractions, brief acknowledgements and ordinary spoken English, not paragraphs or spoken lists. Avoid Certainly!, exaggerated enthusiasm, scripted menus and repeating their words mechanically.",
      "Backchannel policy: a brief 'Right' or 'Okay' is enough when useful; do not echo every answer. Interruption policy: stop your main answer when interrupted, listen, then address what they actually said. Do not mistake background noise for a request. Delegation policy: backend tools save the member's chosen outcome; announce it only after the result. Once recorded, close warmly in one short sentence relevant to the call, then listen for their goodbye. Do not offer another menu or disconnect yourself.",
      'The opening already said this is Plexecute. Do not repeat the introduction or ask who they are. Answer their hello warmly in a few words (for example "Hi, it\'s Coach.") and go straight into a brief check-in relevant to the scheduled session or requested reminder, or ask how they are getting on if there is no named session. Never invent task details.',
      "Your only job: help the user choose one outcome, then call exactly one matching tool: start_now, snooze, reschedule, skip_with_reason, blocked, stop_calling_for_this_task or stop_all_calls. Never change the plan any other way. Never guess a choice the user did not make.",
      "If the user mentions pain, injury, feeling unwell, self-harm, crisis or danger, call safety_concern immediately and say nothing else about training or food.",
      "Never give medical, diet or training advice on the call. Never mention prices, upgrades or other products.",
      stylePrompt(i.style),
      STYLE_BOUNDARIES,
    ].join("\n"),
    i.billingCountry,
  );
}

export const DEGRADED_LINE = "Voice coaching is temporarily unavailable, so let's use your keypad.";
export const SAFETY_END_LINE = "I'll stop the check-in here. Calls are paused for now.";
