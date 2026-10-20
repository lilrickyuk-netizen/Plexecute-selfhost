import { describe, expect, it } from "vitest";

describe("Public SEO Audit", () => {
  it("has robots.txt with sitemap reference", async () => {
    const fs = await import("fs/promises");
    const robots = await fs.readFile("public/robots.txt", "utf-8");
    expect(robots).toContain("Sitemap: https://plexecute.io/sitemap.xml");
    // Crawlers must be able to read noindex on auth pages.
    expect(robots).toContain("User-agent: Googlebot");
    expect(robots).not.toContain("Disallow: /");
  });

  it("defines sitemap routes correctly", async () => {
    const fs = await import("fs/promises");
    const sitemap = await fs.readFile("src/routes/sitemap[.]xml.ts", "utf-8");
    expect(sitemap).toContain("/pricing");
    expect(sitemap).toContain("/privacy");
    expect(sitemap).toContain("/terms");
  });

  it("root metadata contains basic SEO tags", async () => {
    const fs = await import("fs/promises");
    const root = await fs.readFile("src/routes/__root.tsx", "utf-8");
    expect(root).toContain('name: "viewport"');
    expect(root).toContain('name: "description"');
  });

  it("authenticated app layout is noindexed", async () => {
    const fs = await import("fs/promises");
    const appLayout = await fs.readFile("src/routes/_authenticated/app.tsx", "utf-8");
    expect(appLayout).toContain('name: "robots", content: "noindex, nofollow"');
  });
});
