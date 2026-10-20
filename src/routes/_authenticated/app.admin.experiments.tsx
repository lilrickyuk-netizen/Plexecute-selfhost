import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminExperiments } from "@/lib/admin-console.functions";
import { Stat, Tally, Section, Loading } from "@/components/AdminUI";

export const Route = createFileRoute("/_authenticated/app/admin/experiments")({
  head: () => ({
    meta: [
      { title: "Admin experiments | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Admin experiments in Plexecute." },
      { property: "og:title", content: "Admin experiments | Plexecute" },
      { property: "og:description", content: "Manage Admin experiments in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const fn = useServerFn(adminExperiments);
  const { data, error } = useQuery({ queryKey: ["admin-experiments"], queryFn: () => fn() });
  return (
    <Section
      title="Experiments"
      note="Member self-experiments, totals only. Each passed the safety check before starting."
    >
      {error && <p className="text-sm text-destructive">Couldn't load this section.</p>}
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Experiments" value={data.total} />
            <Stat label="Started (30d)" value={data.new30} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Tally title="By status" data={data.byStatus} />
            <Tally title="By measure" data={data.byMetric} />
            <Tally title="By design" data={data.byDesign} />
            <Tally title="Rule versions" data={data.policies} />
          </div>
        </>
      )}
    </Section>
  );
}
