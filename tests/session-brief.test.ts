import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildSessionBrief,
  briefForCoach,
  currentMilestone,
  nextTopics,
  type BriefInput,
} from "@/lib/session-brief";
import { FREE_TOOLS } from "@/lib/coach-tools";

const block = (o: Partial<BriefInput["block"]> = {}): BriefInput["block"] => ({
  id: "b1",
  title: "Learn coding",
  occurrence_kind: "learning",
  domain: "learning",
  status: "planned",
  starts_at: "2026-10-14T18:00:00Z",
  duration_min: 60,
  goal_id: "g1",
  commitment_id: null,
  ...o,
});
const goal = {
  id: "g1",
  title: "Learn Python",
  why: "Move into data work",
  success_definition: null,
  domain: "learning",
};
const topics = [
  { id: "t1", title: "Variables, input and output", position: 0, done_at: null, parent_id: null },
  { id: "t2", title: "Conditionals", position: 1, done_at: null, parent_id: null },
];

describe("execution-ready sessions", () => {
  it("learning: exact first topic, beginner level, real resource, Start lesson, completion", () => {
    const s = buildSessionBrief({
      block: block(),
      goal,
      topics,
      learningResources: [
        {
          title: "Python tutorial",
          url: "https://docs.python.org/3/tutorial/",
          kind: "article",
          done_units: 0,
          total_units: null,
        },
      ],
    });
    expect(s.objective).toContain("Variables, input and output");
    expect(s.details[0]!.items[0]).toMatch(/beginning/);
    expect(s.primary).toEqual({
      type: "href",
      label: "Start lesson",
      url: "https://docs.python.org/3/tutorial/",
    });
    expect(s.completion).toMatch(/practice exercise/);
    expect(s.next).toContain("Conditionals");
    expect(s.why.join(" ")).toContain("Learn Python");
    expect(s.ready).toBe(true);
  });
  it("existing learner: skips completed topics", () => {
    const t = [{ ...topics[0]!, done_at: "2026-10-01" }, topics[1]!];
    const s = buildSessionBrief({ block: block(), goal, topics: t, learningResources: [] });
    expect(s.objective).toContain("Conditionals");
    expect(s.objective).not.toContain("Variables");
    expect(nextTopics(t).done).toBe(1);
  });
  it("never invents a link: missing resource is said honestly and Coach is the action", () => {
    const s = buildSessionBrief({
      block: block(),
      goal,
      topics,
      learningResources: [
        { title: "Book", url: null, kind: "book", done_units: 0, total_units: null },
        { title: "bad", url: "javascript:alert(1)", kind: "x", done_units: 0, total_units: null },
      ],
    });
    expect(s.resources).toEqual([]);
    expect(s.missing).toContain("Resource still needs confirming.");
    expect(s.primary.type).toBe("coach");
    expect(s.ready).toBe(false);
  });
  it("milestone sessions (career/business) use the real next action, evidence and sources", () => {
    const ms = [
      {
        id: "m1",
        key: "a",
        title: "Compare QS routes",
        status: "pending",
        stage: 1,
        position: 0,
        depends_on: [],
        actions: [{ title: "Compare entry requirements, duration and cost", minutes: 45 }],
        sources: [{ url: "https://www.rics.org/", title: "RICS pathways", publisher: "RICS" }],
        evidence_type: "self_report",
        blocked_reason: null,
      },
      {
        id: "m2",
        key: "b",
        title: "Apply to course",
        status: "pending",
        stage: 2,
        position: 0,
        depends_on: ["a"],
        actions: [],
        sources: [],
        evidence_type: null,
        blocked_reason: null,
      },
    ];
    const s = buildSessionBrief({
      block: block({
        occurrence_kind: "work_task",
        domain: "career",
        title: "Work on career goal",
      }),
      goal: { ...goal, title: "Become a QS" },
      milestones: ms,
    });
    expect(s.objective).toBe("Compare entry requirements, duration and cost.");
    expect(s.resources[0]!.url).toBe("https://www.rics.org/");
    expect(s.next).toContain("Apply to course");
    expect(s.primary.label).toBe("Start task");
    expect(currentMilestone(ms).current!.id).toBe("m1");
  });
  it("prerequisites: a blocked dependency is reported, not scheduled as if done", () => {
    const ms = [
      {
        id: "m2",
        key: "b",
        title: "Apply",
        status: "pending",
        stage: 2,
        position: 0,
        depends_on: ["a"],
        actions: [],
        sources: [],
        evidence_type: null,
        blocked_reason: null,
      },
    ];
    const s = buildSessionBrief({
      block: block({ occurrence_kind: "work_task", domain: "career" }),
      goal,
      milestones: ms,
    });
    expect(s.missing[0]).toMatch(/waiting on an earlier step/);
  });
  it("workout surfaces actual exercises and Start workout", () => {
    const s = buildSessionBrief({
      block: block({
        occurrence_kind: "workout",
        domain: "training",
        title: "Upper body",
        goal_id: null,
      }),
      workout: {
        name: "Upper body",
        day: 0,
        exercises: [
          { name: "Bench press", sets: 4, reps: "8" },
          { name: "Lat pulldown", sets: 4, reps: "10" },
        ],
      },
    });
    expect(s.details[0]!.items).toEqual(["Bench press — 4×8", "Lat pulldown — 4×10"]);
    expect(s.primary.label).toBe("Start workout");
  });
  it("meal prep surfaces meals, have/need and prep steps", () => {
    const s = buildSessionBrief({
      block: block({
        occurrence_kind: "meal_prep",
        domain: "meal_prep",
        title: "Meal prep",
        goal_id: null,
      }),
      prep: {
        label: "Sun",
        cook: [
          { name: "Rice", grams: 300 },
          { name: "Chicken breast", grams: 450 },
        ],
        creates: ["3 × Chicken rice bowl"],
        have: ["Rice"],
        shopping: ["Broccoli — 300 g"],
        minutes: 55,
      },
    });
    expect(s.objective).toContain("Chicken rice bowl");
    expect(s.details.map((d) => d.label)).toEqual(["Cook", "You already have", "Still needed"]);
    expect(s.primary.label).toBe("Start prep");
  });
  it("booking and journey are surfaced on the session", () => {
    const s = buildSessionBrief({
      block: block({
        occurrence_kind: "appointment_prep",
        domain: "admin",
        title: "Dentist",
        goal_id: null,
        commitment_id: "c1",
      }),
      booking: {
        id: "k",
        service: "Dental check-up",
        status: "requested",
        provider_name: null,
        kind: "appointment",
        checkout_url: null,
        checkout_expires_at: null,
      },
      journey: {
        id: "j",
        dest_label: "Dental clinic",
        leave_at: "2026-10-14T13:15:00Z",
        duration_min: 31,
        buffer_min: 14,
        mode: "transit",
        status: "planned",
      },
    });
    expect(s.primary.label).toBe("Book now");
    expect(s.secondary.some((c) => c.label === "Open journey")).toBe(true);
    expect(s.details.find((d) => d.label === "Journey")!.items).toContain(
      "Travel 31 min by transit",
    );
  });
  it("status truth: finished sessions have no start action; started ones offer completion", () => {
    expect(buildSessionBrief({ block: block({ status: "done" }), goal, topics }).primary.type).toBe(
      "coach",
    );
    expect(
      buildSessionBrief({
        block: block({
          status: "started",
          occurrence_kind: "personal_task",
          domain: "admin",
          goal_id: null,
        }),
      }).primary.type,
    ).toBe("complete");
  });
  it("one primary action and at most three secondary", () => {
    const s = buildSessionBrief({
      block: block({ occurrence_kind: "workout", domain: "training", goal_id: null }),
    });
    expect(s.secondary.length).toBeLessThanOrEqual(3);
    expect(s.missing[0]).toMatch(/training programme/);
  });
  it("Coach gets a session-aware tool, free and grounded", () => {
    expect(FREE_TOOLS).toContain("get_session_brief");
    const c = briefForCoach(
      buildSessionBrief({ block: block(), goal, topics, learningResources: [] }),
    );
    expect(c.first_step).toContain("Variables");
    expect(c.rule).toMatch(/never invent links/);
  });
  it("cost control and single source: no AI calls or new tables in the brief", () => {
    const src =
      readFileSync("src/lib/session-brief.server.ts", "utf8") +
      readFileSync("src/lib/session-brief.ts", "utf8");
    expect(src).not.toMatch(/ai-budget|gateway|openai|gemini|\.insert\(|\.update\(/i);
  });
});
describe("goals without structure", () => {
  it("are flagged honestly with one action to build the pathway", () => {
    const s = buildSessionBrief({
      block: block({ occurrence_kind: "work_task", domain: "career", title: "Become a developer" }),
      goal: { ...goal, title: "Become a developer" },
      milestones: [],
      topics: [],
    });
    expect(s.missing[0]).toMatch(/no step-by-step pathway/);
    expect(s.primary).toEqual({ type: "coach", label: "Build my pathway" });
    expect(s.ready).toBe(false);
  });
});
import { starterFor, PYTHON_BASICS, topicTag } from "@/lib/starter-pathways";
describe("starter pathways for new members", () => {
  it("coding goal gets a beginner syllabus with official https links", () => {
    const s = starterFor("Learn coding", "learning")!;
    expect(s.topics![0]!.title).toMatch(/variables/);
    for (const t of s.topics!)
      expect(t.resource.url).toMatch(/^https:\/\/(docs\.python\.org|cs50\.harvard\.edu)\//);
    expect(
      starterFor("Become a full-stack software developer", "career")!.milestones![0]!.depends_on,
    ).toEqual([]);
    expect(starterFor("Learn to paint watercolours", "learning")).toBeNull();
  });
  it("first session after seeding is executable: topic resource, steps, next", () => {
    const topics = PYTHON_BASICS.map((t, i) => ({
      id: `t${i}`,
      title: t.title,
      position: i,
      done_at: null,
      parent_id: null,
    }));
    const res = PYTHON_BASICS.map((t) => ({
      title: t.resource.title,
      url: t.resource.url,
      kind: t.resource.kind,
      content: topicTag(t.title),
      done_units: 0,
      total_units: null,
    }));
    const s = buildSessionBrief({ block: block(), goal, topics, learningResources: res });
    expect(s.primary).toMatchObject({
      label: "Start lesson",
      url: "https://docs.python.org/3/tutorial/introduction.html",
    });
    expect(s.steps[0]).toMatch(/informal introduction/);
    expect(s.next).toMatch(/Conditions/);
    expect(s.ready).toBe(true);
    const later = buildSessionBrief({
      block: block(),
      goal,
      topics: topics.map((t, i) => (i === 0 ? { ...t, done_at: "x" } : t)),
      learningResources: res,
    });
    expect(later.primary).toMatchObject({
      url: "https://docs.python.org/3/tutorial/controlflow.html",
    });
  });
});
