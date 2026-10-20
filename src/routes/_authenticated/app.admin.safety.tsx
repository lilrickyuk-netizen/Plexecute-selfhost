import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminSafety } from "@/lib/admin-console.functions";
import { Stat, Tally, Section, Loading } from "@/components/AdminUI";

export const Route = createFileRoute("/_authenticated/app/admin/safety")({
  head: () => ({
    meta: [
      { title: "Admin safety | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Admin safety in Plexecute." },
      { property: "og:title", content: "Admin safety | Plexecute" },
      { property: "og:description", content: "Manage Admin safety in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const fn = useServerFn(adminSafety);
  const { data, error } = useQuery({ queryKey: ["admin-safety"], queryFn: () => fn() });
  return (
    <Section
      title="Safety"
      note="Safety screening totals for the last 30 days. Individual messages are never shown."
    >
      {error && <p className="text-sm text-destructive">Couldn't load this section.</p>}
      {!data ? (
        <Loading />
      ) : (
        <>
          <Stat label="Safety checks recorded (30d)" value={data.events30} />
          <div className="grid gap-3 md:grid-cols-3">
            <Tally title="By state" data={data.byState} />
            <Tally title="By area" data={data.byDomain} />
            <Tally title="Response given" data={data.byIntervention} />
            <Tally title="Active safety notes by signal" data={data.activeNotes} />
            <Tally title="Rule versions in use" data={data.policies} />
          </div>
        </>
      )}
    </Section>
  );
}
