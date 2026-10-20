import { createFileRoute } from "@tanstack/react-router";
import { LegalDocView } from "@/components/LegalDocView";
import { legalDoc } from "@/lib/legal";

const doc = legalDoc("privacy")!;
const t = `${doc.title} — Plexecute`;
export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: t },
      { name: "description", content: doc.summary },
      { property: "og:title", content: t },
      { property: "og:description", content: doc.summary },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://plexecute.io/privacy" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://plexecute.io/privacy" }],
  }),
  component: () => <LegalDocView doc={doc} />,
});
