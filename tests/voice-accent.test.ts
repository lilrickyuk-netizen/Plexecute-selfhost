import { describe, expect, it } from "vitest";
import {
  BRITISH_ACCENT_INSTRUCTION,
  backupVoiceName,
  geminiReconnectDelayMs,
  beginPrompt,
  callAccent,
  isBritishAccent,
  shouldPlayHoldLine,
  voiceInstructions,
  withCallAccent,
} from "@/lib/voice";

describe("member country call accent", () => {
  it("selects British English for UK members", () => {
    expect(callAccent("GB")).toBe("en-GB");
    expect(callAccent(" gb ")).toBe("en-GB");
  });
  it("does not override the existing American voice for US members", () => {
    expect(callAccent("US")).toBeNull();
    const input = { title: null, trigger: "due", style: null, maxMinutes: 3 };
    expect(voiceInstructions({ ...input, billingCountry: "US" })).toBe(voiceInstructions(input));
    expect(withCallAccent("existing business instructions", "US")).toBe(
      "existing business instructions",
    );
  });
  it("does not infer a UK accent when country is absent or another country", () => {
    for (const country of [null, undefined, "", "CA", "AU"]) expect(callAccent(country)).toBeNull();
  });
});

describe("UK call voice delivery", () => {
  it("puts the British accent first so the voice model actually follows it", () => {
    const out = withCallAccent("existing instructions", "GB");
    expect(out.startsWith(BRITISH_ACCENT_INSTRUCTION)).toBe(true);
    expect(isBritishAccent(out)).toBe(true);
    expect(isBritishAccent("existing instructions")).toBe(false);
  });
  it("restates the British accent on the first turn only for UK calls", () => {
    expect(beginPrompt(withCallAccent("check-in", "GB"))).toContain("British accent");
    expect(beginPrompt("check-in")).not.toContain("British");
  });
  it("never plays the prerecorded holding line on member or booking calls", () => {
    expect(shouldPlayHoldLine(false)).toBe(false);
    expect(shouldPlayHoldLine(true)).toBe(false);
  });
});

describe("dropped voice recovery", () => {
  it("reopens the main voice twice with a pause before using the backup", () => {
    expect(geminiReconnectDelayMs(0)).toBe(400);
    expect(geminiReconnectDelayMs(1)).toBe(1200);
    expect(geminiReconnectDelayMs(2)).toBeNull();
  });
  it("keeps UK members on a British-sounding backup voice and US members on the existing one", () => {
    expect(backupVoiceName(withCallAccent("x", "GB"))).toBe("ballad");
    expect(backupVoiceName("x")).toBe("ash");
    expect(backupVoiceName("x", "verse")).toBe("verse");
  });
});
