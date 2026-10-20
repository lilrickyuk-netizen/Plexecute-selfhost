import { describe, expect, it } from "vitest";
import {
  onboardingQuestions,
  onboardingTranscript,
  toggleOnboardingAnswer,
} from "@/lib/onboarding-questionnaire";

describe("whole-life questionnaire", () => {
  it("covers multiple ambitions without a universal training or health question", () => {
    const qs = onboardingQuestions({
      areas: ["Creative projects", "Business and entrepreneurship"],
    });
    expect(qs.some((q) => q.id === "train" || q.id === "health")).toBe(false);
    for (const q of qs) expect(q.options.length).toBeGreaterThanOrEqual(7);
    expect(qs[0]?.options).toEqual(
      expect.arrayContaining([
        "Career and work",
        "Money and financial security",
        "Creative projects",
        "Community and contribution",
        "Travel and lifestyle",
      ]),
    );
  });
  it("asks about health only for relevant selected areas", () => {
    expect(
      onboardingQuestions({ areas: ["Fitness and sport"] }).some((q) => q.id === "health"),
    ).toBe(true);
  });
  it("keeps none and uncertainty mutually exclusive with other answers", () => {
    const q = onboardingQuestions({}).find((q) => q.id === "fixed");
    if (!q) throw new Error("Missing fixed question");
    expect(toggleOnboardingAnswer(["Work or study"], "None", q)).toEqual(["None"]);
    expect(toggleOnboardingAnswer(["None"], "Work or study", q)).toEqual(["Work or study"]);
  });
  it("preserves custom times, context and a single explicit active goal", () => {
    const text = onboardingTranscript(
      {
        areas: ["Creative projects", "Money and financial security"],
        wake: ["My own answer"],
        goalfreq: ["2 sessions a week"],
        length: ["30 minutes"],
        blocker: ["Limited time"],
        vision: ["I'd rather leave this for later"],
        health: ["A medical condition"],
      },
      { wake: "04:45" },
      "Write my first novel",
    );
    expect(text).toContain("My first goal to work on now: Write my first novel");
    expect(text).toContain("Usual wake-up time: 04:45");
    expect(text).toContain("What gets in my way: Limited time");
    expect(text).toContain("not separate goals");
    expect(text).not.toContain("Health-related restrictions");
    expect(text).not.toContain("including training");
    expect(text).not.toContain("for each of my main goals");
  });
});
