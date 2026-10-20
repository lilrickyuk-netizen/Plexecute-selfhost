import { createFileRoute } from "@tanstack/react-router";
import { IntegrationsPanel } from "@/components/admin/IntegrationsPanel";

export const Route = createFileRoute("/_authenticated/app/admin/integrations")({
  head: () => ({
    meta: [
      { title: "Admin integrations | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Admin integrations in Plexecute." },
      { property: "og:title", content: "Admin integrations | Plexecute" },
      { property: "og:description", content: "Manage Admin integrations in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntegrationsPanel,
});
