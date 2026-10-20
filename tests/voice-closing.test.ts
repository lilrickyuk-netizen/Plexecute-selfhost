import { describe, expect, it } from "vitest";
import { VoiceClosing, acceptsCallAudio } from "../src/lib/voice-closing";

describe("natural phone closing", () => {
  it("busy restaurant audio cannot interrupt the saved booking's farewell or delay hang-up", () => {
    const c = new VoiceClosing();
    c.request();
    expect(acceptsCallAudio(true, c.phase)).toBe(true);
    c.close(1000);
    expect(acceptsCallAudio(true, c.phase)).toBe(false);
    c.audio();
    expect(c.completed()).toBe(true);
    c.played(3000);
    for (let now = 3100; now <= 5000; now += 100) {
      if (acceptsCallAudio(true, c.phase)) c.heard(now);
    }
    expect(c.shouldEnd(4999)).toBe(false);
    expect(c.shouldEnd(5000)).toBe(true);
    expect(acceptsCallAudio(false, "CLOSING")).toBe(true);
    expect(acceptsCallAudio(false, "WAIT_FOR_OTHER_PERSON")).toBe(true);
  });
  it("does not hang up four seconds after saving while farewell is still playing", () => {
    const c = new VoiceClosing();
    c.close(1000);
    c.audio();
    expect(c.shouldEnd(5000)).toBe(false);
    expect(c.completed()).toBe(true);
    expect(c.shouldEnd(6000)).toBe(false);
    c.played(6500);
    expect(c.shouldEnd(8499)).toBe(false);
    expect(c.shouldEnd(8500)).toBe(true);
  });
  it("gives the other person room to finish their acknowledgement", () => {
    const c = new VoiceClosing();
    c.close(1000);
    c.audio();
    c.completed();
    c.played(3000);
    c.heard(4500);
    expect(c.shouldEnd(5000)).toBe(false);
    expect(c.shouldEnd(6500)).toBe(true);
  });
  it("does not count cleared audio as a played goodbye", () => {
    const c = new VoiceClosing();
    c.close(1000);
    c.audio();
    c.interrupted();
    expect(c.completed()).toBe(false);
    expect(c.shouldEnd(8000)).toBe(false);
    c.audio();
    expect(c.completed()).toBe(true);
    c.played(9000);
    expect(c.shouldEnd(11000)).toBe(true);
  });
  it("ends after 4s when no goodbye audio ever starts, without claiming it played", () => {
    const c = new VoiceClosing();
    c.close(1000);
    expect(c.shouldEnd(4999)).toBe(false);
    expect(c.shouldEnd(5000)).toBe(true);
    expect(c.phase).toBe("CLOSING");
  });
  it("bounds a started but unacknowledged farewell at 15s", () => {
    const c = new VoiceClosing();
    c.close(1000);
    c.audio();
    expect(c.shouldEnd(15999)).toBe(false);
    expect(c.shouldEnd(16000)).toBe(true);
  });
});
