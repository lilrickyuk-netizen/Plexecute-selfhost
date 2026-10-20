import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("member Learning (pick any subject) and hidden Knowledge", () => {
  const page = readFileSync("src/routes/_authenticated/app.learning.tsx", "utf8");
  const fns = readFileSync("src/lib/learn-resources.functions.ts", "utf8");

  it("lets the member pick any subject and level", () => {
    expect(page).toContain("What do you want to learn?");
    expect(page).toContain("beginner");
    expect(page).toContain("intermediate");
    expect(page).toContain("advanced");
    expect(page).toContain("findLearningResources");
  });

  it("no longer renders the fixed lesson catalogue", () => {
    expect(page).not.toContain("LESSONS");
    expect(page).not.toContain("lesson_progress");
  });

  it("finds real resources live and never invents links", () => {
    expect(fns).toContain("firecrawl");
    expect(fns).toContain("never invent or guess a url");
    // every returned URL must appear in a fetched page
    expect(fns).toContain("pageText.includes(url)");
    expect(fns).toContain("recordUsage");
    expect(fns).toContain("learning_resources");
  });

  it("persists searches so members can revisit them", () => {
    expect(fns).toContain('from("learning_searches")');
    expect(page).toContain("Your past searches");
  });

  it("removes Knowledge from all member entry points", () => {
    for (const path of ["app.tsx", "app.more.tsx", "app.today.tsx"]) {
      expect(readFileSync(`src/routes/_authenticated/${path}`, "utf8")).not.toContain(
        'to="/app/knowledge"',
      );
      expect(readFileSync(`src/routes/_authenticated/${path}`, "utf8")).not.toContain(
        'to: "/app/knowledge"',
      );
    }
    const legacy = readFileSync("src/routes/_authenticated/app.knowledge.tsx", "utf8");
    expect(legacy).toContain('throw redirect({ to: "/app/today", replace: true })');
    expect(legacy).not.toContain("CHUNKS");
    expect(readFileSync("src/routes/_authenticated/app.admin.tsx", "utf8")).toContain(
      '"/app/admin/knowledge"',
    );
  });
});
