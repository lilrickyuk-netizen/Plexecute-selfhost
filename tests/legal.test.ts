import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { LEGAL_DOCS, RETENTION, SUBPROCESSORS, legalDoc } from "@/lib/legal";
import { CONSENT_VERSIONS } from "@/lib/consent";
import { PRODUCTS, gbp } from "@/lib/billing";
import { CALL_CONSENT_VERSION } from "@/lib/calling";

describe("step 90 legal surfaces", () => {
  it("includes every required document", () => {
    for (const s of [
      "terms",
      "privacy",
      "cookies",
      "health-disclaimer",
      "ai",
      "calling",
      "subscriptions",
      "data-rights",
      "accessibility",
      "subprocessors",
    ])
      expect(legalDoc(s), s).toBeTruthy();
  });
  it("versions tie to the consents members actually give", () => {
    expect(legalDoc("terms")!.version).toBe(CONSENT_VERSIONS.terms_and_privacy);
    expect(legalDoc("calling")!.version).toBe(CALL_CONSENT_VERSION);
  });
  it("unapproved text is labelled, never presented as final", () => {
    for (const d of LEGAL_DOCS) expect(["awaiting_approved_copy", "approved"]).toContain(d.status);
    expect(readFileSync("src/components/LegalDocView.tsx", "utf8")).toContain(
      'doc.status !== "approved"',
    );
  });
  it("prices come from the locked manifest", () => {
    const subs = JSON.stringify(legalDoc("subscriptions"));
    expect(subs).toContain(gbp(PRODUCTS.pro.month.pence));
    expect(subs).toContain(gbp(PRODUCTS.execute.month.pence));
    expect(subs).toContain("£49.99");
  });
  it("retention schedule matches the database job", () => {
    const sql = readdirSync("supabase/migrations")
      .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8"))
      .join("\n");
    const job = sql.slice(sql.lastIndexOf("FUNCTION public.apply_retention"));
    for (const [t, i] of [
      ["coach_messages", "12 months"],
      ["notifications", "12 months"],
      ["call_logs", "24 months"],
      ["health_samples", "24 months"],
      ["coach_tool_calls", "90 days"],
    ])
      expect(job).toMatch(new RegExp(`${t} WHERE created_at < now\\(\\) - interval '${i}'`));
    expect(RETENTION.length).toBeGreaterThan(5);
  });
  it("every outside service the app calls is listed as a subprocessor", () => {
    const names = SUBPROCESSORS.map((s) => s.name).join(" ");
    for (const n of [
      "Lovable AI",
      "Twilio",
      "Stripe",
      "Resend",
      "Expo",
      "Firecrawl",
      "FatSecret",
      "OpenAI realtime",
      "Sentry",
    ])
      expect(names).toContain(n);
  });
  it("sign-up asks for agreement before recording the terms consent", () => {
    const s = readFileSync("src/routes/_authenticated/onboarding.tsx", "utf8");
    expect(s).toContain("!ack.adult || !ack.terms");
    expect(s).toContain('href="/terms"');
  });
});
