import { createFileRoute, notFound } from "@tanstack/react-router";
import { LegalDocView } from "@/components/LegalDocView";
import { legalDoc } from "@/lib/legal";

export const Route = createFileRoute("/legal/$doc")({
  loader: ({ params }) => {
    const d = legalDoc(params.doc);
    if (!d) throw notFound();
    return { slug: d.slug };
  },
  head: ({ loaderData }) => {
    const d = loaderData ? legalDoc(loaderData.slug) : undefined;
    const t = `${d?.title ?? "Legal"} — Plexecute`,
      desc = d?.summary ?? "Plexecute legal information.";
    const url = d ? `https://plexecute.io/legal/${encodeURIComponent(d.slug)}` : undefined;
    return {
      meta: [
        { title: t },
        { name: "description", content: desc },
        { property: "og:title", content: t },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        ...(url ? [{ property: "og:url", content: url }] : []),
        { name: "twitter:card", content: "summary" },
      ],
      links: url ? [{ rel: "canonical", href: url }] : [],
    };
  },
  component: Page,
  notFoundComponent: () => <p className="p-10">That document doesn't exist.</p>,
});

function Page() {
  const { slug } = Route.useLoaderData();
  const doc = legalDoc(slug);
  if (!doc) throw notFound();
  return <LegalDocView doc={doc} />;
}
