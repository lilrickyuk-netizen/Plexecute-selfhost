import { describe, it, expect } from "vitest";
import { supportFor, looksUrgent, cleanDiagnostics } from "../src/lib/support";

describe("V3 §5.11 support model", () => {
  it("uses the locked targets per plan", () => {
    expect(supportFor("free").target).toBe("3 business days");
    expect(supportFor("pro").target).toBe("1 business day");
    expect(supportFor("execute")).toMatchObject({
      priority: "priority",
      target: "4 business hours during support hours (8am to 8pm, every day)",
    });
    expect(supportFor(undefined).target).toBe("3 business days");
  });
  it("routes urgent wording to emergency guidance", () => {
    expect(looksUrgent("I have chest pain")).toBe(true);
    expect(looksUrgent("My billing date is wrong")).toBe(false);
  });
  it("keeps only technical diagnostics", () => {
    const d = cleanDiagnostics({
      page: "/app/today?x=secret",
      online: true,
      ...({ food: "pizza" } as object),
    });
    expect(d?.page).toBe("/app/today");
    expect(JSON.stringify(d)).not.toContain("pizza");
  });
});
