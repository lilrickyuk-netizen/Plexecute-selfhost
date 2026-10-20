import { createFileRoute } from "@tanstack/react-router";
import { IncidentsPanel } from "@/components/admin/IncidentsPanel";

export const Route = createFileRoute("/_authenticated/app/admin/incidents")({
  head: () => ({
    meta: [
      { title: "Admin incidents | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Admin incidents in Plexecute." },
      { property: "og:title", content: "Admin incidents | Plexecute" },
      { property: "og:description", content: "Manage Admin incidents in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IncidentsPanel,
});
