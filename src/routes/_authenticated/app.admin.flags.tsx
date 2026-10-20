import { createFileRoute } from "@tanstack/react-router";
import { FlagsPanel } from "@/components/admin/FlagsPanel";

export const Route = createFileRoute("/_authenticated/app/admin/flags")({
  head: () => ({
    meta: [
      { title: "Admin flags | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Admin flags in Plexecute." },
      { property: "og:title", content: "Admin flags | Plexecute" },
      { property: "og:description", content: "Manage Admin flags in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FlagsPanel,
});
