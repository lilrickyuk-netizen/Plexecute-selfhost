import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicPage } from "@/components/PublicPage";
import { LEGAL_DOCS } from "@/lib/legal";

const t = "Legal — Plexecute",
  d =
    "Terms, privacy, cookies, health disclaimer, AI transparency, calling, subscriptions, data rights, accessibility and subprocessors.";
export const Route = createFileRoute("/legal/")({
  head: () => ({
    meta: [
      { title: t },
      { name: "description", content: d },
      { property: "og:title", content: t },
      { property: "og:description", content: d },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://plexecute.io/legal" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://plexecute.io/legal" }],
  }),
  component: () => (
    <PublicPage title="Legal">
      <ul className="grid gap-3 sm:grid-cols-2">
        {LEGAL_DOCS.map((x) => (
          <li key={x.slug} className="rounded-[14px] border border-border bg-card p-4">
            <Link
              to="/legal/$doc"
              params={{ doc: x.slug }}
              className="font-medium text-foreground underline"
            >
              {x.title}
            </Link>
            <p className="mt-1 text-sm">{x.summary}</p>
          </li>
        ))}
      </ul>
    </PublicPage>
  ),
});
