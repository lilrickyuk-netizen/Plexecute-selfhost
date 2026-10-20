import { describe, it, expect } from "vitest";
import {
  mulawEncodeSample,
  mulawDecodeSample,
  resample,
  twilioToGemini,
  geminiToTwilio,
  bytesToB64,
  b64ToBytes,
  providerOrder,
  toolResult,
  VOICE_TOOLS,
  voiceInstructions,
  cleanReason,
} from "@/lib/voice";
import { ACK_LABEL } from "@/lib/calling";

describe("Step 48 realtime voice", () => {
  it("mu-law round trip stays within codec error", () => {
    for (const s of [0, 100, -100, 1000, -5000, 20000, -32000])
      expect(Math.abs(mulawDecodeSample(mulawEncodeSample(s)) - s)).toBeLessThanOrEqual(
        Math.max(16, Math.abs(s) * 0.04),
      );
  });
  it("resamples telephony rates", () => {
    expect(resample(new Int16Array(160), 8000, 16000).length).toBe(320);
    expect(resample(new Int16Array(480), 24000, 8000).length).toBe(160);
    expect(b64ToBytes(twilioToGemini(bytesToB64(new Uint8Array(160).fill(0xff)))).length).toBe(640);
    expect(b64ToBytes(geminiToTwilio(bytesToB64(new Uint8Array(960)))).length).toBe(160);
  });
  it("routes Gemini first, OpenAI as fallback, only when configured", () => {
    expect(providerOrder({ openai: true, gemini: true })).toEqual(["gemini", "openai"]);
    expect(providerOrder({ openai: false, gemini: true })).toEqual(["gemini"]);
    expect(providerOrder({ openai: false, gemini: false })).toEqual([]);
  });
  it("tools map only to allowed outcomes; safety and end close the call", () => {
    const acks = VOICE_TOOLS.map((t) => toolResult(t.name).ack).filter(Boolean);
    for (const a of acks) expect(Object.keys(ACK_LABEL)).toContain(a);
    expect(toolResult("stop_all_calls")).toEqual({
      ack: "STOP_ALL_CALLS",
      end: true,
      safety: false,
    });
    expect(toolResult("safety_concern")).toEqual({ ack: null, end: true, safety: true });
    expect(toolResult("delete_plan").ack).toBeNull();
    expect(cleanReason({ reason: "x".repeat(300) })!.length).toBe(120);
  });
  it("instructions disclose AI, cap length, forbid sales and advice", () => {
    const t = voiceInstructions({
      title: "Leg day",
      trigger: "due",
      style: "direct",
      maxMinutes: 3,
    });
    expect(t).toMatch(/AI, never claim to be human/);
    expect(t).toMatch(/under 3 minutes/);
    expect(t).toMatch(/Never mention prices, upgrades/);
    expect(t).toMatch(/Leg day/);
    expect(t).toMatch(/never by speaking faster/);
    expect(t).toMatch(/one short question at a time/);
    expect(t).toMatch(/Do not repeat the introduction or ask who they are/);
  });
});

import { voiceInstructions as vi2 } from "../src/lib/voice";
describe("requested reminder calls", () => {
  it("names the reason the member booked the call", () => {
    const t = vi2({
      title: null,
      reason: "Check the oven",
      trigger: "scheduled",
      style: null,
      maxMinutes: 3,
    });
    expect(t).toContain('reminder about: "Check the oven"');
    expect(t).toContain("This is your reminder to check the oven.");
  });
});
