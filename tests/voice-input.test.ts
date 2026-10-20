import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { appendTranscript, encodeWav } from "../src/lib/voice-input";
import { SECURITY_HEADERS } from "../src/lib/security";

describe("voice input", () => {
  it("appends transcripts without overwriting typed text", () => {
    expect(appendTranscript("", " hello ")).toBe("hello");
    expect(appendTranscript("I want", "to run")).toBe("I want to run");
    expect(appendTranscript("I want ", "to run")).toBe("I want to run");
    expect(appendTranscript("kept", "   ")).toBe("kept");
  });
  it("encodes a valid WAV header", async () => {
    const b = encodeWav([new Float32Array(100)], 16000);
    const v = new DataView(await b.arrayBuffer());
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe(
      "RIFF",
    );
    expect(b.size).toBe(44 + 200);
  });
  it("allows the microphone on our own origin only", () => {
    expect(SECURITY_HEADERS["Permissions-Policy"]).toContain("microphone=(self)");
  });
  it("transcription route stores no audio, records usage and never submits", () => {
    const src = readFileSync("src/routes/api/transcribe.ts", "utf8");
    expect(src).toContain("recordUsage");
    expect(src).not.toMatch(/storage|\.insert\(/);
    const btn = readFileSync("src/components/VoiceInputButton.tsx", "utf8");
    expect(btn).not.toMatch(/submit\(|requestSubmit/);
  });
});

describe("voice input coverage per screen", () => {
  const SCREENS: Record<string, number> = {
    "src/routes/_authenticated/onboarding.tsx": 1,
    "src/routes/_authenticated/app.coach.tsx": 1,
    "src/components/GoalEditor.tsx": 2,
    "src/routes/_authenticated/app.goals.$id.tsx": 5,
    "src/components/BehaviourPlan.tsx": 3,
    "src/components/RepairDay.tsx": 1,
    "src/components/BlockRow.tsx": 1,
    "src/routes/_authenticated/app.learning.tsx": 1,
    "src/routes/_authenticated/app.nutrition.tsx": 1,
    "src/routes/_authenticated/app.wellness.tsx": 1,
    "src/components/RecoveryPanel.tsx": 1,
    "src/routes/_authenticated/app.experiments.tsx": 3,
    "src/components/MovementPanel.tsx": 1,
    "src/components/SupportPanel.tsx": 1,
    "src/components/CancelReason.tsx": 1,
  };
  for (const [file, n] of Object.entries(SCREENS))
    it(`${file} keeps ${n} microphone(s) feeding the same field`, () => {
      const src = readFileSync(file, "utf8");
      const count = (src.match(/<WithVoice\b|<VoiceInputButton\b/g) ?? []).length;
      expect(count).toBeGreaterThanOrEqual(n);
      expect(src).not.toMatch(/transcribe\(/); // no separate voice submit path
    });
});
