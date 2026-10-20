import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicPage } from "@/components/PublicPage";

const m = (t: string, d: string) => [
  { title: t },
  { name: "description", content: d },
  { property: "og:title", content: t },
  { property: "og:description", content: d },
  { property: "og:type", content: "website" },
  { property: "og:url", content: "https://plexecute.io/pricing" },
  { name: "twitter:card", content: "summary" },
];

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: m(
      "Pricing — Plexecute",
      "Compare Plexecute Free, Pro and Execute plans for AI life execution, goal planning and accountability. See monthly and annual prices and included allowances.",
    ),
    links: [{ rel: "canonical", href: "https://plexecute.io/pricing" }],
  }),
  component: Pricing,
});

const TIERS = [
  {
    n: "Free",
    p: "£0",
    d: "A real, useful plan.",
    f: [
      "Complete life audit",
      "Up to 3 active goals",
      "Weekly whole-life plan",
      "Training, nutrition, sleep & learning logging",
      "5 coach messages a day",
    ],
  },
  {
    n: "Pro",
    p: "£23.99 / $23.99",
    d: "Full AI orchestration.",
    f: [
      "Everything in Free",
      "Unlimited goals",
      "Full-depth AI coach",
      "Advanced adaptive replanning",
      "Limited phone accountability",
    ],
    hi: true,
  },
  {
    n: "Execute",
    p: "£59.99 / $59.99",
    d: "Persistent accountability.",
    f: [
      "Everything in Pro",
      "Persistent phone accountability calls",
      "Live voice coaching",
      "Priority support",
    ],
  },
];

function Pricing() {
  return (
    <PublicPage title="Pricing">
      <p>
        Prices are monthly. UK members pay in pounds (VAT included where it applies); US members pay
        the same amounts in dollars, plus any state sales tax. Choose a 7-day free trial of Pro or
        Execute.
      </p>
      <div className="grid gap-4 pt-4 md:grid-cols-3">
        {TIERS.map((t) => (
          <div
            key={t.n}
            className={`rounded-[20px] border bg-card p-6 ${t.hi ? "border-primary" : "border-border"}`}
          >
            <h2 className="!mt-0">{t.n}</h2>
            <p className="mt-2 font-display text-3xl font-semibold text-foreground">
              {t.p}
              <span className="text-sm font-normal text-muted-foreground">/mo</span>
            </p>
            <p className="mt-1 text-sm">{t.d}</p>
            <ul className="mt-5 space-y-2 text-sm">
              {t.f.map((x) => (
                <li key={x}>— {x}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="pt-4 text-sm">
        <Link to="/login" search={{ mode: "signup" }} className="text-primary">
          Create your account
        </Link>
        , then start a 7-day trial from Plan & billing.
      </p>
    </PublicPage>
  );
}
