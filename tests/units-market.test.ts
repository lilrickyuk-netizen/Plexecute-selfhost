import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { marketFor } from "../src/lib/billing";
import * as U from "../src/lib/units";

describe("explicit billing country", () => {
  it("stored country wins over time zone", () => {
    expect(marketFor({ billing_country: "US", timezone: "Europe/London" })).toBe("US");
    expect(marketFor({ billing_country: "GB", timezone: "America/New_York" })).toBe("GB");
    expect(marketFor({ timezone: "America/Chicago" })).toBe("US");
    expect(marketFor(null)).toBe("GB");
  });
  it("billing code never picks currency from time zone alone", () => {
    for (const f of ["src/lib/billing.functions.ts", "src/lib/reward.server.ts"])
      expect(readFileSync(f, "utf8")).not.toMatch(/marketForTimezone\(/);
    expect(readFileSync("src/lib/billing.functions.ts", "utf8")).toMatch(
      /billing_address_collection: "required"/,
    );
    expect(readFileSync("src/lib/stripe-events.server.ts", "utf8")).toMatch(
      /billing_country_source: "checkout"/,
    );
  });
});

describe("imperial units", () => {
  it("converts weight, height, distance and temperature, storing metric", () => {
    expect(U.fmtWeight(100, "imperial")).toBe("220.5 lb");
    expect(U.displayToKg(220.462262, "imperial")).toBeCloseTo(100, 3);
    expect(U.fmtHeight(180, "imperial")).toBe("5 ft 11 in");
    expect(U.ftInToCm(5, 11)).toBeCloseTo(180.3, 1);
    expect(U.fmtDistance(10, "imperial")).toBe("6.2 mi");
    expect(U.fmtTemp(37, "imperial")).toBe("98.6°F");
    expect(U.fmtWeight(100, "metric")).toBe("100 kg");
  });
});

describe("country mismatch guard", () => {
  it("checkout and top-up refuse a purchase unless the confirmed address country matches", () => {
    const s = readFileSync("src/lib/billing.functions.ts", "utf8");
    expect(s.match(/countryConfirmed !== (B\.)?marketFor/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(s.match(/country_mismatch/g)?.length).toBe(2);
    expect(readFileSync("src/routes/_authenticated/app.billing.tsx", "utf8")).toMatch(
      /Billing address confirmation/,
    );
  });
  it("reward card uses the member's currency", () => {
    const s = readFileSync("src/components/ExecutionReward.tsx", "utf8");
    expect(s).not.toMatch(/£10/);
    expect(s).toMatch(/marketFor/);
  });
});
