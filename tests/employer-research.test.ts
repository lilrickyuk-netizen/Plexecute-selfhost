import { describe, it, expect } from "vitest";
import {
  currentEmployerQuestion,
  verifyEmployerEvidence,
  employerCoverage,
  employerIdentity,
} from "../src/lib/employer-research";
const now = new Date("2026-10-16T23:10:00Z");
const check = (text: string, closing: string | null = "2026-10-30") =>
  verifyEmployerEvidence(
    [{ source: 0, employer: "Example", status: "open", closing_date: closing, status_quote: text }],
    [{ markdown: text }],
    now,
  )[0];
describe("current employer evidence", () => {
  it("counts a parent employer and its division only once", () => {
    expect(employerIdentity("M Group Ltd (Telent)")).toBe(employerIdentity("M Group"));
    expect(employerIdentity("J Murphy & Sons Limited")).not.toBe(employerIdentity("M Group"));
  });
  it("excludes expired adverts from current primary evidence", () => {
    expect(check("Closing date 1 October 2026", "2026-10-01")?.status).toBe("closed");
  });
  it("excludes explicitly closed adverts even with a future date", () => {
    expect(check("This vacancy is now closed. Apply now.")?.status).toBe("closed");
  });
  it("does not accept an invented open status quote", () => {
    expect(
      verifyEmployerEvidence(
        [
          {
            source: 0,
            employer: "A",
            status: "open",
            closing_date: "2026-11-01",
            status_quote: "Applications open until November",
          },
        ],
        [{ markdown: "General careers page" }],
        now,
      )[0]?.status,
    ).toBe("unknown");
  });
  it("accepts verified future-closing adverts", () => {
    expect(check("Closing date 30 October 2026")?.status).toBe("open");
  });
  it("accepts a verified active application route without inventing a date", () => {
    expect(check("Apply now", null)?.status).toBe("open");
  });
  it("requires three distinct employers across multiple sources", () => {
    const ev = verifyEmployerEvidence(
      [0, 1, 2].map((source) => ({
        source,
        employer: "Same employer",
        status: "open",
        status_quote: "Apply now",
      })),
      [0, 1, 2].map(() => ({ markdown: "Apply now" })),
      now,
    );
    expect(
      employerCoverage(ev, [
        { url: "https://jobs.a.com/1" },
        { url: "https://jobs.b.com/2" },
        { url: "https://jobs.c.com/3" },
      ]).sufficient,
    ).toBe(false);
    ev[1] = { ...(ev[1] as (typeof ev)[number]), employer: "Second" };
    ev[2] = { ...(ev[2] as (typeof ev)[number]), employer: "Third" };
    expect(
      employerCoverage(ev, [
        { url: "https://jobs.a.com/1" },
        { url: "https://jobs.b.com/2" },
        { url: "https://jobs.c.com/3" },
      ]).sufficient,
    ).toBe(true);
  });
  it("leaves other research questions outside the scoped policy", () => {
    expect(currentEmployerQuestion("Find free places to promote my platform")).toBe(false);
    expect(currentEmployerQuestion("What qualifications are employers asking for now?")).toBe(true);
  });
});
