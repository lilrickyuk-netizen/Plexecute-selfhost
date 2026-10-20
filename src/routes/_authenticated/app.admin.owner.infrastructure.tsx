import { createFileRoute } from "@tanstack/react-router";
import { AppHealth } from "@/components/AppHealth";
import { JobHealth } from "@/components/JobHealth";

function Page() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Live service health, background jobs, retries and failures. Backup and restore status: see
        the backup runbook — point-in-time recovery is not yet confirmed, so treat backups as daily.
      </p>
      <AppHealth />
      <JobHealth />
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/app/admin/owner/infrastructure")({
  head: () => ({
    meta: [
      { title: "Owner infrastructure | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner infrastructure in Plexecute." },
      { property: "og:title", content: "Owner infrastructure | Plexecute" },
      { property: "og:description", content: "Manage Owner infrastructure in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});
