import { createFileRoute } from "@tanstack/react-router";
import { JobHealth } from "@/components/JobHealth";

export const Route = createFileRoute("/_authenticated/app/admin/jobs")({
  head: () => ({
    meta: [
      { title: "Admin jobs | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Admin jobs in Plexecute." },
      { property: "og:title", content: "Admin jobs | Plexecute" },
      { property: "og:description", content: "Manage Admin jobs in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <JobHealth />,
});
