import { describe, it, expect } from "vitest";
import { classifyActions, memberInstructed } from "../src/lib/life-intelligence";
describe("execution intent", () => {
  it("all-day free marketing is execution, not advice", () => {
    const r = classifyActions(
      "I'm going to spend all day today putting it in as many online places for free as is possible",
    );
    expect(r.execution).toBe(true);
    expect(r.actions).toEqual(expect.arrayContaining(["RESEARCH", "PLAN", "SCHEDULE", "EXECUTE"]));
    expect(
      memberInstructed(
        "I'm going to spend all day today putting it in as many online places for free as is possible",
      ),
    ).toBe(true);
  });
  it("complaint about generic advice escalates", () =>
    expect(
      classifyActions(
        "So you are supposed to be helping me plan and execute yet all you are doing is giving me generic advice?",
      ).execution,
    ).toBe(true));
  it("other intentions", () => {
    for (const t of [
      "I need to find customers",
      "I want to start learning Spanish",
      "I need to sort my finances",
    ])
      expect(classifyActions(t).execution).toBe(true);
  });
  it("capability questions stay answers", () => {
    expect(classifyActions("Can you book taxis?").execution).toBe(false);
    expect(classifyActions("Why is this on my plan?").execution).toBe(false);
  });
});
import { executionReadyIssues } from "../src/lib/execution-queue.server";
describe("execution loop and live-test phrasings", () => {
  const cases: [string, string | null][] = [
    ["I have an hour now and I want to start learning Spanish.", "now"],
    ["I want to start applying for project manager jobs today.", "now"],
    ["I have tonight free and I need to get my finances sorted.", "now"],
    ["I want to get fitter and I have an hour tonight.", "now"],
    ["I want to launch my own company.", "start"],
    [
      "I've got work until 6, I need to train, study for an hour and work on my business tonight. Sort it out.",
      "now",
    ],
    ["I need to stop now. Continue tomorrow.", "pause"],
    ["That channel got me 15 signups.", "outcome"],
    ["That other post was removed because promotion wasn't allowed.", "outcome"],
    ["Done", "outcome"],
  ];
  for (const [t, loop] of cases)
    it(t, () => {
      const r = classifyActions(t);
      expect(r.execution).toBe(true);
      expect(r.loop).toBe(loop);
    });
  it("information stays an answer", () => {
    for (const t of [
      "What does progressive overload mean?",
      "Why is protein important?",
      "What is a project manager?",
    ])
      expect(classifyActions(t).execution).toBe(false);
  });
  it("vague sessions are rejected", () => {
    expect(
      executionReadyIssues({ title: "Work on marketing", action: "x", done_when: "" }).length,
    ).toBeGreaterThan(0);
    expect(
      executionReadyIssues({
        title: "Post waitlist to r/SideProject",
        action: "Paste the prepared post as a text post",
        done_when: "Post is live",
        link: "https://www.reddit.com/r/SideProject/",
      }),
    ).toEqual([]);
  });
});
