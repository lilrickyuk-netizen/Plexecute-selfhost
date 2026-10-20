import { describe, it, expect } from "vitest";
import { trustOf, quoteVerified } from "../src/lib/research";
describe("research provenance", () => {
  it("classes trust by domain", () => {
    expect(trustOf("https://www.gov.uk/x").trust).toBe("official");
    expect(trustOf("https://www.ox.ac.uk/a").trust).toBe("education");
    expect(trustOf("https://random-blog.com/a").trust).toBe("other");
    expect(trustOf("https://www.icaew.com/aca").trust).toBe("professional_body");
    expect(trustOf("https://en.wikipedia.org/wiki/ICAEW").trust).toBe("other");
  });
  it("only verbatim quotes count", () => {
    expect(
      quoteVerified("You must pass 13 exams", "Students:  you must pass 13 exams in total"),
    ).toBe(true);
    expect(quoteVerified("You must pass 14 exams", "you must pass 13 exams")).toBe(false);
  });
});
