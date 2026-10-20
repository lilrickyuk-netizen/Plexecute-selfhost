import { describe, expect, it } from "vitest";
import { isInformationOnly, needsMemberContext, researchSearchQuery } from "../src/lib/research";

describe("universal Coach routing", () => {
  it.each([
    "I want advice on quitting smoking.",
    "Find current project management qualifications I can start in the UK.",
    "I want to become a project manager. What should I learn and what qualifications are employers asking for now?",
    "Find free places online where I could promote an AI Life Execution Platform.",
    "I keep missing my study sessions. What should I change?",
    "What is the difference between a goal and a milestone?",
  ])("questions do not authorise mutations: %s", (q) => expect(isInformationOnly(q)).toBe(true));
  it.each([
    "I want to learn organic marketing and find free places to promote my waiting list.",
    "Book me a table tonight.",
    "Find a course and schedule study sessions tomorrow.",
    "Make me a meal plan.",
  ])("preserves explicit execution: %s", (q) => expect(isInformationOnly(q)).toBe(false));
  it("never injects a subject or product stage", () => {
    expect(
      researchSearchQuery("Find free places online to promote a pottery course", "United Kingdom"),
    ).toBe("Find free places online to promote a pottery course");
  });
  it("preserves arbitrary location queries", () => {
    expect(researchSearchQuery("museum opening times", "Edinburgh")).toBe(
      "museum opening times Edinburgh",
    );
  });
  it("does not load personal state for a general definition", () => {
    expect(needsMemberContext("What is the difference between a goal and a milestone?")).toBe(
      false,
    );
  });
  it("loads relevant context for repeated personal misses", () => {
    expect(needsMemberContext("I keep missing my study sessions. What should I change?")).toBe(
      true,
    );
  });
  it("answers a stated savings target with an advice question without authorising mutations", () => {
    const q = "I need to save £10,000 in 18 months. How should I approach it?";
    expect(isInformationOnly(q)).toBe(true);
    expect(needsMemberContext(q)).toBe(true);
  });
  it("answers personal advice after an intention without mission setup", () => {
    expect(isInformationOnly("I want to change careers. How can I approach it?")).toBe(true);
    expect(isInformationOnly("I need to improve my sleep. How should I start?")).toBe(true);
    expect(isInformationOnly("I need to save £10,000. Create a plan for me.")).toBe(false);
  });
  it.each([
    "How many calories have I eaten today?",
    "What have I got for lunch tomorrow?",
    "How many calories have I got left today?",
  ])("reads the member's own data for first-person questions: %s", (q) =>
    expect(needsMemberContext(q)).toBe(true),
  );
});
