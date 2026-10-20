import { createFileRoute } from "@tanstack/react-router";
import { AppHealth } from "@/components/AppHealth";

export const Route = createFileRoute("/_authenticated/app/admin/health")({
  head: () => ({
    meta: [
      { title: "Admin health | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Admin health in Plexecute." },
      { property: "og:title", content: "Admin health | Plexecute" },
      { property: "og:description", content: "Manage Admin health in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <AppHealth />,
});
