import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { memberInstructed, requestIntent } from "../src/lib/life-intelligence";
import { buildPrepPlan, type PrepContext } from "../src/lib/meal-prep";

describe("a member's instruction to Coach is the confirmation", () => {
  const instructions = [
    "I want you to build me a diet plan to help me gain weight, I want to eat 4 times a day and train bodyweight circuits every morning, put it on my daily and weekly plans",
    "I will need at least 2500 to 3000 calories a day",
    "Plan accepted",
    "Yes, go ahead",
    "Can you put my meal plan on my daily plan",
    "Move my gym session to 7am tomorrow",
    "Change the plan so gym isn't straight after work",
    "Is my accountability call on for every 7am training session Monday to Friday? If not put them on.",
    "Remove them",
    "Remove any duplicate plans my own plans should be scaling my business training in the morning and sticking to my diet plan",
  ];
  const notInstructions = [
    "Why is the module 2 study session on my plan?",
    "Am I on track with my house deposit?",
    "How did my week go?",
    "Can you make diet plans?",
    "Don't change anything yet",
    "I keep missing my gym sessions. What's going on?",
  ];
  for (const t of instructions)
    it(`acts on: ${t.slice(0, 50)}`, () => expect(memberInstructed(t)).toBe(true));
  for (const t of notInstructions)
    it(`does not act on: ${t}`, () => expect(memberInstructed(t)).toBe(false));
  it("'can you build me…' is a request, 'can you book taxis?' still a question", () => {
    expect(requestIntent("Can you build me a diet plan for the week")).toBe("action_request");
    expect(requestIntent("Can you book taxis?")).toBe("capability_question");
  });
  it("Coach applies instructed changes itself and never sends members elsewhere to confirm", () => {
    const actions = readFileSync("src/lib/coach-actions.server.ts", "utf8");
    const tools = readFileSync("src/lib/coach-tools.server.ts", "utf8");
    const prompt = readFileSync("src/lib/coach.functions.ts", "utf8");
    expect(actions).toMatch(/instructed[\s\S]{0,400}runPending\(/);
    expect(actions).toContain('ALWAYS_CONFIRM = new Set<string>(["delete_goal", "delete_plan"])');
    expect(actions).toMatch(/instructedNow\(ctx\)\)[\s\S]{0,400}acceptPlan\(/);
    expect(actions).toMatch(/instructedNow\(ctx\)\)[\s\S]{0,200}approveWeekPlan\(/);
    expect(tools).toMatch(/memberInstructed\(ctx\.memberText\)[\s\S]{0,1400}approveWeekPlan\(/);
    expect(tools).toContain('status: instructed ? "active" : "proposed"');
    expect(prompt).toContain("Never ask them to confirm, accept or approve again");
    expect(prompt).toContain("Expert voice");
  });
});

describe("weight-gain meal plans hit the calories asked for", () => {
  const ctx: PrepContext = {
    startDate: "2026-10-19",
    days: 7,
    targets: { kcal: 2750, protein_g: 145, carbs_g: 340, fat_g: 90 },
    targetsSource: "plan targets you asked for",
    slots: ["breakfast", "lunch", "dinner", "snack"],
    allergies: [],
    diet: null,
    dislikes: [],
    onlyExisting: false,
    allowStaples: true,
    prepDay: "2026-10-18",
    secondPrep: true,
    quickBreakfastDates: [],
    busyEveningDates: [],
    trainingDates: [],
  };
  it("every day lands within 3% of 2,750 kcal (never below 2,500)", () => {
    const plan = buildPrepPlan(ctx, []);
    for (const d of plan.days) {
      expect(d.totals.kcal).toBeGreaterThanOrEqual(2500);
      expect(Math.abs(d.totals.kcal - 2750)).toBeLessThanOrEqual(2750 * 0.035);
    }
  });
});

describe("multi-part requests are completed in one go", async () => {
  const { weekdaysArg, hmArg } = await import("../src/lib/coach-actions.server");
  const { buildWeekPlan, startOfWeek } = await import("../src/lib/scheduler");
  it("parses Monday to Friday at 7am", () => {
    expect(weekdaysArg(["monday", "tuesday", "wednesday", "thursday", "friday"])).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(weekdaysArg("weekdays")).toEqual([1, 2, 3, 4, 5]);
    expect(hmArg("7am")).toBe("07:00");
    expect(hmArg("07:00")).toBe("07:00");
  });
  it("places 5 sessions only Monday to Friday, at 07:00", () => {
    const ws = startOfWeek(new Date("2026-10-19T12:00:00Z"), "Europe/London");
    const r = buildWeekPlan(
      {
        wake_time: "06:00",
        sleep_time: "22:30",
        work_start: "09:00",
        work_end: "17:00",
        work_days: [1, 2, 3, 4, 5],
        timezone: "Europe/London",
        commitments: [],
      } as never,
      [
        {
          id: "g",
          title: "Gym",
          domain: "training",
          weekly_minutes: 300,
          session_minutes: 60,
          preferred_time: "morning",
          preferred_days: [1, 2, 3, 4, 5],
          preferred_start: "07:00",
        },
      ],
      ws,
      { notBefore: ws } as never,
    );
    expect(r.blocks).toHaveLength(5);
    for (const b of r.blocks) {
      const d = new Date(b.starts_at);
      expect([1, 2, 3, 4, 5]).toContain(d.getUTCDay());
      expect(
        d.toLocaleTimeString("en-GB", {
          timeZone: "Europe/London",
          hour: "2-digit",
          minute: "2-digit",
        }),
      ).toBe("07:00");
    }
  });
});
