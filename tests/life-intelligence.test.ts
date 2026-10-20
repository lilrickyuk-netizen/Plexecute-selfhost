import { describe, expect, it } from "vitest";
import {
  alignment,
  buildLinks,
  capabilityFor,
  confidenceFrom,
  dailyBrief,
  detectConflicts,
  diffLinks,
  explainItem,
  goalMetrics,
  linkKey,
  missPatterns,
  patternAdherence,
  planRationale,
  prerequisiteIssues,
  proactiveSignals,
  projectGoal,
  reconcile,
  routeDomains,
  servesObjective,
  weeklyReview,
  type IBlock,
  type IGoal,
  type IMilestone,
} from "../src/lib/life-intelligence";
import { FREE_TOOLS, gateTool } from "../src/lib/coach-tools";

const now = new Date("2026-10-13T12:00:00Z");
const goal = (o: Partial<IGoal>): IGoal => ({
  id: "g",
  title: "Goal",
  domain: "learning",
  status: "active",
  weekly_minutes: 120,
  created_at: "2026-08-01T00:00:00Z",
  ...o,
});
const block = (o: Partial<IBlock>): IBlock => ({
  id: Math.random().toString(36).slice(2),
  title: "Session",
  domain: "training",
  goal_id: "g",
  starts_at: "2026-10-01T18:00:00Z",
  duration_min: 60,
  status: "done",
  ...o,
});

describe("routing and knowledge selection", () => {
  it("routes a business goal across career, learning-free finance areas only", () => {
    const r = routeDomains("I want to run my own construction company in three years");
    expect(r.domains).toContain("career");
    expect(r.domains).not.toContain("nutrition");
  });
  it("treats weight loss on rotating shifts as multi-domain", () => {
    const r = routeDomains("I want to lose 15kg but I work rotating shifts");
    expect(r.domains).toEqual(expect.arrayContaining(["weight", "sleep"]));
    expect(r.context).toContain("work_schedule");
    expect(r.multiDomain).toBe(true);
  });
  it("quantity surveyor routes to career and learning, not unrelated areas", () => {
    const r = routeDomains("I want to become a quantity surveyor and need the qualification");
    expect(r.domains).toEqual(expect.arrayContaining(["career", "learning"]));
    expect(r.domains).not.toContain("resistance_training");
  });
  it("caps domains at 4", () => {
    expect(
      routeDomains("money gym sleep study family stress meditate career diet").domains.length,
    ).toBeLessThanOrEqual(4);
  });
});

describe("capability awareness", () => {
  it("booking is Execute-only, others must act", () => {
    expect(capabilityFor("Book me a dentist appointment", "execute").cls).toBe(
      "PLEXECUTE_CAN_BOOK",
    );
    expect(capabilityFor("Book me a dentist appointment", "pro").cls).toBe("MEMBER_MUST_ACT");
  });
  it("deposit becomes a checkout handoff on Execute", () => {
    expect(capabilityFor("Pay the deposit", "execute").cls).toBe("PLEXECUTE_CAN_PREPARE_CHECKOUT");
  });
  it("medical diagnosis needs a professional", () => {
    expect(capabilityFor("Diagnose this rash for me", "execute").cls).toBe("PROFESSIONAL_REQUIRED");
  });
  it("unsupported actions are honest", () => {
    expect(capabilityFor("Transfer money to my brother", "execute").cls).toBe("UNSUPPORTED");
  });
  it("planning and scheduling", () => {
    expect(capabilityFor("I want to become a project manager", "free").cls).toBe(
      "PLEXECUTE_CAN_PLAN",
    );
    expect(capabilityFor("Fit those sessions around my week", "free").cls).toBe(
      "PLEXECUTE_CAN_SCHEDULE",
    );
  });
  it("calls follow existing tier rules", () => {
    expect(capabilityFor("Call me before my exam", "free").cls).toBe("MEMBER_MUST_ACT");
    expect(capabilityFor("Call me before my exam", "pro").cls).toBe("PLEXECUTE_CAN_CALL");
  });
});

describe("relationship graph", () => {
  const goals = [
    goal({
      id: "biz",
      title: "Run my own construction company",
      domain: "business",
      dependencies: ["q"],
    }),
    goal({ id: "q", title: "Complete construction management qualification", domain: "learning" }),
  ];
  const ms: IMilestone[] = [
    {
      id: "m1",
      goal_id: "q",
      key: "a",
      title: "Enrol on course",
      stage: 1,
      depends_on: [],
      done_at: "2026-09-01",
    },
    { id: "m2", goal_id: "q", key: "b", title: "Study module 1", stage: 2, depends_on: ["a"] },
  ];
  const obj = [
    { area: "business", text: "Own a construction company" },
    { area: "travel", text: "See Japan" },
  ];
  const b = block({
    id: "b1",
    title: "Study session",
    domain: "learning",
    goal_id: "q",
    starts_at: "2026-10-14T18:00:00Z",
    status: "planned",
  });
  it("links only real relationships", () => {
    const links = buildLinks(goals, ms, [b], obj);
    expect(
      links.some((l) => l.relation === "requires" && l.from_ref === "biz" && l.to_ref === "q"),
    ).toBe(true);
    expect(links.some((l) => l.to_kind === "vision" && l.to_ref === "1")).toBe(false);
    expect(links.some((l) => l.from_ref === "m2" && l.to_ref === "m1")).toBe(true);
  });
  it("does not manufacture a vision link from area alone", () => {
    expect(
      servesObjective(
        { title: "Learn Spanish", domain: "learning", why: null },
        { area: "education", text: "Finish a degree in law" },
      ),
    ).toBe(false);
  });
  it("explains the chain from session to 5-year direction", () => {
    const r = explainItem(b, goals, ms, obj);
    expect(r.chain).toEqual([
      "Study session",
      "milestone: Study module 1",
      "goal: Complete construction management qualification",
      "needed for goal: Run my own construction company",
      "5-year direction: Own a construction company",
    ]);
  });
  it("orphaned items say their goal is gone", () => {
    expect(explainItem({ ...b, goal_id: "deleted" }, goals, ms, obj).grounded).toBe(false);
  });
  it("invalidates stale links when a goal is removed", () => {
    const before = buildLinks(goals, ms, [b], obj).map((l) => ({ key: linkKey(l) }));
    const after = buildLinks(
      goals.filter((g) => g.id !== "q"),
      ms,
      [b],
      obj,
    );
    const d = diffLinks(before, after);
    expect(d.stale.length).toBeGreaterThan(0);
    expect(after.some((l) => l.goal_id === "q")).toBe(false);
  });
  it("prerequisite issues flag sessions for goals still waiting", () => {
    const p = prerequisiteIssues(goals, ms, [block({ goal_id: "biz", status: "planned" })]);
    expect(p[0]).toMatchObject({ goal: "Run my own construction company", planned_sessions: 1 });
  });
});

describe("conflicts and priorities", () => {
  const house = goal({ id: "h", title: "House deposit", domain: "finance", monthly_saving: 500 });
  const qual = goal({
    id: "q",
    title: "QS qualification",
    domain: "learning",
    deadline: "2027-10-13",
    pathway: { resources: [{ kind: "money", amount: 4800 }] },
  });
  it("detects money conflict with real numbers", () => {
    const r = detectConflicts([house, qual], { monthlyBudget: 600, weeklyCapacityMin: null }, now);
    expect(r.conflicts[0]?.kind).toBe("money");
    expect(r.conflicts[0]?.need).toBeGreaterThan(600);
  });
  it("never claims a conflict without a budget; lists the unknown", () => {
    const r = detectConflicts([house, qual], { monthlyBudget: null, weeklyCapacityMin: null }, now);
    expect(r.conflicts).toEqual([]);
    expect(r.unknowns.length).toBe(1);
  });
  it("time conflict against free capacity", () => {
    const r = detectConflicts(
      [goal({ weekly_minutes: 400 }), goal({ id: "2", weekly_minutes: 300 })],
      { monthlyBudget: null, weeklyCapacityMin: 500 },
      now,
    );
    expect(r.conflicts[0]?.kind).toBe("time");
  });
  it("asks when priorities are equal, suggests when they clearly differ", () => {
    expect(reconcile([house, qual], [], now).decision).toBe("ask");
    expect(
      reconcile(
        [
          { ...house, priority_class: "must" },
          { ...qual, priority_class: "optional" },
        ],
        [],
        now,
      ),
    ).toMatchObject({ decision: "suggest", lead: "House deposit" });
  });
  it("updates when the member changes priorities", () => {
    expect(
      reconcile(
        [
          { ...house, priority_class: "optional" },
          { ...qual, priority_class: "must" },
        ],
        [],
        now,
      ).lead,
    ).toBe("QS qualification");
  });
});

describe("trajectory and metrics", () => {
  it("projects a savings goal and says how late", () => {
    const p = projectGoal(
      goal({
        title: "Save",
        monthly_saving: 100,
        current_value: 1000,
        target_value: 5000,
        deadline: "2027-04-13",
      }),
      [],
      [],
      "Europe/London",
      now,
    );
    expect(p.status).toBe("behind");
    expect(p.weeks_late).toBeGreaterThan(50);
  });
  it("projects from readings", () => {
    const p = projectGoal(
      goal({ target_value: 80, baseline_value: 95, deadline: "2026-11-01" }),
      [
        { value: 95, recorded_at: "2026-09-01" },
        { value: 93, recorded_at: "2026-10-01" },
      ],
      [],
      null,
      now,
    );
    expect(p.status).toBe("behind");
  });
  it("does not project with too little data", () => {
    expect(
      projectGoal(
        goal({ target_value: 80 }),
        [{ value: 90, recorded_at: "2026-10-01" }],
        [],
        null,
        now,
      ).status,
    ).toBe("not_enough_data");
  });
  it("2-4 metrics from real records", () => {
    const m = goalMetrics(
      goal({ target_value: 10, current_value: 3, target_unit: "modules" }),
      [
        block({ starts_at: "2026-10-10T18:00:00Z" }),
        block({ starts_at: "2026-10-11T18:00:00Z", status: "missed" }),
      ],
      [],
      [],
      now,
    );
    expect(m.length).toBeGreaterThanOrEqual(2);
    expect(m.length).toBeLessThanOrEqual(4);
    expect(m[0]!.value).toBe("1 of 2 done");
  });
});

describe("patterns and replanning", () => {
  const evening = ["2026-09-22", "2026-09-24", "2026-09-29", "2026-10-01", "2026-10-06"].map(
    (d, i) => block({ starts_at: `${d}T18:30:00Z`, status: i === 4 ? "done" : "missed" }),
  );
  const morning = ["2026-09-23", "2026-09-30"].map((d) =>
    block({ starts_at: `${d}T07:00:00Z`, status: "done" }),
  );
  it("finds repeated evening misses after shifts", () => {
    const workEnds = Object.fromEntries(evening.map((b) => [b.starts_at.slice(0, 10), [18 * 60]]));
    const r = missPatterns([...evening, ...morning], "UTC", { workEnds });
    expect(r.patterns[0]).toMatchObject({
      band: "evening",
      cause: "after_work_or_shift",
      missed: 4,
    });
  });
  it("does not invent patterns for a new member", () => {
    expect(missPatterns(morning, "UTC")).toEqual({ enough: false, patterns: [] });
  });
  it("feeds a lower adherence to the planner for the failing band", () => {
    const a = patternAdherence(missPatterns([...evening, ...morning], "UTC").patterns);
    expect(a["training"]?.[18]).toEqual({ done: 1, total: 5 });
  });
  it("records rationale for placements", () => {
    const pats = missPatterns([...evening, ...morning], "UTC").patterns;
    const r = planRationale(
      [{ goal_id: "g", starts_at: "2026-10-15T07:00:00Z", duration_min: 60, domain: "training" }],
      { previous: [], energyPeak: "morning", patterns: pats, protectedDays: [], tz: "UTC" },
    );
    expect(r[0]!.reasons.join(" ")).toMatch(/morning energy/);
    expect(r[0]!.reasons.join(" ")).toMatch(/moved away from evening/);
  });
  it("weekly review proposes changes from evidence", () => {
    const pats = missPatterns([...evening, ...morning], "UTC").patterns;
    const w = weeklyReview(
      [...evening, ...morning],
      [goal({ title: "Get stronger" })],
      pats,
      new Date("2026-09-20"),
      new Date("2026-10-13"),
    );
    expect(w.missed).toBe(4);
    expect(w.next_week[0]).toMatch(/training/);
  });
});

describe("alignment, signals, briefing, confidence", () => {
  it("names objectives with nothing active", () => {
    const a = alignment([{ area: "travel", text: "Live abroad" }], [goal({})], []);
    expect(a[0]!.state).toBe("nothing_yet");
  });
  it("keeps proposed goals out of active", () => {
    const a = alignment(
      [{ area: "career", text: "Become a quantity surveyor" }],
      [goal({ status: "proposed", title: "Become a quantity surveyor", domain: "career" })],
      [],
    );
    expect(a[0]).toMatchObject({ state: "proposed_only", active_goals: [] });
  });
  it("signals are restrained (max 3, de-duplicated)", () => {
    const s = proactiveSignals({
      patterns: [],
      projections: [],
      conflicts: [],
      prereq: [],
      goalsWithoutActions: ["a", "b", "c", "d", "a"],
      alignment: [],
    });
    expect(s.length).toBe(3);
  });
  it("daily brief uses given items only and picks a priority", () => {
    const b = dailyBrief({
      today: "2026-10-13",
      items: [
        { time: "18:00", title: "Study", kind: "goal_session" },
        { time: "09:00", title: "Dentist", kind: "appointment" },
      ],
      deadlines: [],
      risks: [],
    });
    expect(b.items[0]!.title).toBe("Dentist");
    expect(b.priority).toBe("18:00 Study");
    expect(dailyBrief({ today: "x", items: [], deadlines: [], risks: [] }).empty).toBe(true);
  });
  it("confidence is never high with unknowns", () => {
    expect(confidenceFrom(3, 0, 0)).toBe("High");
    expect(confidenceFrom(3, 0, 1)).toBe("Medium");
    expect(confidenceFrom(0, 2, 2)).toBe("Low");
  });
  it("intelligence tools are read-only Free tools; existing tier rules unchanged", () => {
    for (const t of [
      "get_life_intelligence",
      "explain_plan_item",
      "brief_my_day",
      "review_my_week",
    ] as const) {
      expect(FREE_TOOLS).toContain(t);
      expect(gateTool(t, "free", 99).allowed).toBe(true);
    }
    expect(gateTool("get_experiments", "free", 0).allowed).toBe(false);
  });
});
