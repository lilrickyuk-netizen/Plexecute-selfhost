import { describe, expect, it } from "vitest";
import {
  isChannelQuery,
  isLocalDirectory,
  isLocalProduct,
  researchSearchQuery,
  isInformationOnly,
} from "@/lib/research";

describe("promotion research relevance", () => {
  it("honours an explicit research-only instruction even when it names prohibited scheduling", () => {
    expect(
      isInformationOnly(
        "Research current marketing destinations. Information only; do not schedule or change my plan.",
      ),
    ).toBe(true);
    expect(
      isInformationOnly("Research marketing destinations and schedule three tasks tomorrow."),
    ).toBe(false);
  });
  it("channel searches describe the product, not '<country> requirements'", () => {
    const q = researchSearchQuery(
      "free places to promote my waiting list",
      "United Kingdom",
      "pre-launch AI life execution platform",
    );
    expect(q).toContain("AI life execution platform");
    expect(q).not.toContain("requirements");
    expect(q).toContain("free places to promote my waiting list");
    expect(q).not.toContain("United Kingdom");
  });
  it("qualification research keeps jurisdiction requirements", () => {
    expect(researchSearchQuery("become a nurse", "United Kingdom")).toBe(
      "become a nurse United Kingdom",
    );
  });
  it("local directories are recognised and only local products are local", () => {
    expect(isLocalDirectory("https://www.yelp.co.uk/biz")).toBe(true);
    expect(isLocalDirectory("https://business.google.com/create")).toBe(true);
    expect(isLocalDirectory("https://www.reddit.com/r/SideProject")).toBe(false);
    expect(isLocalProduct("pre-launch AI life execution platform")).toBe(false);
    expect(isLocalProduct("my local bakery")).toBe(true);
    expect(isChannelQuery("Find free places to promote my waiting list")).toBe(true);
  });
});
