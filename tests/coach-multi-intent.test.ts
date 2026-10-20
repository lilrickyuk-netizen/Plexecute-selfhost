import { describe, it, expect } from "vitest";
import { splitIntents } from "../src/lib/learning-subject";

const systems = (m: string) => splitIntents(m).map((p) => p.system);
describe("Coach multi-intent split", () => {
  it("learning + waitlist research", () => {
    expect(
      systems(
        "I want to learn organic marketing and I want to know where I can put my waiting list for free.",
      ),
    ).toEqual(["learning", "research_execution"]);
    const p = splitIntents(
      "I want to learn organic marketing and find free places to promote my waiting list.",
    );
    expect(p.map((x) => x.system)).toEqual(["learning", "research_execution"]);
    expect(p[0].subject).toBe("organic marketing");
  });
  it("learning + qualification", () => {
    const p = splitIntents(
      "I want to learn project management and find a qualification I can start.",
    );
    expect(p.map((x) => x.system)).toEqual(["learning", "research_execution"]);
    expect(p[0].subject).toBe("project management");
  });
  it("eat better + meal plan is one nutrition intent", () => {
    expect(systems("I want to eat better and make me a meal plan.")).toEqual(["nutrition"]);
  });
  it("single learning request stays single", () => {
    expect(systems("I want to learn Spanish.")).toEqual(["learning"]);
  });
});
