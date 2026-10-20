import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";

describe("member presentation boundaries", () => {
  it("matches composer controls to the member button finish", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(
      "Composer tools share the member app's compact, silver-on-dark button finish.",
    );
    expect(css).toContain(
      "color: var(--member-icon-silver); background: var(--member-icon-surface);",
    );
    expect(css).toContain(
      ".member-coach .member-coach-footer button svg.lucide { color: var(--member-icon-silver); }",
    );
  });
  it("keeps the dark identity regardless of saved or system theme", () => {
    const shell = readFileSync("src/routes/_authenticated/app.tsx", "utf8");
    expect(shell).toContain('document.documentElement.classList.add("dark")');
    expect(shell).not.toContain("prefers-color-scheme");
    expect(shell).not.toContain("profile?.theme");
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/:root \{[\s\S]*?color-scheme: dark;[\s\S]*?--background: #0B0E14/);
    expect(css).not.toContain("--background: #F7F9FC");
    for (const name of ["PreferenceSettings", "MemberSettings"]) {
      const source = readFileSync(`src/components/${name}.tsx`, "utf8");
      expect(source).not.toContain('aria-label="Theme"');
      expect(source).not.toContain("theme: p.theme");
      expect(source).not.toContain('theme: "system"');
    }
  });
  it("keeps questionnaire selection separate from navigation with no delayed skips", () => {
    const source = readFileSync("src/components/OnboardingQuestionnaire.tsx", "utf8");
    expect(source).not.toContain("setTimeout");
    expect(source).not.toContain("{q.multi && <Button");
    expect(source).toContain("disabled={busy || !valid}");
    expect(source).toContain("aria-busy={busy}");
    expect(source).toContain("whitespace-normal");
  });
  it("matches Coach reference without replacing execution or confirmations", () => {
    const coach = readFileSync("src/routes/_authenticated/app.coach.tsx", "utf8");
    for (const expected of [
      "<Conversation",
      "<MessageResponse",
      "<PromptInput",
      "<PromptInputFooter",
      "<PromptInputSubmit",
      "decideCoachAction",
      "approveWeekPlan",
      "sendCoachMessage",
      "VoiceInputButton",
      "estimateMealPhoto",
      "defaultOpen={false}",
    ])
      expect(coach).toContain(expected);
    expect(coach).not.toContain("plainMessage(content)");
    expect(coach).not.toContain("member-coach-prompts");
    // Coach carries no brand header of its own: the logo lives in the shared shell, and Coach's replies carry no avatar.
    for (const gone of [
      "/icon-192.png",
      "member-coach-logo",
      "member-coach-brand",
      "member-coach-head",
    ])
      expect(coach).not.toContain(gone);
  });
  it("uses distinct feature photographs instead of duplicating Today", () => {
    for (const page of ["plan", "progress", "wellness"]) {
      const source = readFileSync(`src/routes/_authenticated/app.${page}.tsx`, "utf8");
      expect(source).toContain(`@/assets/member-${page}.jpg`);
      expect(source).toContain('className="member-training-cover"');
      expect(existsSync(`src/assets/member-${page}.jpg`)).toBe(true);
      expect(source).not.toContain("member-today.jpg");
    }
    const explore = readFileSync("src/routes/_authenticated/app.more.tsx", "utf8");
    expect(explore).toContain("@/assets/member-explore.jpg");
    expect(explore).toContain("@/assets/member-wellness.jpg");
    expect(explore).not.toContain("todayImage");
  });
  it("gives every feature its own unique symbol", () => {
    const nav = readFileSync("src/components/MemberNavigation.tsx", "utf8");
    const icons = [...nav.matchAll(/label: "[^"]+", icon: (\w+)/g)].map((match) => match[1]);
    expect(icons.length).toBeGreaterThan(25);
    expect(new Set(icons).size).toBe(icons.length);
    for (const [page, icon] of [
      ["plan", "ListTodo"],
      ["commitments", "CalendarClock"],
      ["clients", "ContactRound"],
      ["twin", "Fingerprint"],
      ["help", "LifeBuoy"],
    ]) {
      expect(readFileSync(`src/routes/_authenticated/app.${page}.tsx`, "utf8")).toContain(
        `icon={${icon}}`,
      );
    }
    expect(readFileSync("src/routes/_authenticated/app.tsx", "utf8")).toContain(
      'label: "Plan", icon: ListTodo',
    );
  });
  it("uses silver member icons with subtle green frames and active accents", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain("--member-icon-silver:");
    expect(css).toContain("--member-icon-shadow:");
    expect(css).toContain(".member-app svg.lucide { color: var(--member-icon-silver)");
    expect(css).not.toContain(".member-app svg.lucide { color: var(--logo-brand)");
    expect(css).toContain(".member-mobile-active svg.lucide");
  });
  it("uses Coach as the signed-in hub without bypassing onboarding or chosen billing", () => {
    const login = readFileSync("src/routes/login.tsx", "utf8");
    expect(login).toContain('else navigate({ to: "/app/coach" })');
    expect(login).toContain('if (p && !p.onboarded) return navigate({ to: "/onboarding" })');
    expect(login).toContain('navigate({ to: "/app/billing"');
    expect(readFileSync("src/routes/_authenticated/app.index.tsx", "utf8")).toContain(
      'redirect({ to: "/app/coach" })',
    );
    expect(readFileSync("src/routes/_authenticated/onboarding.tsx", "utf8")).toContain(
      'navigate({ to: "/app/coach" })',
    );
    const shell = readFileSync("src/routes/_authenticated/app.tsx", "utf8");
    expect(shell.match(/aria-label="Plexecute Coach"/g)).toHaveLength(2);
    expect(shell).toContain('{ to: "/app/today", label: "Today"');
  });
  it("uses the same feature heading across planning, life areas and accounts", () => {
    for (const name of [
      "plan",
      "calendar",
      "goals",
      "training",
      "wellness",
      "recovery",
      "learning",
      "appointments",
      "journeys",
      "progress",
      "history",
      "clients",
    ]) {
      expect(readFileSync(`src/routes/_authenticated/app.${name}.tsx`, "utf8"), name).toContain(
        "<FeatureHeader",
      );
    }
    expect(readFileSync("src/components/MemberSettings.tsx", "utf8")).toContain("<FeatureHeader");
  });
  it("keeps calendar navigation outside its view selector and gives month days stable controls", () => {
    const calendar = readFileSync("src/routes/_authenticated/app.calendar.tsx", "utf8");
    expect(calendar).toContain('className="member-calendar-toolbar"');
    expect(calendar).toContain('className="member-segments" role="tablist"');
    expect(calendar).toContain('<Button variant="ghost"');
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain(".member-header-actions");
    expect(css).toContain(".member-recovery-layout");
    expect(css).toContain(".member-owner-nav");
  });
  it("curates the same feature destinations without glowing selection pills", () => {
    const explore = readFileSync("src/routes/_authenticated/app.more.tsx", "utf8");
    expect(explore).toContain("MEMBER_GROUPS.map");
    expect(explore).toContain("member-execution-links");
    expect(explore).toContain("member-area-links");
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).not.toContain('[class*="bg-execute"]');
    expect(css).toContain(".member-ring-value { stroke: var(--execute);");
  });
  it("every feature-directory destination has a real route", () => {
    const nav = readFileSync("src/components/MemberNavigation.tsx", "utf8");
    const destinations = [...nav.matchAll(/to: "\/app\/([a-z-]+)"/g)].map((m) => m[1]);
    expect(destinations.length).toBeGreaterThan(25);
    for (const destination of destinations)
      expect(existsSync(`src/routes/_authenticated/app.${destination}.tsx`), destination).toBe(
        true,
      );
    expect(nav).not.toContain("/app/knowledge");
  });
  it("dedicated settings pages reuse the existing settings implementation", () => {
    for (const name of ["profile", "privacy", "reminders", "connections"]) {
      const route = readFileSync(`src/routes/_authenticated/app.${name}.tsx`, "utf8");
      expect(route).toContain(`surface="${name}"`);
      expect(route).not.toContain("redirect(");
    }
  });
  it("hosts meal planning and meal prep inside Nutrition with deep-link routes intact", () => {
    const nutrition = readFileSync("src/routes/_authenticated/app.nutrition.tsx", "utf8");
    expect(nutrition).toContain('aria-label="Nutrition sections"');
    expect(nutrition).toContain("<MealPlanner />");
    expect(nutrition).toContain("<MealPrep day={prepDay} />");
    expect(readFileSync("src/routes/_authenticated/app.meal-prep.tsx", "utf8")).toContain(
      "<MealPrep day={day}",
    );
    expect(readFileSync("src/routes/_authenticated/app.meal-plan.tsx", "utf8")).toContain(
      "<MealPlanner />",
    );
    const nav = readFileSync("src/components/MemberNavigation.tsx", "utf8");
    expect(nav).not.toContain("/app/meal-prep");
    expect(nav).not.toContain("/app/meal-plan");
  });
  it("hosts the daily recovery check-in inside Training with the deep link intact", () => {
    const training = readFileSync("src/routes/_authenticated/app.training.tsx", "utf8");
    expect(training).toContain("<RecoveryPanel />");
    expect(training).toContain('key: "recovery", label: "Recovery"');
    const nav = readFileSync("src/components/MemberNavigation.tsx", "utf8");
    expect(nav).not.toContain("/app/recovery");
    expect(readFileSync("src/routes/_authenticated/app.recovery.tsx", "utf8")).toContain(
      "<RecoveryPanel />",
    );
  });
  it("the public home page is outside the member design layer", () => {
    expect(readFileSync("src/routes/index.tsx", "utf8")).not.toContain("member-app");
    expect(readFileSync("src/routes/_authenticated/app.tsx", "utf8")).toContain("member-app");
  });
});
