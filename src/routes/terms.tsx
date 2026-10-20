import { createFileRoute } from "@tanstack/react-router";
import { LegalDocView } from "@/components/LegalDocView";
import { legalDoc } from "@/lib/legal";

const doc = legalDoc("terms")!;
const t = `${doc.title} — Plexecute`;
export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: t },
      { name: "description", content: doc.summary },
      { property: "og:title", content: t },
      { property: "og:description", content: doc.summary },
      { property: "og:type", content: "article" },
      { property: "og:url", content: "https://plexecute.io/terms" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://plexecute.io/terms" }],
  }),
  component: () => <LegalDocView doc={doc} />,
});
