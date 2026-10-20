import { describe, it, expect } from "vitest";
import * as M from "../src/lib/mission";

describe("Goal Mission acceptance scenarios", () => {
  it("A: own a business → clarify first, business+finance+time routing", () => {
    const t = "I want to own my own business";
    expect(M.isVagueDream(t)).toBe(true);
    const q = M.clarifiersFor(t);
    expect(q.length).toBeGreaterThan(0);
    expect(q.length).toBeLessThanOrEqual(3);
    const e = M.routeExperts(t);
    expect(e).toContain("business");
    expect(e).toContain("time");
  });
  it("B: financial freedom → never defined for the member; contract not ready until facts given", () => {
    const t = "I want financial freedom";
    expect(M.isVagueDream(t)).toBe(true);
    expect(M.clarifiersFor(t)[0]!.question).toMatch(/look like/);
    const c = M.buildContract({ desired_outcome: t });
    expect(M.readyForPathway(c)).toBe(false);
    expect(c.confidence).toBe("LOW");
    const c2 = M.mergeContract(c, {
      definition_of_done: "£3,000/month passive income",
      target_horizon: "10 years",
      current_state: "£2,400 take-home, £8k debt",
    });
    expect(M.readyForPathway(c2)).toBe(true);
    expect(c2.unknowns).not.toContain("target date");
  });
  it("C: quantity surveyor → research required before planning; routes compared", () => {
    const t = "I want to become a quantity surveyor";
    expect(M.needsResearch(t)).toBe(true);
    expect(M.routeExperts(t)).toContain("research");
    const r = M.compareRoutes(
      [
        {
          key: "degree",
          name: "Degree",
          months: 36,
          cost: 27000,
          needs: ["A-levels"],
          risk: "low",
          fits_schedule: false,
        },
        {
          key: "apprentice",
          name: "Degree apprenticeship",
          months: 48,
          cost: 0,
          needs: ["employer"],
          risk: "medium",
          fits_schedule: true,
        },
        {
          key: "industry",
          name: "Industry experience + RICS APC",
          months: 30,
          cost: 3000,
          needs: ["construction experience"],
          risk: "medium",
          fits_schedule: true,
        },
      ],
      { budget: 5000, horizonMonths: 36, has: ["construction experience"] },
    );
    expect(r.recommended).toBe("industry");
    expect(r.ranked[0]!.why.length).toBeGreaterThan(0);
  });
  it("D: write a book → execution-ready actions only, vague tasks rejected", () => {
    expect(
      M.actionProblems({
        objective: "Book",
        action: "Work on book",
        first_step: "",
        minutes: 30,
        done_when: "",
      }),
    ).toContain("exact action (too vague)");
    expect(
      M.actionProblems({
        objective: "Draft chapter 1",
        action: "Write 800 words of chapter 1 using the outline headings",
        first_step: "Open the outline",
        minutes: 45,
        done_when: "800 words saved",
      }),
    ).toEqual([]);
    expect(M.evidenceFor("write chapter draft", "medium")).toBe("saved_output");
  });
  it("E: get fit → clarify constraints, fitness route, workouts need logged evidence", () => {
    expect(M.isVagueDream("I want to get fit")).toBe(true);
    expect(M.clarifiersFor("I want to get fit").some((q) => /injur/.test(q.question))).toBe(true);
    expect(M.tierFor(M.routeExperts("I want to get fit"))).toBe("simple");
    expect(M.evidenceFor("gym workout", "low")).toBe("workout_logged");
  });
  it("F: leave job to start construction company → council, disagreement saved", () => {
    const t = "I want to leave my job and start a construction company";
    const e = M.routeExperts(t);
    expect(M.tierFor(e)).toBe("complex");
    expect(e).toEqual(
      expect.arrayContaining(["career", "business", "finance", "risk", "research"]),
    );
    const c = M.synthesise(
      [
        { expert: "business", stance: "Start trading sooner", urgency: "now" },
        {
          expert: "finance",
          stance: "Keep salary",
          constraint: "6 months of costs saved before leaving employment",
        },
        { expert: "time", stance: "Evenings only", constraint: "5 hours a week available" },
      ],
      "Start part-time while employed, leave once 6 months saved",
    );
    expect(c.disagreements.length).toBe(2);
    expect(c.rationale).toMatch(/6 months/);
    expect(c.selected_route).toMatch(/part-time/);
  });
});

describe("Mission state, blockers, root cause, signals", () => {
  it("never jumps to achieved", () => {
    expect(M.canMove("EXECUTING", "ACHIEVED")).toBe(false);
    expect(M.canMove("VERIFYING", "ACHIEVED")).toBe(true);
    expect(M.canMove("CAPTURED", "SCHEDULED")).toBe(false);
  });
  it("labels blockers with a route around", () => {
    expect(M.classifyBlocker("learning", "Prerequisite qualification missing").kind).toBe(
      "RESOLVABLE",
    );
    expect(M.classifyBlocker("money", "Course costs more than budget").route_around).toMatch(
      /Save first/,
    );
    expect(M.classifyBlocker("eligibility", "Entry age not yet known").kind).toBe("UNKNOWN");
  });
  it("finds root cause instead of moving sessions", () => {
    const rc = M.rootCause([
      { status: "missed", reason: "work meeting overran" },
      { status: "missed", reason: "busy at work" },
      { status: "done" },
    ]);
    expect(rc.cause).toBe("time_conflict");
    expect(
      M.rootCause([
        { status: "missed", planned_minutes: 90 },
        { status: "skipped", planned_minutes: 75 },
      ]).cause,
    ).toBe("too_long");
  });
  it("raises at most one useful proactive note", () => {
    const s = M.missionSignals({
      title: "QS",
      state: "EXECUTING",
      openPrereqs: [
        { title: "APC application", due: new Date(Date.now() + 12 * 86400000).toISOString() },
      ],
      nextSessionAt: null,
      now: new Date(),
    });
    expect(s.length).toBe(1);
    expect(s[0]!.message).toMatch(/12 days/);
  });
});
