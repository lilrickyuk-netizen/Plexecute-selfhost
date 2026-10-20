import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isLearningIntent, learningSubjectKey } from "../src/lib/learning-subject";
import { FREE_TOOLS } from "../src/lib/coach-tools";

describe("Coach → Learning wiring", () => {
  it("detects learning intent for the three acceptance requests", () => {
    for (const m of [
      "I want to learn organic marketing for my app.",
      "I want to learn project management.",
      "I want to learn Spanish.",
    ])
      expect(isLearningIntent(m)).toBe(true);
    expect(isLearningIntent("Can you help me learn things?")).toBe(false);
  });
  it("one pathway per subject, however it is phrased", () => {
    expect(learningSubjectKey("Learn Spanish")).toBe(learningSubjectKey("spanish"));
    expect(learningSubjectKey("organic marketing for my app")).toBe("organic marketing");
    expect(learningSubjectKey("Learn organic marketing")).toBe("organic marketing");
  });
  it("Coach uses the same Learning discovery the Learning page uses", () => {
    const bridge = readFileSync("src/lib/learning-pathway.server.ts", "utf8");
    expect(bridge).toContain("runLearningDiscovery");
    expect(bridge).toContain("scheduleExecutionQueue");
    expect(readFileSync("src/lib/learn-resources.functions.ts", "utf8")).toContain(
      "runLearningDiscovery(data, context)",
    );
    expect(FREE_TOOLS).toContain("build_learning_pathway");
  });
});
