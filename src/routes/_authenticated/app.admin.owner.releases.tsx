import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ownerRelease } from "@/lib/owner.functions";
import { Stat } from "@/components/AdminUI";
import { Table, NA, nice } from "@/components/OwnerKit";

export const Route = createFileRoute("/_authenticated/app/admin/owner/releases")({
  head: () => ({
    meta: [
      { title: "Owner releases | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner releases in Plexecute." },
      { property: "og:title", content: "Owner releases | Plexecute" },
      { property: "og:description", content: "Manage Owner releases in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Releases,
});

function Releases() {
  const fn = useServerFn(ownerRelease);
  const { data, error } = useQuery({ queryKey: ["owner-release"], queryFn: () => fn() });
  if (error) return <p className="text-sm text-destructive">Couldn't load this section.</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Environment" value={data.environment} />
        <Stat label="App version" value={data.appVersion ?? NA} />
        <Stat
          label="Deployed"
          value={data.deployedAt ? new Date(data.deployedAt).toLocaleString("en-GB") : NA}
        />
        <Stat label="Rollback" value="Via version history" />
      </div>
      <p className="text-xs text-muted-foreground">
        Version and deploy time appear once APP_RELEASE and DEPLOYED_AT are set at publish. Release
        notes, test status and known issues are kept in docs/HANDOFF.md and
        docs/REQUIREMENT_MATRIX.md (345 automatic checks passing at handover; known defects: none
        recorded).
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium">Rule-set versions in production</h2>
          <Table
            head={["Engine", "Version"]}
            rows={Object.entries(data.engines).map(([k, v]) => [nice(k), v])}
          />
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium">Feature switches</h2>
          <Table
            head={["Switch", "State", "Note"]}
            rows={data.flags.map((f) => [nice(f.key), f.enabled ? "On" : "Off", f.note])}
            empty="No switches changed from defaults."
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Previous releases: {NA} — no release history has been recorded yet.
      </p>
    </div>
  );
}
