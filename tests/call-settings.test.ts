import { describe, it, expect } from "vitest";
import {
  kindAllowed,
  callTimeLimitSec,
  voicemailMessage,
  styleLine,
  VOICEMAIL_GENERIC,
  CALL_STYLE_LINE,
} from "@/lib/calling";
import { styleViolations } from "@/lib/coaching-style";

describe("Step 47 call settings", () => {
  it("task types: empty/null allows all, otherwise only listed kinds", () => {
    expect(kindAllowed(null, "workout")).toBe(true);
    expect(kindAllowed([], "study")).toBe(true);
    expect(kindAllowed(["study"], "study")).toBe(true);
    expect(kindAllowed(["study"], "workout")).toBe(false);
    expect(kindAllowed(["study"], null)).toBe(false);
  });
  it("conversation length is capped by user choice, allowance and 15 min", () => {
    expect(callTimeLimitSec(3, 9999)).toBe(180);
    expect(callTimeLimitSec(10, 9999)).toBe(600);
    expect(callTimeLimitSec(10, 100)).toBe(100);
    expect(callTimeLimitSec(99, 9999)).toBe(600);
    expect(callTimeLimitSec(null, 9999)).toBe(180);
    expect(callTimeLimitSec(1, 0)).toBe(0);
  });
  it("voicemail: silent by default, generic message has AI disclosure and no task detail", () => {
    expect(voicemailMessage("none")).toBeNull();
    expect(voicemailMessage(undefined)).toBeNull();
    expect(voicemailMessage("generic")).toBe(VOICEMAIL_GENERIC);
    expect(VOICEMAIL_GENERIC).toMatch(/automated AI/);
  });
  it("style lines are safe and fall back to supportive", () => {
    for (const l of Object.values(CALL_STYLE_LINE)) expect(styleViolations(l)).toEqual([]);
    expect(styleLine("nonsense")).toBe(CALL_STYLE_LINE["supportive"]);
    expect(styleLine("direct")).toBe("Quick one.");
  });
});
