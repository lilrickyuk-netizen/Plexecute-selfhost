import { describe, expect, it } from "vitest";
import {
  COACH_CALL_DEADLINE_MS,
  PLATFORM_REQUEST_LIMIT_MS,
  RESEARCH_READ_DEADLINE_MS,
  msLeft,
  progressStream,
  researchRetryAllowed,
  stageFor,
  turnPhase,
} from "@/lib/coach-turn-budget";

describe("Coach turn always replies inside the live site's 2-minute request limit", () => {
  it("every deadline lands before the 2-minute limit", () => {
    expect(PLATFORM_REQUEST_LIMIT_MS).toBe(120_000);
    expect(RESEARCH_READ_DEADLINE_MS).toBeLessThan(COACH_CALL_DEADLINE_MS);
    expect(COACH_CALL_DEADLINE_MS).toBeLessThan(PLATFORM_REQUEST_LIMIT_MS);
  });
  it("research may start in the first 40 seconds, then Coach writes its reply by 85 seconds", () => {
    expect(turnPhase(39_999)).toEqual({ mustReply: false, researchAllowed: true });
    expect(turnPhase(40_000).researchAllowed).toBe(false);
    expect(turnPhase(84_999).mustReply).toBe(false);
    expect(turnPhase(85_000).mustReply).toBe(true);
  });
  it("the research second pass only starts when it can still finish", () => {
    const start = 1_000_000;
    expect(researchRetryAllowed(start, start + 49_000, false)).toBe(true);
    expect(researchRetryAllowed(start, start + 71_000, false)).toBe(false);
    expect(researchRetryAllowed(undefined, Date.now(), false)).toBe(true);
    expect(researchRetryAllowed(start, start + 55_000, true)).toBe(true);
    expect(researchRetryAllowed(start, start + 71_000, true)).toBe(false);
  });
  it("time left counts down to the deadline and is unlimited outside chat", () => {
    expect(msLeft(0, 95_000, 30_000)).toBe(65_000);
    expect(msLeft(0, 95_000, 200_000)).toBe(1_000);
    expect(msLeft(undefined, 95_000)).toBeUndefined();
  });
});

describe("Coach live progress", () => {
  it("names what Coach is doing in plain words", () => {
    expect(stageFor(["research_topic"])).toBe("Checking current sources online");
    expect(stageFor(["get_goals", "get_plan"])).toBe("Reading your plan and history");
    expect(stageFor(["request_replan"])).toBe("Putting it on your plan");
  });
  it("streams progress while working, then the final reply", async () => {
    let finish!: (v: string) => void;
    const run = new Promise<string>((r) => (finish = r));
    const reader = progressStream(run, () => "Checking current sources online", 5).getReader();
    const first = await reader.read();
    expect(first.value).toMatchObject({
      type: "progress",
      stage: "Checking current sources online",
    });
    setTimeout(() => finish("done"), 20);
    const events: unknown[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      events.push(value);
    }
    expect(events.at(-1)).toEqual({ type: "result", result: "done" });
  });
});

import { dropRepeatedDraft } from "@/lib/coaching-style";
describe("Coach never sends the same answer twice", () => {
  const v1 =
    "Find your local NHS stop smoking service first; free support is available, but whether a nearby pharmacy offers it depends on your area. Use the NHS service finder and contact the listed service before visiting.\n\nThe most effective options include nicotine e-cigarettes, varenicline and cytisine. Combining nicotine replacement therapy such as a patch plus gum or lozenges may be nearly as effective; one product alone is less effective on average.";
  const v2 =
    "Use the NHS stop smoking service finder to find free local support. Some services run through pharmacies, but availability varies, so contact the pharmacy or service before visiting.\n\nThe strongest quit aids include nicotine e-cigarettes, varenicline and cytisine. Combining nicotine replacement therapy such as a patch with gum or lozenges may be nearly as effective; one product alone is less effective on average.";
  it("keeps only the final version when the answer is written twice", () => {
    expect(dropRepeatedDraft(`${v1}\n\n${v2}`)).toBe(v2);
  });
  it("leaves a normal multi-part answer untouched", () => {
    const normal =
      "Your training is booked for Monday, Wednesday and Friday at 7am, each forty minutes of strength work with squats, presses and rows.\n\nYour meals are on the plan too: breakfast after training, lunch at one and dinner at seven, around two thousand four hundred calories with plenty of protein from chicken, eggs, yoghurt and beans.";
    expect(dropRepeatedDraft(normal)).toBe(normal);
  });
});
