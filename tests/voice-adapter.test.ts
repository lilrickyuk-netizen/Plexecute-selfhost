import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/integrations.server", () => ({
  env: (name: string) => (name === "GEMINI_LIVE_MODEL" ? "existing-model" : "test-key"),
}));
import { connectGemini, connectOpenAI, frameIsSpeech } from "@/lib/voice.server";
import { OPENING_MS, OPENING_TEXT, OPENING_ULAW_B64 } from "@/lib/call-opening-audio.server";
import { DISCLOSURE, CONFIRM_PROMPT } from "@/lib/calling";

afterEach(() => vi.unstubAllGlobals());

describe("live call audio transport", () => {
  it("protects booking replies from background barge-in without changing member calls", async () => {
    const sent: Record<string, any>[] = [];
    const ws = {
      accept: vi.fn(),
      close: vi.fn(),
      send: (s: string) => sent.push(JSON.parse(s)),
      addEventListener: vi.fn(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ webSocket: ws }));
    const h = {
      onAudio: vi.fn(),
      onInterrupt: vi.fn(),
      onTool: vi.fn(),
      onTranscript: vi.fn(),
      onClose: vi.fn(),
    };
    const booking = await connectGemini("booking", h, [], undefined, true);
    expect(sent[0]?.setup.realtimeInputConfig.activityHandling).toBe("NO_INTERRUPTION");
    expect(
      sent[0]?.setup.realtimeInputConfig.automaticActivityDetection.startOfSpeechSensitivity,
    ).toBe("START_SENSITIVITY_LOW");
    expect(sent[0]?.setup.realtimeInputConfig.automaticActivityDetection.silenceDurationMs).toBe(
      300,
    );
    booking.close();
    const member = await connectGemini("member", h);
    expect(sent[1]?.setup.realtimeInputConfig).not.toHaveProperty("activityHandling");
    expect(
      sent[1]?.setup.realtimeInputConfig.automaticActivityDetection.startOfSpeechSensitivity,
    ).toBe("START_SENSITIVITY_HIGH");
    member.close();
    const backup = await connectOpenAI("booking", h, [], undefined, true);
    expect(sent[2]?.session.audio.input.turn_detection.interrupt_response).toBe(false);
    expect(sent[2]?.session.audio.input.turn_detection.threshold).toBe(0.7);
    expect(sent[2]?.session.audio.input.noise_reduction.type).toBe("near_field");
    backup.close();
  });
  it("configures the backup voice inside audio.output, as required by the realtime API", async () => {
    const sent: Record<string, any>[] = [];
    const ws = {
      accept: vi.fn(),
      close: vi.fn(),
      send: (text: string) => sent.push(JSON.parse(text)),
      addEventListener: vi.fn(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ webSocket: ws }));
    const adapter = await connectOpenAI("instructions", {
      onAudio: vi.fn(),
      onInterrupt: vi.fn(),
      onTool: vi.fn(),
      onTranscript: vi.fn(),
      onClose: vi.fn(),
    });
    expect(sent[0]?.session).not.toHaveProperty("voice");
    expect(sent[0]?.session.audio.output.voice).toBe("test-key");
    expect(sent[0]?.session.audio.output.format.type).toBe("audio/pcmu");
    adapter.close();
  });
  it("waits for setup, preserves the model and processes delayed audio in order", async () => {
    const sent: Record<string, any>[] = [];
    const listeners = new Map<string, (event: any) => void>();
    const ws = {
      accept: vi.fn(),
      close: vi.fn(),
      send: (text: string) => sent.push(JSON.parse(text)),
      addEventListener: (name: string, callback: (event: any) => void) =>
        listeners.set(name, callback),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ webSocket: ws }));
    const events: string[] = [];
    const h = {
      onAudio: () => events.push("audio"),
      onInterrupt: () => events.push("interrupt"),
      canInterrupt: vi.fn(() => true),
      onTool: vi.fn(),
      onTranscript: vi.fn(),
      onClose: vi.fn(),
      onTurnComplete: () => events.push("complete"),
    };
    const adapter = await connectGemini("calm instructions", h);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.setup.model).toBe("models/existing-model");
    expect(sent[0]?.setup.realtimeInputConfig.automaticActivityDetection.silenceDurationMs).toBe(
      300,
    );
    adapter.sendAudio("/w==");
    expect(sent).toHaveLength(1);
    const message = listeners.get("message");
    if (!message) throw new Error("No message listener");
    adapter.begin();
    expect(sent).toHaveLength(1);
    message({ data: JSON.stringify({ setupComplete: {} }) });
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[1]?.realtimeInput.audio.mimeType).toBe("audio/pcm;rate=16000");
    expect(sent[2]?.clientContent.turnComplete).toBe(true);
    adapter.sendAudio("/w==");
    expect(sent[3]?.realtimeInput.audio.mimeType).toBe("audio/pcm;rate=16000");
    let resolve: ((buffer: ArrayBuffer) => void) | undefined;
    const delayed = new Promise<ArrayBuffer>((r) => {
      resolve = r;
    });
    message({ data: { arrayBuffer: () => delayed } });
    message({ data: JSON.stringify({ serverContent: { interrupted: true } }) });
    await Promise.resolve();
    expect(events).toEqual([]);
    if (!resolve) throw new Error("Missing delayed audio resolver");
    resolve(
      new TextEncoder().encode(
        JSON.stringify({
          serverContent: {
            modelTurn: { parts: [{ inlineData: { data: "AAA=" } }] },
          },
        }),
      ).buffer,
    );
    await vi.waitFor(() => expect(events).toEqual(["audio", "interrupt"]));
    message({ data: JSON.stringify({ serverContent: { turnComplete: true } }) });
    await vi.waitFor(() => expect(events).toEqual(["audio", "interrupt", "complete"]));
    h.canInterrupt.mockReturnValue(false); // saved booking is now playing its goodbye
    message({ data: JSON.stringify({ serverContent: { interrupted: true } }) });
    message({ data: JSON.stringify({ serverContent: { turnComplete: true } }) });
    await vi.waitFor(() => expect(events).toEqual(["audio", "interrupt", "complete", "complete"]));
    adapter.close();
    adapter.sendAudio("/w==");
    expect(sent).toHaveLength(4);
  });
});
describe("call opening", () => {
  it("plays the owner's opening wording as a short clip", () => {
    expect(OPENING_TEXT).toBe(DISCLOSURE);
    expect(OPENING_TEXT).not.toMatch(/say hello/i);
    expect(OPENING_MS).toBeGreaterThan(1000);
    expect(OPENING_MS).toBeLessThan(5000);
    expect(atob(OPENING_ULAW_B64).length).toBe(OPENING_MS * 8);
  });
  it("tells speech from silence on a phone frame", () => {
    const silence = btoa(String.fromCharCode(...new Array(160).fill(0xff)));
    const loud = btoa(String.fromCharCode(...new Array(160).fill(0x10)));
    expect(frameIsSpeech(silence)).toBe(false);
    expect(frameIsSpeech(loud)).toBe(true);
  });
});
