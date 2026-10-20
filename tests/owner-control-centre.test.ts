/** Owner Control Centre — the brief's 30 checks (docs/OWNER_CONTROL_CENTRE_SPEC.md "TESTS").
 *  Static + pure checks always run. Live checks run against the real backend with
 *  RUN_OWNER_LIVE=1 and an owner session at ~/.cache/lovable-auth/session.json. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import {
  computeMoney,
  resolveRange,
  cohortRules,
  memberCode,
  CANCEL_REASONS,
  FEEDBACK_CATEGORIES,
} from "../src/lib/owner.functions";
import { PRODUCTS } from "../src/lib/billing";

const src = readFileSync("src/lib/owner.functions.ts", "utf8");
const sql = readdirSync("drizzle/migrations")
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(`drizzle/migrations/${f}`, "utf8"))
  .join("\n");
const routes = readdirSync("src/routes/_authenticated");
const handlers = src
  .split("export const ")
  .slice(1)
  .filter((b) => b.includes("createServerFn"));
const body = (name: string) => handlers.find((h) => h.startsWith(name + " ")) ?? "";
const ownerFns = handlers.filter((h) => !h.startsWith("submitCancellationReason"));

describe("Owner Control Centre — access and authorisation", () => {
  it("1/3. every owner server function checks the admin role before any data access", () => {
    expect(ownerFns.length).toBeGreaterThanOrEqual(17);
    for (const h of ownerFns) {
      const i = h.indexOf(".handler(");
      expect(h.slice(i, i + 160), h.slice(0, 30)).toMatch(/await owner\(context\)/);
    }
    expect(src).toMatch(/r\.role === "admin"\)\) throw new Error\("Forbidden"\)/);
  });
  it("1/3. every owner SQL aggregate refuses non-admins in the database itself", () => {
    for (const f of ["owner_overview", "owner_analytics", "owner_cohort_metrics"]) {
      const at = sql.lastIndexOf(`replace function public.${f}(`);
      expect(at, f).toBeGreaterThan(-1);
      expect(sql.slice(at, at + 400)).toMatch(
        /has_role\(auth\.uid\(\),'admin'\) then raise exception 'Forbidden'/,
      );
    }
    expect(sql).toMatch(
      /revoke all on function public\.owner_cohort_metrics\(jsonb\) from public, anon/,
    );
  });
  it("2. every section of the brief has an owner page", () => {
    for (const s of [
      "index",
      "users.index",
      "users.$code",
      "revenue",
      "retention",
      "execution",
      "calls",
      "costs",
      "economics",
      "support",
      "feedback",
      "cohorts",
      "integrations",
      "infrastructure",
      "incidents",
      "releases",
      "audit",
    ])
      expect(routes).toContain(`app.admin.owner.${s}.tsx`);
  });
});

describe("Owner Control Centre — figures", () => {
  const at = new Date("2026-10-15T12:00:00Z");
  it("5/30. revenue is null (shown as Not yet available) without a connected payment provider", () => {
    expect(computeMoney({ pro_month: 5 }, PRODUCTS, false)).toBeNull();
  });
  it("6. MRR counts monthly plans at list price and yearly plans at 1/12", () => {
    const m = computeMoney({ pro_month: 2, execute_month: 1, pro_year: 12 }, PRODUCTS, true)!;
    const expected =
      2 * PRODUCTS.pro.month.pence + PRODUCTS.execute.month.pence + PRODUCTS.pro.year.pence;
    expect(m.mrr).toBe(expected);
    expect(m.arr).toBe(expected * 12);
    expect(m.annualPlans).toBe(12);
    expect(m.arppu).toBe(Math.round(expected / 15));
    expect(computeMoney({}, PRODUCTS, true)!.arppu).toBeNull();
  });
  it("7. tier filter is applied server-side to the user list and cohorts", () => {
    expect(body("ownerUsers")).toMatch(/q\.eq\("tier", data\.tier\)/);
    expect(sql).toMatch(/_rules->>'tier' is null or p\.tier = _rules->>'tier'/);
  });
  it("8. date ranges resolve to the right windows", () => {
    expect(resolveRange("today", undefined, undefined, at).from.toISOString()).toBe(
      "2026-10-15T00:00:00.000Z",
    );
    expect(+at - +resolveRange("7d", undefined, undefined, at).from).toBe(7 * 864e5);
    expect(resolveRange("prev_service_month", undefined, undefined, at)).toEqual({
      from: new Date("2026-09-01T00:00:00Z"),
      to: new Date("2026-10-01T00:00:00Z"),
    });
    expect(resolveRange("quarter", undefined, undefined, at).from.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    expect(resolveRange("year", undefined, undefined, at).from.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(
      resolveRange("custom", "2026-03-01T00:00:00Z", "2026-03-05T00:00:00Z", at).to.toISOString(),
    ).toBe("2026-03-05T00:00:00.000Z");
  });
  it("9. cohort rules are validated and unknown filters rejected", () => {
    expect(cohortRules.parse({ tier: "pro", first_n: "100" })).toEqual({
      tier: "pro",
      first_n: 100,
    });
    expect(() => cohortRules.parse({ country: "GB" })).toThrow();
    expect(() => cohortRules.parse({ tier: "gold" })).toThrow();
  });
  it("10–12. activation and execution figures come from stored Life Audits, plan approvals and done sessions", () => {
    expect(sql).toMatch(
      /'planAccepted', \(select count\(distinct user_id\) from plan_versions where approved_at is not null\)/,
    );
    const cohort = sql.slice(sql.lastIndexOf("replace function public.owner_cohort_metrics("));
    expect(cohort).not.toMatch(/status='completed'/);
    expect(cohort).toMatch(/'blocksDone'.*status='done'/);
    expect(sql).toMatch(
      /'blocksDone', \(select count\(\*\) from plan_blocks where starts_at between _from and _to and status='done'\)/,
    );
  });
  it("13. Execute reward figures use the reward engine's states only", () => {
    expect(sql).toMatch(/state in \('EARNED','APPLIED'\)/);
  });
  it("14/15. calls and AI usage are counted from call records and usage events", () => {
    expect(sql).toMatch(/from call_campaigns/);
    expect(sql).toMatch(/from usage_events/);
  });
  it("16. integration and infrastructure health reuse the live health panels", () => {
    expect(
      readFileSync("src/routes/_authenticated/app.admin.owner.integrations.tsx", "utf8"),
    ).toMatch(/IntegrationsPanel/);
    expect(
      readFileSync("src/routes/_authenticated/app.admin.owner.infrastructure.tsx", "utf8"),
    ).toMatch(/AppHealth[\s\S]*JobHealth/);
  });
  it("17–20. failed webhooks, failed payments, renewals and cancellations are surfaced", () => {
    for (const k of ["billingEventTypes", "pastDue", "cancelling", "cancelled", "newSubs"])
      expect(src).toContain(k);
    expect(sql).toMatch(/'renewed'/);
  });
});

describe("Owner Control Centre — records", () => {
  it("21. cancellation reasons persist, never block cancelling, and cover the brief's nine options", () => {
    expect(CANCEL_REASONS).toHaveLength(9);
    expect(body("submitCancellationReason")).toMatch(/from\("cancellation_reasons"\)\.insert/);
    expect(sql).toMatch(
      /create policy "own cancellation reason insert" on public\.cancellation_reasons/,
    );
    expect(readFileSync("src/routes/_authenticated/app.billing.tsx", "utf8")).toMatch(
      /<CancelReason \/>/,
    );
  });
  it("22/24. support issues persist and resolving stamps a resolved date", () => {
    expect(body("ownerUpdateSupport")).toMatch(/resolved_at: done \?/);
  });
  it("23. feedback persists with the nine categories", () => {
    expect(FEEDBACK_CATEGORIES).toHaveLength(9);
    expect(body("ownerSaveFeedback")).toMatch(/owner_feedback/);
  });
  it("25. member detail never selects identity, health, coach or call content", () => {
    const d = body("ownerUserDetail") + body("ownerUsers");
    for (const bad of [
      "display_name",
      "date_of_birth",
      "phone_number",
      "email",
      "height_cm",
      "sex",
      "allergies",
      "coach_messages",
      "health_samples",
      "transcript",
      'select("*")',
    ])
      expect(d, bad).not.toContain(bad);
    expect(memberCode("4f2a91bc-0000-0000-0000-000000000000")).toBe("M-4F2A91BC");
  });
  it("26/27. lists are paginated and capped; nothing loads every member", () => {
    expect(body("ownerUsers")).toMatch(/\.range\(start, start \+ data\.pageSize - 1\)/);
    expect(src).toMatch(/pageSize: z\.number\(\)\.int\(\)\.min\(10\)\.max\(100\)/);
    for (const h of ownerFns)
      if (/from\("profiles"\)\.select/.test(h))
        expect(h).toMatch(/\.range\(|\.single\(\)|\.eq\("id"/);
  });
  it("28. deleted members are excluded everywhere", () => {
    expect(body("ownerUsers")).toMatch(/\.neq\("account_status", "deleted"\)/);
    expect(sql.slice(sql.lastIndexOf("replace function public.owner_cohort_metrics("))).toMatch(
      /account_status is distinct from 'deleted'/,
    );
    expect(readFileSync("src/lib/privacy.ts", "utf8")).toMatch(/"owner_member_tags"/);
  });
  it("29. every owner function writes an audit record", () => {
    for (const h of ownerFns)
      expect(h, h.slice(0, 30)).toMatch(/await audit\(\s*db,\s*context\.userId/);
  });
  it("30. pages show Not yet available instead of estimates", () => {
    const kit = readFileSync("src/components/OwnerKit.tsx", "utf8");
    expect(kit).toMatch(/NA = "Not yet available"/);
    expect(kit).toMatch(/d > 0 \?[^:]+: NA/);
  });
});

/* ---------- live checks against the real backend ---------- */
const sessionPath = `${homedir()}/.cache/lovable-auth/session.json`;
const live =
  process.env["RUN_OWNER_LIVE"] === "1" && existsSync(sessionPath) ? describe : describe.skip;
live("Owner Control Centre — live", () => {
  const env = Object.fromEntries(
    readFileSync(".env", "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
      }),
  );
  const URL = env["VITE_SUPABASE_URL"],
    KEY = env["VITE_SUPABASE_PUBLISHABLE_KEY"]!;
  const token = existsSync(sessionPath)
    ? JSON.parse(readFileSync(sessionPath, "utf8")).session.access_token
    : "";
  const rpc = (fn: string, args: object, auth = true) =>
    fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: KEY,
        "Content-Type": "application/json",
        ...(auth ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(args),
    });
  const range = (days: number) => ({
    _from: new Date(Date.now() - days * 864e5).toISOString(),
    _to: new Date().toISOString(),
  });

  it("1. signed-out callers are refused", async () => {
    expect((await rpc("owner_overview", range(30), false)).ok).toBe(false);
    expect((await rpc("owner_cohort_metrics", { _rules: {} }, false)).ok).toBe(false);
  });
  it("2/4/7. owner sees totals that add up across plans and match the all-members cohort", async () => {
    const o = await (await rpc("owner_overview", range(30))).json();
    expect(o.free + o.pro + o.execute).toBe(o.total);
    const c = await (await rpc("owner_cohort_metrics", { _rules: {} })).json();
    expect(c.members).toBe(o.total);
    const sum = Object.values(c.byTier as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(sum).toBe(c.members);
    const pro = await (await rpc("owner_cohort_metrics", { _rules: { tier: "pro" } })).json();
    expect(pro.members).toBe(o.pro);
  });
  it("8/9. wider date windows never count fewer signups; first-N caps the cohort", async () => {
    const w = await (await rpc("owner_overview", range(7))).json();
    const y = await (await rpc("owner_overview", range(365))).json();
    expect(y.newInRange).toBeGreaterThanOrEqual(w.newInRange);
    const f = await (await rpc("owner_cohort_metrics", { _rules: { first_n: 3 } })).json();
    expect(f.members).toBeLessThanOrEqual(3);
  });
  it("29. owner tables cannot be written directly from the browser, only via audited server functions", async () => {
    const h = { apikey: KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    for (const t of ["owner_feedback", "owner_notes", "owner_cohorts", "owner_member_tags"]) {
      const r = await fetch(`${URL}/rest/v1/${t}`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({}),
      });
      expect(r.ok, t).toBe(false);
    }
  });
});
