import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(`src/routes/${file}`, "utf8");

describe("Public search metadata", () => {
  it.each(["index", "pricing", "how-it-works", "safety", "privacy", "terms", "legal.index"])(
    "%s has a leaf canonical on the public domain",
    (file) => {
      const source = read(`${file}.tsx`);
      expect(source).toContain('rel: "canonical"');
      expect(source).toContain("https://plexecute.io/");
      expect(source).toContain('property: "og:url"');
    },
  );
  it("keeps dynamic legal documents self-referencing", () => {
    const source = read("legal.$doc.tsx");
    expect(source).toContain("encodeURIComponent(d.slug)");
    expect(source).toContain('rel: "canonical", href: url');
  });
  it("does not inherit a homepage canonical or image across all pages", () => {
    const source = read("__root.tsx");
    expect(source).not.toContain('rel: "canonical"');
    expect(source).not.toContain('property: "og:image"');
  });
  it("describes the real product without fabricated reviews", () => {
    const source = read("index.tsx");
    expect(source).toContain('type: "application/ld+json"');
    expect(source).toContain('"@type": "SoftwareApplication"');
    expect(source).not.toContain("aggregateRating");
  });
  it("keeps login, recovery and the entire member subtree out of search", () => {
    for (const file of ["login.tsx", "reset-password.tsx", "_authenticated/route.tsx"]) {
      expect(read(file)).toMatch(/name: "robots", content: "noindex/);
    }
  });
  it("preserves a public-only sitemap without artificial modification dates", () => {
    const source = read("sitemap[.]xml.ts");
    expect(source).toContain('const BASE_URL = "https://plexecute.io"');
    expect(source).not.toContain("<lastmod>");
    expect(source).not.toMatch(/STATIC_PATHS\s*=.*\/app/);
  });
});
