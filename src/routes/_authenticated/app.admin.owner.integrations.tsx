import { createFileRoute } from "@tanstack/react-router";
import { IntegrationsPanel } from "@/components/admin/IntegrationsPanel";

export const Route = createFileRoute("/_authenticated/app/admin/owner/integrations")({
  head: () => ({
    meta: [
      { title: "Owner integrations | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner integrations in Plexecute." },
      { property: "og:title", content: "Owner integrations | Plexecute" },
      { property: "og:description", content: "Manage Owner integrations in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntegrationsPanel,
});
