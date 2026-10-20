import { createFileRoute } from "@tanstack/react-router";
import { AuditPanel } from "@/components/admin/AuditPanel";

export const Route = createFileRoute("/_authenticated/app/admin/owner/audit")({
  head: () => ({
    meta: [
      { title: "Owner audit | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner audit in Plexecute." },
      { property: "og:title", content: "Owner audit | Plexecute" },
      { property: "og:description", content: "Manage Owner audit in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuditPanel,
});
