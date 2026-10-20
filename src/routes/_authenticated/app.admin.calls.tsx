import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminCalls } from "@/lib/admin-console.functions";
import { Stat, Tally, Section, Loading } from "@/components/AdminUI";
import { CallMarkets } from "@/components/CallMarkets";
export const Route = createFileRoute("/_authenticated/app/admin/calls")({
  head: () => ({
    meta: [
      { title: "Admin calls | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Admin calls in Plexecute." },
      { property: "og:title", content: "Admin calls | Plexecute" },
      { property: "og:description", content: "Manage Admin calls in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const fn = useServerFn(adminCalls);
  const { data, error } = useQuery({ queryKey: ["admin-calls"], queryFn: () => fn() });
  return (
    <Section
      title="Calls"
      note="Call attempt details for the last 30 days. No numbers, recordings or transcripts."
    >
      {error && <p className="text-sm text-destructive">Couldn't load this section.</p>}
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label="Call campaigns" value={data.campaigns30} />
            <Stat label="Attempts placed" value={data.attempts} />
            <Stat label="Connected minutes" value={data.connectedMinutes} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Tally title="By outcome" data={data.byState} />
            <Tally title="By plan" data={data.byPlan} />
            <Tally title="By trigger" data={data.byTrigger} />
            <Tally title="Stop reasons" data={data.stopReasons} />
          </div>
          <CallMarkets />
        </>
      )}
    </Section>
  );
}
