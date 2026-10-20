import { createFileRoute } from "@tanstack/react-router";
import { IncidentsPanel } from "@/components/admin/IncidentsPanel";
import { FlagsPanel } from "@/components/admin/FlagsPanel";

function Page() {
  return (
    <div className="space-y-6">
      <IncidentsPanel />
      <FlagsPanel />
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/app/admin/owner/incidents")({
  head: () => ({
    meta: [
      { title: "Owner incidents | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner incidents in Plexecute." },
      { property: "og:title", content: "Owner incidents | Plexecute" },
      { property: "og:description", content: "Manage Owner incidents in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});
