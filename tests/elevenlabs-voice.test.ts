import { describe, it, expect, vi, afterEach } from "vitest";
import { elevenVoiceId, elevenStreamUrl } from "@/lib/elevenlabs-voice";
import { createElevenSpeaker } from "@/lib/elevenlabs-voice.server";
import { isGoodbye, isSimpleSignoff, VoiceClosing } from "@/lib/voice-closing";
import { ttsCostUsd } from "@/lib/spend";
import { withCallAccent, isBritishAccent } from "@/lib/voice";

const ids = { gb: "UK_VOICE", us: "US_VOICE" };

describe("ElevenLabs voice choice", () => {
  it("UK calls use the UK voice", () => {
    const uk = withCallAccent("Coach call", "GB");
    expect(elevenVoiceId(isBritishAccent(uk), ids)).toBe("UK_VOICE");
  });
  it("US calls use the US voice", () => {
    const us = withCallAccent("Coach call", "US");
    expect(elevenVoiceId(isBritishAccent(us), ids)).toBe("US_VOICE");
  });
  it("no configured voice means the existing voice is used", () => {
    expect(elevenVoiceId(true, { gb: "", us: "US_VOICE" })).toBeNull();
  });
  it("streams phone-ready mu-law 8 kHz audio", () => {
    expect(elevenStreamUrl("UK_VOICE")).toContain("output_format=ulaw_8000");
  });
});

describe("ElevenLabs usage enters the shared allowance", () => {
  it("costs are counted per character spoken", () => {
    expect(ttsCostUsd(1000)).toBeCloseTo(0.1);
    expect(ttsCostUsd(0)).toBe(0);
  });
});

describe("one goodbye per call", () => {
  it("recognises farewells", () => {
    expect(isGoodbye("Great, speak soon. Bye!")).toBe(true);
    expect(isGoodbye("Okay, what time suits you?")).toBe(false);
  });
  it("a plain thanks/bye does not reopen the call; a new question does", () => {
    expect(isSimpleSignoff("Okay thanks, bye")).toBe(true);
    expect(isSimpleSignoff("Cheers")).toBe(true);
    expect(isSimpleSignoff("Actually can you move my workout to 7?")).toBe(false);
  });
  it("a goodbye already spoken ends after its playback mark, not after a second goodbye", () => {
    const c = new VoiceClosing();
    c.close(1);
    c.goodbyeAlreadySpoken();
    expect(c.completed()).toBe(true);
    c.played(1000);
    expect(c.shouldEnd(2500)).toBe(false);
    expect(c.shouldEnd(3100)).toBe(true);
  });
  it("reopening clears the closing", () => {
    const c = new VoiceClosing();
    c.close(0);
    c.reopen();
    expect(c.phase).toBe("DISCUSSION");
    expect(c.shouldEnd(60_000)).toBe(false);
  });
});

type L = (e: any) => void;
function fakeSocket() {
  const ls: Record<string, L[]> = {};
  const sent: any[] = [];
  return {
    sent,
    ws: {
      accept() {},
      send: (d: string) => sent.push(JSON.parse(d)),
      close() {},
      addEventListener: (t: string, f: L) => (ls[t] ??= []).push(f),
    },
    emit: (t: string, e: any) => (ls[t] ?? []).forEach((f) => f(e)),
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("ElevenLabs speaks Gemini's words, with fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("voices Gemini's text with ElevenLabs and drops Gemini's own audio", async () => {
    const socks: ReturnType<typeof fakeSocket>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const s = fakeSocket();
        socks.push(s);
        return { status: 101, webSocket: s.ws };
      }),
    );
    const sp = createElevenSpeaker({ apiKey: "k", voiceId: "UK_VOICE", bookingCall: false });
    const out: string[] = [];
    let done = 0;
    const h = sp.wrap({
      onAudio: (b: string) => out.push(b),
      onInterrupt() {},
      onTurnComplete: () => done++,
    });
    h.onAudio("R0VNSU5J"); // Gemini audio: held, not played
    h.onSpoken!("Okay, got it. ");
    h.onTurnComplete!();
    await tick();
    await tick();
    const s = socks[0]!;
    // Gemini decides the words; ElevenLabs only receives them.
    expect(s.sent.map((m) => m.text).join("")).toContain("Okay, got it.");
    s.emit("message", { data: JSON.stringify({ audio: "RUxFVkVO" }) });
    s.emit("message", { data: JSON.stringify({ isFinal: true }) });
    expect(out).toEqual(["RUxFVkVO"]);
    expect(done).toBe(1);
    expect(sp.characters()).toBeGreaterThan(0);
    sp.close();
  });

  it("falls back to the existing voice when ElevenLabs is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    const sp = createElevenSpeaker({ apiKey: "k", voiceId: "US_VOICE", bookingCall: false });
    const out: string[] = [];
    let done = 0;
    const h = sp.wrap({
      onAudio: (b: string) => out.push(b),
      onInterrupt() {},
      onTurnComplete: () => done++,
    });
    h.onAudio("R0VNSU5J");
    h.onSpoken!("Hello there ");
    await tick();
    await tick();
    expect(out).toEqual(["R0VNSU5J"]);
    expect(sp.active()).toBe(false);
    h.onAudio("TkVYVA==");
    expect(out).toEqual(["R0VNSU5J", "TkVYVA=="]);
    h.onTurnComplete!();
    expect(done).toBeGreaterThanOrEqual(1);
  });

  it("releases held Gemini audio within 1500ms when speech never arrives", async () => {
    vi.useFakeTimers();
    const s = fakeSocket();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 101, webSocket: s.ws })),
    );
    const sp = createElevenSpeaker({ apiKey: "k", voiceId: "UK_VOICE", bookingCall: true });
    const audio = vi.fn();
    const complete = vi.fn();
    const h = sp.wrap({ onAudio: audio, onInterrupt() {}, onTurnComplete: complete });
    h.onAudio("R0VNSU5J");
    h.onSpoken?.("Could I book a table tonight? ");
    h.onTurnComplete?.();
    await vi.advanceTimersByTimeAsync(1499);
    expect(audio).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(audio).toHaveBeenCalledExactlyOnceWith("R0VNSU5J");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(sp.active()).toBe(false);
    sp.close();
  });

  it("completes a voiced turn without isFinal and ignores late events from it", async () => {
    vi.useFakeTimers();
    const socks: ReturnType<typeof fakeSocket>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const s = fakeSocket();
        socks.push(s);
        return { status: 101, webSocket: s.ws };
      }),
    );
    const sp = createElevenSpeaker({ apiKey: "k", voiceId: "UK_VOICE", bookingCall: true });
    const audio = vi.fn();
    const complete = vi.fn();
    const h = sp.wrap({ onAudio: audio, onInterrupt() {}, onTurnComplete: complete });
    h.onSpoken?.("Thank you. ");
    h.onTurnComplete?.();
    await vi.advanceTimersByTimeAsync(0);
    const first = socks[0];
    if (!first) throw new Error("Missing first socket");
    first.emit("message", { data: JSON.stringify({ audio: "RUxFVkVO" }) });
    await vi.advanceTimersByTimeAsync(1500);
    expect(complete).toHaveBeenCalledTimes(1);
    h.onSpoken?.("Goodbye. ");
    h.onTurnComplete?.();
    await vi.advanceTimersByTimeAsync(0);
    first.emit("message", { data: JSON.stringify({ isFinal: true, audio: "TEFURQ==" }) });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(audio).toHaveBeenCalledTimes(1);
    const second = socks[1];
    if (!second) throw new Error("Missing second socket");
    second.emit("message", { data: JSON.stringify({ audio: "QllF", isFinal: true }) });
    expect(complete).toHaveBeenCalledTimes(2);
    sp.close();
  });
});

describe("natural speech and a plain goodbye", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("never voices 'anything else I can help with' on member calls", async () => {
    const { isAnythingElseQuestion } = await import("@/lib/elevenlabs-voice");
    expect(isAnythingElseQuestion("Is there anything else I can help you with?")).toBe(true);
    expect(isAnythingElseQuestion("Okay, speak soon. Bye.")).toBe(false);
  });
  it("sends whole sentences, not word by word, and drops the extra question", async () => {
    const socks: ReturnType<typeof fakeSocket>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const s = fakeSocket();
        socks.push(s);
        return { status: 101, webSocket: s.ws };
      }),
    );
    const { isAnythingElseQuestion } = await import("@/lib/elevenlabs-voice");
    const sp = createElevenSpeaker({
      apiKey: "k",
      voiceId: "UK_VOICE",
      bookingCall: false,
      dropSentence: isAnythingElseQuestion,
    });
    const h = sp.wrap({ onAudio() {}, onInterrupt() {}, onTurnComplete() {} });
    for (const w of [
      "Great ",
      "work ",
      "today. ",
      "Is ",
      "there ",
      "anything ",
      "else ",
      "I ",
      "can ",
      "help ",
      "you ",
      "with? ",
      "Bye.",
    ])
      h.onSpoken!(w);
    h.onTurnComplete!();
    await tick();
    await tick();
    const texts = socks.flatMap((s) => s.sent.map((m) => m.text)).filter((t) => t && t.trim());
    expect(texts).toEqual(["Great work today. ", "Bye. "]);
    sp.close();
  });
});
