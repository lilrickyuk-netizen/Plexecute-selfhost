// Universal goal pathway: 20 cross-domain goals + adversarial + 12-month roll-forward, all through the same engine.
import { describe, it, expect } from "vitest";
import {
  assessPathway,
  blockImpact,
  canComplete,
  clarifyingQuestions,
  goalTradeoff,
  horizonWeeklyMinutes,
  normalisePathway,
  orderMilestones,
  professionalBoundary,
  researchTrigger,
  restrictedGoal,
  retryActions,
  rollingHorizon,
  validatePathway,
  type Milestone,
} from "../src/lib/pathway";

const today = "2026-10-13";
let n = 0;
const m = (title: string, o: Partial<Milestone> = {}): Milestone => ({
  key: o.key ?? `k${++n}`,
  title,
  stage: 1,
  depends_on: [],
  effort_hours: 10,
  min_weeks: 0,
  cost: 0,
  evidence: "user_confirms",
  capability: "user_performs",
  major: false,
  source_refs: [],
  actions: [{ title: `Book a session for: ${title}`, minutes: 45, capability: "user_performs" }],
  ...o,
});
const chain = (steps: [string, Partial<Milestone>][]) => {
  const out: Milestone[] = [];
  steps.forEach(([t, o], i) =>
    out.push(m(t, { key: `s${i}`, stage: i + 1, depends_on: i ? [`s${i - 1}`] : [], ...o })),
  );
  return out;
};
const draft = (
  goal: string,
  milestones: Milestone[],
  success: any = { type: "milestones", definition: `${goal} achieved`, target: null, unit: null },
  extra: any = {},
) =>
  normalisePathway({
    goal_title: goal,
    outcome: goal,
    domain: "other",
    success,
    milestones,
    sources: extra.sources ?? [],
    ...extra,
  });

// Each goal: pathway fixture, life context, expectations. Same functions for all — no per-goal code.
const GOALS: {
  goal: string;
  d: ReturnType<typeof draft>;
  weekly: number;
  deadline?: string;
  budget?: number;
  saving?: number;
  research: boolean;
  boundary?: boolean;
}[] = [
  {
    goal: "Become a commercial pilot",
    research: true,
    boundary: true,
    weekly: 600,
    budget: 5000,
    saving: 2000,
    d: draft(
      "Become a commercial pilot",
      chain([
        [
          "Class 1 medical",
          {
            evidence: "document",
            major: true,
            capability: "professional_required",
            cost: 600,
            min_weeks: 4,
          },
        ],
        [
          "PPL licence",
          {
            effort_hours: 120,
            min_weeks: 26,
            cost: 12000,
            evidence: "document",
            major: true,
            capability: "external_approval",
          },
        ],
        [
          "ATPL theory exams",
          {
            effort_hours: 650,
            min_weeks: 40,
            cost: 3000,
            evidence: "result_recorded",
            major: true,
          },
        ],
        [
          "CPL skills test",
          {
            effort_hours: 150,
            cost: 30000,
            evidence: "document",
            major: true,
            capability: "external_approval",
          },
        ],
      ]),
      { type: "external", definition: "Commercial pilot licence issued", target: null, unit: null },
    ),
  },
  {
    goal: "Write and publish a novel",
    research: false,
    weekly: 300,
    d: draft(
      "Write and publish a novel",
      chain([
        ["Outline complete", {}],
        ["First draft 80,000 words", { effort_hours: 300, evidence: "amount_reached" }],
        ["Revision complete", { effort_hours: 120 }],
        ["Self-publish on a platform", { effort_hours: 20, evidence: "document", major: true }],
      ]),
    ),
  },
  {
    goal: "Save £10,000",
    research: false,
    weekly: 60,
    budget: 1000,
    saving: 750,
    deadline: "2027-12-31",
    d: draft(
      "Save £10,000",
      [
        m("Set up a savings pot", { key: "a" }),
        m("Reach £10,000", {
          key: "b",
          depends_on: ["a"],
          evidence: "amount_reached",
          major: true,
          effort_hours: 2,
        }),
      ],
      { type: "measurable", definition: "£10,000 saved", target: 10000, unit: "GBP" },
    ),
  },
  {
    goal: "Buy my first house",
    research: true,
    boundary: true,
    weekly: 180,
    budget: 8000,
    saving: 800,
    d: draft(
      "Buy my first house",
      chain([
        [
          "Mortgage agreement in principle",
          { capability: "external_approval", evidence: "document", major: true },
        ],
        ["Save deposit", { cost: 25000, evidence: "amount_reached", major: true }],
        ["Make an offer", {}],
        [
          "Complete purchase",
          { capability: "professional_required", min_weeks: 12, evidence: "document", major: true },
        ],
      ]),
    ),
  },
  {
    goal: "Qualify as an electrician",
    research: true,
    boundary: true,
    weekly: 480,
    budget: 2000,
    saving: 300,
    d: draft(
      "Qualify as an electrician",
      chain([
        ["Shortlist Level 3 courses", { capability: "plexecute_researches" }],
        [
          "Level 3 diploma",
          { effort_hours: 400, min_weeks: 52, cost: 4000, evidence: "document", major: true },
        ],
        [
          "NVQ portfolio and AM2",
          {
            effort_hours: 200,
            min_weeks: 26,
            evidence: "result_recorded",
            major: true,
            capability: "external_approval",
          },
        ],
      ]),
    ),
  },
  {
    goal: "Learn conversational Spanish",
    research: false,
    weekly: 180,
    d: draft(
      "Learn conversational Spanish",
      chain([
        ["A1 basics", { effort_hours: 60 }],
        ["A2 conversation", { effort_hours: 90 }],
        [
          "15-minute conversation with a native speaker",
          { effort_hours: 40, evidence: "session_completed", major: true },
        ],
      ]),
    ),
  },
  {
    goal: "Run a marathon",
    research: false,
    weekly: 300,
    deadline: "2027-05-01",
    d: draft(
      "Run a marathon",
      chain([
        ["Run 10 km", { effort_hours: 20, min_weeks: 6 }],
        ["Run half marathon", { effort_hours: 40, min_weeks: 8 }],
        [
          "Finish the marathon",
          { effort_hours: 60, min_weeks: 10, evidence: "result_recorded", major: true },
        ],
      ]),
      { type: "binary", definition: "Finish a 42.2 km race", target: null, unit: null },
    ),
  },
  {
    goal: "Start a small photography business",
    research: false,
    weekly: 360,
    budget: 3000,
    d: draft(
      "Start a small photography business",
      chain([
        ["Portfolio of 20 images", { effort_hours: 40 }],
        [
          "Register as self-employed",
          { effort_hours: 3, capability: "external_approval", evidence: "application_submitted" },
        ],
        [
          "First 3 paying clients",
          { effort_hours: 30, evidence: "user_confirms", major: true, cost: 1500 },
        ],
      ]),
    ),
  },
  {
    goal: "Get into university",
    research: true,
    weekly: 300,
    deadline: "2027-09-01",
    d: draft(
      "Get into university",
      chain([
        ["Choose 5 courses", { capability: "plexecute_researches" }],
        ["Personal statement", { effort_hours: 20 }],
        ["Submit application", { evidence: "application_submitted", major: true }],
        [
          "Offer accepted",
          { capability: "external_approval", min_weeks: 12, evidence: "document", major: true },
        ],
      ]),
    ),
  },
  {
    goal: "Renovate my kitchen",
    research: false,
    weekly: 240,
    budget: 9000,
    saving: 500,
    d: draft(
      "Renovate my kitchen",
      chain([
        ["Three quotes", { capability: "plexecute_assists" }],
        ["Fund the work", { cost: 12000, evidence: "amount_reached" }],
        ["Fitting complete", { capability: "professional_required", min_weeks: 3, major: true }],
      ]),
    ),
  },
  {
    goal: "Pass a professional certification",
    research: true,
    weekly: 300,
    deadline: "2027-06-30",
    d: draft(
      "Pass a professional certification",
      chain([
        ["Register for exam", { evidence: "application_submitted", cost: 400 }],
        ["Study syllabus", { effort_hours: 120 }],
        [
          "Pass the exam",
          { evidence: "result_recorded", major: true, capability: "external_approval" },
        ],
      ]),
      undefined,
    ),
  },
  {
    goal: "Learn piano",
    research: false,
    weekly: 150,
    d: draft(
      "Learn piano",
      chain([
        ["Play C major scale hands together", { effort_hours: 15 }],
        ["Play a Grade 1 piece", { effort_hours: 40, evidence: "session_completed", major: true }],
      ]),
    ),
  },
  {
    goal: "Change into project management",
    research: false,
    weekly: 300,
    budget: 500,
    saving: 200,
    d: draft(
      "Change into project management",
      chain([
        [
          "PM certification",
          { effort_hours: 80, cost: 900, evidence: "result_recorded", major: true },
        ],
        ["Lead one project at work", { effort_hours: 60, min_weeks: 12 }],
        [
          "Apply to 10 PM roles",
          { effort_hours: 20, evidence: "application_submitted", major: true },
        ],
      ]),
    ),
  },
  {
    goal: "Organise a wedding",
    research: false,
    weekly: 180,
    deadline: "2027-08-01",
    budget: 15000,
    saving: 600,
    d: draft(
      "Organise a wedding",
      chain([
        ["Book venue", { capability: "plexecute_assists", cost: 6000 }],
        ["Book suppliers", { cost: 8000 }],
        ["Wedding day", { evidence: "user_confirms", major: true }],
      ]),
    ),
  },
  {
    goal: "Move to another country",
    research: true,
    weekly: 240,
    budget: 4000,
    saving: 500,
    d: draft(
      "Move to another country",
      chain([
        ["Check visa eligibility", { capability: "plexecute_researches" }],
        [
          "Apply for visa",
          {
            evidence: "application_submitted",
            cost: 1500,
            capability: "external_approval",
            min_weeks: 12,
            major: true,
          },
        ],
        ["Relocate", { cost: 3000, major: true }],
      ]),
    ),
  },
  {
    goal: "Complete a major home project",
    research: false,
    weekly: 300,
    d: draft(
      "Complete a major home project",
      chain([
        ["Plan and materials list", {}],
        ["Build phase", { effort_hours: 80 }],
        ["Sign-off", { major: true }],
      ]),
    ),
  },
  {
    goal: "Improve public speaking",
    research: false,
    weekly: 120,
    d: draft(
      "Improve public speaking",
      chain([
        ["Join a speaking club", {}],
        [
          "Give five 5-minute talks",
          { effort_hours: 20, evidence: "session_completed", major: true },
        ],
      ]),
    ),
  },
  {
    goal: "Train for a charity event",
    research: false,
    weekly: 240,
    deadline: "2027-04-01",
    d: draft(
      "Train for a charity event",
      chain([
        ["Register and fundraise page", { evidence: "application_submitted" }],
        ["Training block", { effort_hours: 50, min_weeks: 12 }],
        ["Event day", { evidence: "result_recorded", major: true }],
      ]),
    ),
  },
  {
    goal: "Build a portfolio for a creative career",
    research: false,
    weekly: 300,
    d: draft(
      "Build a portfolio for a creative career",
      chain([
        ["Pick 3 project themes", {}],
        ["Finish 6 portfolio pieces", { effort_hours: 120 }],
        ["Publish portfolio site", { evidence: "document", major: true }],
      ]),
    ),
  },
  {
    goal: "Complete a two-year qualification while working full-time",
    research: true,
    weekly: 420,
    d: draft(
      "Complete a two-year qualification while working full-time",
      chain([
        ["Enrol", { evidence: "application_submitted", cost: 3000 }],
        [
          "Year 1 modules",
          { effort_hours: 300, min_weeks: 40, evidence: "result_recorded", major: true },
        ],
        [
          "Year 2 modules",
          { effort_hours: 300, min_weeks: 40, evidence: "result_recorded", major: true },
        ],
      ]),
    ),
  },
];

describe("universal goal suite (20 cross-domain goals, same engine)", () => {
  for (const g of GOALS) {
    it(g.goal, () => {
      expect(restrictedGoal(g.goal)).toBeNull();
      expect(validatePathway(g.d)).toEqual([]);
      expect(g.d.success.definition.length).toBeGreaterThan(0);
      expect(researchTrigger(g.goal).required).toBe(g.research);
      if (g.boundary) expect(professionalBoundary(g.goal)).not.toBeNull();
      // Dependencies respected
      const order = orderMilestones(g.d.milestones).map((x) => x.key);
      for (const x of g.d.milestones)
        for (const dep of x.depends_on)
          expect(order.indexOf(dep)).toBeLessThan(order.indexOf(x.key));
      // Feasibility from real spare time and money
      const a = assessPathway(g.d, {
        today,
        deadline: g.deadline,
        weeklyMinutesAvailable: g.weekly,
        budget: g.budget,
        monthlySaving: g.saving,
      });
      expect(["feasible", "tight", "infeasible"]).toContain(a.level);
      if (a.level !== "infeasible") expect(a.earliest_date >= today).toBe(true);
      const cost = g.d.milestones.reduce((s, x) => s + x.cost, 0);
      expect(a.money.required).toBe(cost);
      // Rolling horizon: only the first unblocked steps are active initially
      const h = rollingHorizon(g.d.milestones.map((x) => ({ ...x, status: "pending" as const })));
      expect(h.active.every((x) => x.depends_on.length === 0)).toBe(true);
      expect(
        horizonWeeklyMinutes(
          g.d.milestones.map((x) => ({ ...x, status: "pending" as const })),
          g.weekly,
        ),
      ).toBeLessThanOrEqual(Math.max(30, g.weekly));
      // Every action is concrete and every step knows who can do it
      for (const x of g.d.milestones)
        for (const act of x.actions) expect(act.title).not.toMatch(/^work on/i);
    });
  }
});

describe("adversarial", () => {
  it("rejects an impossible deadline honestly and offers the earliest date", () => {
    const d = draft("12-month qualification", [
      m("Course", { key: "c", min_weeks: 52, effort_hours: 300 }),
    ]);
    const a = assessPathway(d, { today, deadline: "2026-11-03", weeklyMinutesAvailable: 1200 });
    expect(a.level).toBe("infeasible");
    expect(a.reasons.join(" ")).toMatch(/at least 52 weeks/);
    expect(a.alternatives[0]).toMatch(/Earliest realistic finish: 2027-10/);
  });
  it("save £50,000 in 6 months on £500/month is infeasible with lower-target and higher-saving options", () => {
    const d = draft(
      "Save £50,000",
      [m("Reach £50,000", { key: "r", evidence: "amount_reached", effort_hours: 1 })],
      { type: "measurable", definition: "£50,000 saved", target: 50000, unit: "GBP" },
    );
    const a = assessPathway(d, {
      today,
      deadline: "2027-04-13",
      weeklyMinutesAvailable: 300,
      monthlySaving: 500,
    });
    expect(a.level).toBe("infeasible");
    expect(a.money.months_to_fund).toBe(100);
    expect(a.alternatives.join(" ")).toMatch(/lower the target to about £2,9\d\d/);
  });
  it("insufficient money with no saving plan is not hidden", () => {
    const d = draft("Course", [m("Pay course fee", { key: "p", cost: 5000 })]);
    const a = assessPathway(d, { today, weeklyMinutesAvailable: 300, budget: 1000 });
    expect(a.level).toBe("infeasible");
    expect(a.money.shortfall).toBe(4000);
    const b = assessPathway(d, {
      today,
      weeklyMinutesAvailable: 300,
      budget: 1000,
      monthlySaving: 500,
    });
    expect(b.level).toBe("feasible");
    expect(b.money.months_to_fund).toBe(8);
  });
  it("no free time is infeasible", () => {
    const a = assessPathway(draft("Learn", [m("Study", { key: "s" })]), {
      today,
      weeklyMinutesAvailable: 0,
    });
    expect(a.level).toBe("infeasible");
    expect(a.reasons[0]).toMatch(/no free time/);
  });
  it("ambiguous goal asks a short clarifying question instead of planning", () => {
    expect(clarifyingQuestions("I want to get healthier").length).toBeGreaterThan(0);
    expect(clarifyingQuestions("I want to get healthier").length).toBeLessThanOrEqual(3);
    expect(clarifyingQuestions("Run a marathon")).toEqual([]);
  });
  it("asks for the country when jurisdiction changes the pathway", () => {
    expect(clarifyingQuestions("Qualify as an electrician").some((q) => /country/.test(q))).toBe(
      true,
    );
    expect(
      clarifyingQuestions("Qualify as an electrician", { jurisdiction: "United States" }),
    ).toEqual([]);
  });
  it("refuses illegal or unsafe goals", () => {
    expect(restrictedGoal("Hack into my ex's email")).not.toBeNull();
    expect(restrictedGoal("Lose 10 kg in a week")).not.toBeNull();
    expect(restrictedGoal("Overcome my fear of spiders")).toBeNull();
  });
  it("structural problems block acceptance", () => {
    const loop = draft("x", [
      m("A", { key: "a", depends_on: ["b"] }),
      m("B", { key: "b", depends_on: ["a"] }),
    ]);
    expect(validatePathway(loop).join(" ")).toMatch(/loop/);
    const vague = draft("x", [
      m("A", {
        key: "a",
        actions: [{ title: "Work on career", minutes: 30, capability: "user_performs" }],
      }),
    ]);
    expect(validatePathway(vague).join(" ")).toMatch(/too vague/);
    const fake = draft("x", [m("A", { key: "a", source_refs: [3] })]);
    expect(validatePathway(fake).join(" ")).toMatch(/source/);
    const noDone = draft("x", [m("A", { key: "a" })], {
      type: "milestones",
      definition: "",
      target: null,
      unit: null,
    });
    expect(validatePathway(noDone).join(" ")).toMatch(/definition of done/);
  });
  it("major milestones never complete without evidence or by elapsed time", () => {
    expect(canComplete({ major: true, evidence: "result_recorded" }, "").ok).toBe(false);
    expect(canComplete({ major: true, evidence: "result_recorded" }, "Passed 78%").ok).toBe(true);
    expect(
      canComplete({ major: true, evidence: "amount_reached" }, null, {
        current: 9000,
        target: 10000,
      }).ok,
    ).toBe(false);
    expect(
      canComplete({ major: true, evidence: "amount_reached" }, null, {
        current: 10000,
        target: 10000,
      }).ok,
    ).toBe(true);
  });
  it("external prerequisite denied: blocks only dependants and keeps completed work", () => {
    const ms = chain([
      ["Medical", {}],
      ["Licence", {}],
      ["Job", {}],
    ]).map((x, i) => ({ ...x, status: (i === 0 ? "done" : "pending") as any }));
    const imp = blockImpact(ms, "s1");
    expect(imp.held).toEqual(["Job"]);
    expect(imp.preserved).toEqual(["Medical"]);
    const h = rollingHorizon(
      ms.map((x) => (x.key === "s1" ? { ...x, status: "blocked" as const } : x)),
    );
    expect(h.active).toEqual([]);
    expect(h.held.map((x) => x.key)).toEqual(["s1", "s2"]);
  });
  it("failed milestone stays open with a retry action", () => {
    const r = retryActions({
      title: "Pass exam",
      actions: [{ title: "Sit exam", minutes: 120, capability: "user_performs", done: true }],
    });
    expect(r[0]!.done).toBe(false);
    expect(r.at(-1)!.title).toMatch(/rebook/);
  });
  it("research source unavailable lowers confidence rather than inventing facts", () => {
    const d = draft("Qualify", [m("A", { key: "a" })], undefined, { research_confidence: "high" });
    expect(d.sources).toEqual([]);
    expect(
      validatePathway({ ...d, milestones: [{ ...d.milestones[0]!, source_refs: [0] }] }).join(" "),
    ).toMatch(/source/);
  });
  it("conflicting goals explain the trade-off; lowest priority gives way first", () => {
    const t = goalTradeoff(
      [
        { title: "New career", weekly_minutes: 600, priority_class: "must" },
        { title: "Train 3x", weekly_minutes: 180, priority_class: "important" },
        { title: "Learn guitar", weekly_minutes: 180, priority_class: "optional" },
      ],
      700,
    );
    expect(t.conflict).toBe(true);
    expect(t.giveWay[0]).toBe("Learn guitar");
    expect(t.message).toMatch(/Sleep and protected time stay untouched/);
  });
  it("research triggers only for current/regulated info, not stable knowledge", () => {
    expect(researchTrigger("Learn piano").required).toBe(false);
    expect(researchTrigger("Become a nurse in the US").required).toBe(true);
    expect(researchTrigger("Get a UK visa").required).toBe(true);
  });
});

describe("12-month goal rolls forward", () => {
  const ms = chain([
    ["Q1 foundation", { effort_hours: 40, min_weeks: 12 }],
    ["Q2 build", { effort_hours: 60, min_weeks: 12 }],
    ["Q3 advance", { effort_hours: 60, min_weeks: 12 }],
    ["Q4 finish", { effort_hours: 60, min_weeks: 12, major: true, evidence: "result_recorded" }],
  ]);
  it("schedules only near-term work, unlocks the next stage on completion, and keeps history", () => {
    let state = ms.map((x) => ({ ...x, status: "pending" as Milestone["status"] }));
    expect(rollingHorizon(state).active.map((x) => x.key)).toEqual(["s0"]);
    expect(rollingHorizon(state).waiting.length).toBe(3);
    const wk = horizonWeeklyMinutes(state, 600);
    expect(wk).toBe(195); // 40h over 12 weeks ≈ 200 min/week, rounded to 15
    state = state.map((x) => (x.key === "s0" ? { ...x, status: "done" } : x));
    expect(rollingHorizon(state).active.map((x) => x.key)).toEqual(["s1"]);
    expect(state.filter((x) => x.status === "done").length).toBe(1);
    const a = assessPathway(draft("Year goal", state), {
      today,
      deadline: "2027-10-13",
      weeklyMinutesAvailable: 600,
    });
    expect(a.needed_weeks).toBe(36);
    expect(a.level).toBe("feasible");
    const late = assessPathway(draft("Year goal", state), {
      today,
      deadline: "2027-05-01",
      weeklyMinutesAvailable: 600,
    });
    expect(late.level).toBe("infeasible");
  });
});
