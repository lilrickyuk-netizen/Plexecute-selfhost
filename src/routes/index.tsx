import { createFileRoute, Link } from "@tanstack/react-router";
import { InstallAppButton } from "@/components/InstallAppButton";
import heroImg from "@/assets/hero-silhouette.jpg";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Link2, Trophy, User, type LucideIcon } from "lucide-react";
import { money, priceAmount, type Market } from "@/lib/billing";
import type { ReactNode } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title:
          "Plexecute — AI Life Execution Platform That Turns Your Dreams Into Goals, Your Goals Into Plans, and Helps You Execute Every Step of the Way",
      },
      {
        name: "description",
        content:
          "Plexecute is an AI life execution platform that turns your dreams into goals, your goals into plans, and helps you execute every step of the way.",
      },
      {
        property: "og:title",
        content:
          "Plexecute — AI Life Execution Platform That Turns Your Dreams Into Goals, Your Goals Into Plans, and Helps You Execute Every Step of the Way",
      },
      {
        property: "og:description",
        content:
          "One plan for your whole life — career, learning, health, home and more — that fits your actual week and keeps you executing it.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://plexecute.io/" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://plexecute.io/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": "https://plexecute.io/#organization",
              name: "Plexecute",
              url: "https://plexecute.io/",
              logo: "https://plexecute.io/icon-192.png",
            },
            {
              "@type": "WebSite",
              "@id": "https://plexecute.io/#website",
              name: "Plexecute",
              url: "https://plexecute.io/",
              publisher: { "@id": "https://plexecute.io/#organization" },
            },
            {
              "@type": "SoftwareApplication",
              name: "Plexecute",
              url: "https://plexecute.io/",
              applicationCategory: "LifestyleApplication",
              operatingSystem: "Web browser",
              description:
                "AI life execution platform that turns dreams into goals, goals into plans, and helps you execute every step of the way.",
              publisher: { "@id": "https://plexecute.io/#organization" },
            },
          ],
        }),
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  // Visitors have no billing country yet; time zone is only a display hint (billing country decides at checkout).
  const [market, setMarket] = useState<Market>("GB");
  const reward = market === "US" ? "$10" : "£10";
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    setMarket(tz.startsWith("America/") ? "US" : "GB");
  }, []);
  return (
    <div className="min-h-screen bg-background">
      <div className="relative isolate overflow-hidden">
        <img
          src={heroImg}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 -z-10 h-full w-full object-cover object-[70%_center] opacity-60 md:opacity-70"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-r from-background via-background/85 to-background/20"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-gradient-to-t from-background via-transparent to-background/60"
        />
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <Logo />
          <div className="flex items-center gap-3">
            <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground">
              Pricing
            </Link>
            <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">
              Log in
            </Link>
            <Link
              to="/login"
              search={{ mode: "signup" }}
              className="rounded-full border border-logo-brand/45 bg-logo-brand/10 px-4 py-2 text-sm font-medium text-logo-brand transition-colors hover:border-logo-brand/70 hover:bg-logo-brand/20"
            >
              Start free
            </Link>
          </div>
        </header>

        <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-execute" /> Plan. Execute. Adapt.
          </p>
          <h1 className="max-w-4xl text-5xl font-semibold leading-[1.05] md:text-7xl">
            Plan your life.
            <br />
            <span className="text-logo-brand">Execute the plan.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Plexecute is an AI Life Execution Platform that turns your dreams into goals, your goals
            into plans, and helps you execute every step of the way.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link
              to="/login"
              search={{ mode: "signup" }}
              className="inline-flex items-center gap-2 rounded-[12px] border border-logo-brand/45 bg-logo-brand/10 px-6 py-3 font-medium text-logo-brand transition-colors hover:border-logo-brand/70 hover:bg-logo-brand/20"
            >
              Build my plan <ArrowRight className="h-4 w-4" />
            </Link>
            <InstallAppButton />
          </div>
        </section>
      </div>

      <main className="mx-auto max-w-6xl px-6">
        <section className="mt-4">
          <h2 className="text-4xl font-semibold leading-tight md:text-5xl">
            Plans built around <span className="text-logo-brand">your ambition.</span>
          </h2>
          <p className="mt-3 max-w-3xl text-muted-foreground">
            Start with the core platform, then unlock more support, more execution and more
            accountability when you need it.
          </p>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            <PlanCard
              icon={User}
              name="Free"
              blurb="Start planning your life with Plexecute."
              features={[
                "Core AI life coaching",
                "Goal planning",
                "Learning and life planning",
                "Calendar and progress tracking",
                "Limited included AI usage",
                "Plexecute Credits available when allowance runs out",
              ]}
              price={market === "US" ? "$0" : "£0"}
              cta={
                <Link
                  to="/login"
                  search={{ mode: "signup" }}
                  className="rounded-full border border-border bg-secondary px-6 py-2.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                >
                  Get started
                </Link>
              }
            />
            <PlanCard
              icon={Link2}
              name="Pro"
              badge="MOST POPULAR"
              tone="primary"
              blurb="For members who want deeper planning, more AI support and stronger accountability."
              features={[
                "Higher AI usage allowance",
                "Accountability calls",
                "Extra call minutes available",
                "Plexecute Credits available when AI allowance runs out",
                "Full goal, learning, career, nutrition, training and wellness support",
                "Adaptive planning and replanning",
                "Calendar, reminders and progress tracking",
              ]}
              price={money(priceAmount("pro", "month", market), market)}
              yearly={money(priceAmount("pro", "year", market), market)}
              cta={
                <Link
                  to="/login"
                  search={{ mode: "signup", plan: "pro" }}
                  className="rounded-full border border-logo-brand px-6 py-2.5 text-sm font-medium text-foreground hover:bg-logo-brand/10"
                >
                  Choose Pro
                </Link>
              }
            />
            <PlanCard
              icon={Trophy}
              name="Execute"
              badge="BEST VALUE"
              tone="brand"
              blurb="For members who want Plexecute to help execute real life, not just plan it."
              lead="Everything in Pro, plus:"
              features={[
                "Real-world appointment booking",
                "Restaurant reservations",
                "Calls to businesses",
                "Rescheduling and cancellations",
                "Online booking support",
                "Paid booking and order preparation up to secure checkout",
                "Much larger included call allowance",
                "Highest AI usage allowance",
                `${reward} Monthly Execution Reward when the full accepted monthly plan is completed`,
                "Deeper real-world execution support across your life",
              ]}
              price={money(priceAmount("execute", "month", market), market)}
              yearly={money(priceAmount("execute", "year", market), market)}
              cta={
                <Link
                  to="/login"
                  search={{ mode: "signup", plan: "execute" }}
                  className="rounded-full border border-logo-brand/45 bg-logo-brand/10 px-6 py-2.5 text-sm font-semibold text-logo-brand transition-colors hover:border-logo-brand/70 hover:bg-logo-brand/20"
                >
                  Choose Execute
                </Link>
              }
              footer="Plan it. Book it. Call it. Schedule it. Execute it."
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Prices shown in {market === "US" ? "US dollars" : "pounds"}; your billing country at
            checkout decides the currency.
          </p>
        </section>

        <footer className="flex flex-col gap-2 py-12 text-xs text-muted-foreground md:flex-row md:justify-between">
          <span className="leading-8">
            © 2026 Plexecute. 18+ only. Not medical advice.{" "}
            <Link to="/how-it-works" className="inline-block py-1">
              How it works
            </Link>{" "}
            ·{" "}
            <Link to="/pricing" className="inline-block py-1">
              Pricing
            </Link>{" "}
            ·{" "}
            <Link to="/privacy" className="inline-block py-1">
              Privacy
            </Link>{" "}
            ·{" "}
            <Link to="/terms" className="inline-block py-1">
              Terms
            </Link>{" "}
            ·{" "}
            <Link to="/safety" className="inline-block py-1">
              Safety
            </Link>{" "}
            ·{" "}
            <Link to="/legal" className="inline-block py-1">
              Legal
            </Link>
          </span>
        </footer>
      </main>
    </div>
  );
}

function Logo() {
  return (
    <span className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
      <img src="/icon-192.png" alt="" width={28} height={28} className="h-7 w-7 rounded-md" />
      <span>
        Plex<span className="text-logo-brand">ecute</span>
      </span>
    </span>
  );
}

function PlanCard(p: {
  icon: LucideIcon;
  name: string;
  blurb: string;
  features: string[];
  price: string;
  cta: ReactNode;
  badge?: string;
  tone?: "primary" | "brand";
  yearly?: string;
  lead?: string;
  footer?: string;
}) {
  const ring =
    p.tone === "brand"
      ? "border-logo-brand"
      : p.tone === "primary"
        ? "border-logo-brand/55"
        : "border-border";
  const accent = p.tone ? "text-logo-brand" : "text-muted-foreground";
  return (
    <div
      className={`flex flex-col rounded-[20px] border bg-card p-6 ${ring} ${p.tone === "brand" ? "shadow-brand-glow" : ""}`}
    >
      <div className="flex items-start gap-4">
        <span
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-[12px] border ${ring}`}
        >
          <p.icon className={`h-6 w-6 ${accent}`} />
        </span>
        <div className="flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-2xl font-semibold">{p.name}</h3>
            {p.badge && (
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wide ${ring} ${accent}`}
              >
                {p.badge}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{p.blurb}</p>
        </div>
      </div>
      {p.lead && <p className="mt-5 font-semibold text-logo-brand">{p.lead}</p>}
      <ul className={`${p.lead ? "mt-2" : "mt-5"} space-y-1.5 text-sm`}>
        {p.features.map((f) => (
          <li key={f} className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-logo-brand" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-wrap items-end justify-between gap-4 pt-8">
        <div>
          <div className="font-display text-3xl font-semibold">
            {p.price}
            {p.yearly && (
              <span className="text-sm font-normal text-muted-foreground"> / month</span>
            )}
          </div>
          {p.yearly && <div className="text-sm text-muted-foreground">{p.yearly} / year</div>}
        </div>
        {p.cta}
      </div>
      {p.footer && <p className="mt-4 text-sm font-semibold text-logo-brand">{p.footer}</p>}
    </div>
  );
}
