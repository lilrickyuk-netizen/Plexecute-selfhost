import { describe, expect, it } from "vitest";
import { COACH_FIRST_BLOCKED, isCoachFirst, stripInternalCitations } from "@/lib/coach-first";

describe("Coach first, search second", () => {
  it.each([
    "I need to quit smoking.",
    "I want to get fit.",
    "I keep procrastinating.",
    "I want to save £10,000.",
    "I want to change career.",
    "I want to improve my sleep.",
    "I'm struggling to stay consistent.",
  ])("coaches first for %s", (m) => expect(isCoachFirst(m)).toBe(true));

  it.each([
    "Find current UK stop-smoking services near me.",
    "What qualifications are employers asking for now for project managers?",
    "Build me a quit plan.",
    "Schedule it.",
    "I want to train at 7am Monday to Friday, put it on my plan",
    "I'm going to spend all day marketing my waitlist today",
    "I need to book a dentist appointment",
  ])("keeps research or execution for %s", (m) => expect(isCoachFirst(m)).toBe(false));

  it("learning intents keep the Learning route", () => {
    expect(isCoachFirst("I want to learn Spanish", { learning: true })).toBe(false);
  });

  it("blocks research and plan-creating tools but keeps reads", () => {
    expect(COACH_FIRST_BLOCKED.test("research_topic")).toBe(true);
    expect(COACH_FIRST_BLOCKED.test("propose_new_goal")).toBe(true);
    expect(COACH_FIRST_BLOCKED.test("advance_mission")).toBe(true);
    expect(COACH_FIRST_BLOCKED.test("request_replan")).toBe(true);
    expect(COACH_FIRST_BLOCKED.test("get_goals")).toBe(false);
    expect(COACH_FIRST_BLOCKED.test("get_knowledge_evidence")).toBe(false);
  });

  it("hides internal citation labels", () => {
    expect(
      stripInternalCitations("Planning helps [NICE, 2014]. Habits stick [Plexecute, 2026]."),
    ).toBe("Planning helps. Habits stick.");
    expect(stripInternalCitations("See [nhs.uk](https://www.nhs.uk)")).toBe(
      "See [nhs.uk](https://www.nhs.uk)",
    );
  });
});

describe("plan edits are never coaching", () => {
  it("routes 'move one of them to 8.30pm' to execution, not coach-first", async () => {
    const CF = await import("../src/lib/coach-first");
    const msg =
      "I have 2 sessions booked in at. 7.30pm I need to to move 1 of them to 8.30pm for me";
    expect(CF.isCoachFirst(msg)).toBe(false);
    expect(CF.isPlanEditRequest(msg)).toBe(true);
  });
  it("a follow-up 'Change one to 8.30' leaves an active coaching flow as execute", async () => {
    const CF = await import("../src/lib/coach-first");
    const prev = {
      mode: "COACHING" as const,
      topic: "sessions",
      questions: [],
      answers: [],
      stage: "UNDERSTANDING" as const,
      turn: 1,
      updated_at: new Date().toISOString(),
    };
    expect(CF.continueConversation(prev, "Change one to 8.30")).toEqual({
      continue: false,
      reason: "execute",
    });
  });
  it("still coaches a personal change that is not a plan edit", async () => {
    const CF = await import("../src/lib/coach-first");
    expect(CF.isCoachFirst("I need to change my habits")).toBe(true);
  });
});
