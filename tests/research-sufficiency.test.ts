import { describe, expect, it } from "vitest";
import {
  researchQueries,
  researchSourceType,
  researchSourceKey,
  retainResearchLinks,
  quoteVerified,
  researchEvidenceText,
} from "../src/lib/research";

describe("research source sufficiency", () => {
  it("bounds discovery text without losing source indices or original quote evidence", () => {
    const pages = Array.from({ length: 30 }, (_, i) => ({
      url: `https://example.com/source/${i}`,
      markdown: "x".repeat(4200) + "Free posting is permitted",
      category: `category ${i}`,
    }));
    const text = researchEvidenceText(pages);
    expect(text.length).toBeLessThan(54000);
    for (const [i, page] of pages.entries()) expect(text).toContain(`[${i}] ${page.url}`);
    expect(quoteVerified("Free posting is permitted", pages[0].markdown)).toBe(true);
    expect(researchEvidenceText([pages[0]], true)).toContain("Free posting is permitted");
  });
  it("retains checked research links when a summary omits attribution, without changing its claims", () => {
    expect(
      retainResearchLinks("Requirements vary.", ["https://www.apm.org.uk/qualifications/"]),
    ).toBe("Requirements vary.\n\nSource: [apm.org.uk](https://www.apm.org.uk/qualifications/)");
    expect(retainResearchLinks("A stable definition.", [])).toBe("A stable definition.");
    expect(retainResearchLinks("[APM](https://www.apm.org.uk/)", ["https://www.apm.org.uk/"])).toBe(
      "[APM](https://www.apm.org.uk/)",
    );
  });
  it("never appends a source dump when Coach already cited a link", () => {
    expect(
      retainResearchLinks("See [NHS](https://www.nhs.uk/a).", [
        "https://www.nhs.uk/b",
        "https://digital.nhs.uk/c",
      ]),
    ).toBe("See [NHS](https://www.nhs.uk/a).");
  });
  it("preserves independent vacancy IDs while removing only tracking parameters", () => {
    expect(researchSourceKey("https://jobs.example.com/detail?JobId=123&utm_source=search")).toBe(
      "https://jobs.example.com/detail?JobId=123",
    );
    expect(researchSourceKey("https://jobs.example.com/detail?JobId=123")).not.toBe(
      researchSourceKey("https://jobs.example.com/detail?JobId=456"),
    );
  });
  it("preserves independent employer, qualification and learning searches", () => {
    const qs = researchQueries(
      [
        { query: "UK project manager current job requirements", category: "employer" },
        { query: "APM PMI qualification routes", category: "professional" },
        { query: "UK project management courses", category: "education" },
      ],
      "project manager",
    );
    expect(qs.map((q) => q.category)).toEqual(["employer", "professional", "education"]);
    expect(qs).toHaveLength(3);
  });
  it("keeps distinct AI, founder, productivity, launch and forum searches", () => {
    const qs = researchQueries(
      [
        "AI communities",
        "founder communities",
        "productivity communities",
        "launch platforms",
        "relevant forums",
      ].map((query) => ({ query, category: query })),
      "promotion",
    );
    expect(qs.map((q) => q.query)).toEqual([
      "AI communities",
      "founder communities",
      "productivity communities",
      "launch platforms",
      "relevant forums",
    ]);
  });
  it("deduplicates only matching search wording and bounds initial fan-out", () => {
    expect(
      researchQueries(
        [{ query: " UK jobs " }, { query: "uk jobs" }, { query: "APM routes" }],
        "fallback",
      ).map((q) => q.query),
    ).toEqual(["UK jobs", "APM routes"]);
    expect(
      researchQueries(
        Array.from({ length: 8 }, (_, i) => ({ query: `source ${i}` })),
        "fallback",
      ),
    ).toHaveLength(5);
  });
  it("recognises source diversity without turning missing fields into disqualification", () => {
    expect(researchSourceType("https://www.apm.org.uk/qualifications/")).toBe("professional_body");
    expect(researchSourceType("https://jobs.example.com/project-manager")).toBe(
      "employer_or_job_listing",
    );
    expect(researchSourceType("https://www.reddit.com/r/productivity/")).toBe("community_or_forum");
    expect(quoteVerified("Free posting is permitted", "This page lacks pricing information")).toBe(
      false,
    );
  });
});
