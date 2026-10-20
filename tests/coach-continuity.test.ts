import { describe, expect, it } from "vitest";
import {
  coachContinueAllows,
  COACH_FIRST_BLOCKED,
  CONVERSATION_TTL_MS,
  continueConversation,
  nextCoachingState,
  readConversation,
  type ConversationState,
} from "@/lib/coach-first";

const ANSWER =
  "I smoke around 15 a day. The hardest ones are first thing in the morning, after meals and when I’m stressed. I’ve tried quitting before but only lasted a few days because the cravings got strong and I slipped back into my routine. I want to quit properly this time. What should I do next?";

function opened(topic: string, reply: string): ConversationState {
  return nextCoachingState(null, false, topic, reply);
}
const smoking = opened(
  "I need to quit smoking.",
  "That's a big decision. What usually triggers a cigarette for you? Have you tried quitting before?",
);

describe("Coach conversation continuity", () => {
  it("opens a coaching flow with the questions Coach asked", () => {
    expect(smoking.mode).toBe("COACHING");
    expect(smoking.topic).toBe("I need to quit smoking.");
    expect(smoking.questions).toHaveLength(2);
    expect(smoking.stage).toBe("UNDERSTANDING");
  });

  it("the member's answer continues the same coaching flow (no search, no re-routing)", () => {
    expect(continueConversation(smoking, ANSWER)).toEqual({ continue: true, reason: "continue" });
  });

  it.each([
    "What should I do next?",
    "What would you recommend?",
    "How do I handle that?",
    "What should I try?",
    "I've cut down a bit already. Is that a good start?",
  ])("follow-up stays in coaching: %s", (m) =>
    expect(continueConversation(smoking, m).continue).toBe(true),
  );

  it("saves the answer and moves the flow on", () => {
    const next = nextCoachingState(smoking, true, ANSWER, "Right. When is your quit day?");
    expect(next.topic).toBe("I need to quit smoking.");
    expect(next.answers).toEqual([ANSWER]);
    expect(next.turn).toBe(2);
    expect(next.stage).toBe("GUIDING");
  });

  it.each([
    "Find me current NHS support near me.",
    "What nicotine products are currently available?",
    "Show me current NHS guidance.",
    "Find me a local stop-smoking service.",
  ])("explicit external request switches to research: %s", (m) =>
    expect(continueConversation(smoking, m)).toEqual({ continue: false, reason: "external" }),
  );

  it.each(["Build me a quit plan.", "Schedule it.", "Go ahead and put it on my plan."])(
    "explicit execution request leaves coaching: %s",
    (m) => expect(continueConversation(smoking, m)).toEqual({ continue: false, reason: "execute" }),
  );

  it.each([
    "I want to get fit.",
    "I need to quit smoking.",
    "Anyway, can you explain compound interest?",
    "What is the difference between a goal and a milestone?",
  ])("topic change resets the coaching flow: %s", (m) =>
    expect(continueConversation(smoking, m)).toEqual({ continue: false, reason: "topic_change" }),
  );

  it("a learning intent hands over to Learning", () => {
    expect(
      continueConversation(smoking, "I want to learn Spanish", { learning: true }).reason,
    ).toBe("topic_change");
  });

  it("a sign-off completes the flow", () => {
    expect(continueConversation(smoking, "Thanks, that's all")).toEqual({
      continue: false,
      reason: "complete",
    });
  });

  it.each([
    [
      "I want to get fit.",
      "I can run about 2km and want to lose a stone. What would you recommend?",
    ],
    [
      "I want to change career.",
      "I'm a warehouse supervisor and want something in tech. How do I handle that?",
    ],
    ["I need to save more money.", "About £300 a month, I earn 2k. What should I try?"],
    ["I'm struggling to sleep.", "Usually I'm on my phone until 1am. What should I change?"],
  ])("works for any topic, not just smoking: %s", (topic, answer) => {
    const flow = opened(topic, "Tell me more. Where are you starting from?");
    expect(continueConversation(flow, answer).continue).toBe(true);
  });

  it("a research detour keeps the coaching flow so a plain follow-up resumes it", () => {
    const detour: ConversationState = { ...smoking, mode: "RESEARCH", parent: smoking };
    expect(continueConversation(detour, "Thanks. What should I do next?").continue).toBe(true);
  });

  it("no active coaching flow means normal routing", () => {
    expect(continueConversation(null, ANSWER).reason).toBe("none");
    const exec: ConversationState = { ...smoking, mode: "EXECUTION" };
    expect(continueConversation(exec, "What should I do next?").continue).toBe(false);
  });

  it("expired or missing state is ignored", () => {
    const now = Date.parse("2026-10-17T12:00:00Z");
    const fresh = { contract: { conversation: smoking }, created_at: "2026-10-17T11:00:00Z" };
    expect(readConversation(fresh, now)?.mode).toBe("COACHING");
    const old = new Date(now - CONVERSATION_TTL_MS - 1000).toISOString();
    expect(readConversation({ contract: { conversation: smoking }, created_at: old }, now)).toBe(
      null,
    );
    expect(readConversation({ contract: {} }, now)).toBe(null);
  });

  it("continuing turns cannot search, create plans or read old research dumps", () => {
    expect(COACH_FIRST_BLOCKED.test("research_topic")).toBe(true);
    expect(COACH_FIRST_BLOCKED.test("propose_new_goal")).toBe(true);
    for (const t of [
      "research_topic",
      "get_research_findings",
      "plan_journey",
      "propose_new_goal",
      "schedule_commitment",
      "advance_mission",
    ])
      expect(coachContinueAllows(t)).toBe(false);
    for (const t of ["get_goals", "get_knowledge_evidence", "get_execution_history"])
      expect(coachContinueAllows(t)).toBe(true);
  });
});

import { leansOnTopic } from "../src/lib/coach-first";
describe("research topic carry-over", () => {
  it("carries the coaching topic into a dependent search", () =>
    expect(leansOnTopic("Find current NHS stop-smoking services near me.")).toBe(true));
  it("does not carry an old topic into a new research subject", () =>
    expect(
      leansOnTopic(
        "Find current project manager qualifications and tell me which route makes sense for me.",
      ),
    ).toBe(false));
});

describe("exercise how-to stays available inside coaching", () => {
  it("allows the read-only exercise explainer", () =>
    expect(coachContinueAllows("explain_exercise")).toBe(true));
});
