import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminQuotas } from "@/lib/admin-console.functions";
import { Stat, Tally, Section, Loading } from "@/components/AdminUI";
import { UnitEconomics } from "@/components/UnitEconomics";

export const Route = createFileRoute("/_authenticated/app/admin/quotas")({
  head: () => ({
    meta: [
      { title: "Admin quotas | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Admin quotas in Plexecute." },
      { property: "og:title", content: "Admin quotas | Plexecute" },
      { property: "og:description", content: "Manage Admin quotas in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const fn = useServerFn(adminQuotas);
  const { data, error } = useQuery({ queryKey: ["admin-quotas"], queryFn: () => fn() });
  return (
    <Section title="Quotas" note="Use of outside services since the start of this month.">
      {error && <p className="text-sm text-destructive">Couldn't load this section.</p>}
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Coach replies" value={data.coachReplies} />
            <Stat label="Coach tool uses" value={data.coachToolCalls} />
            <Stat label="Call attempts" value={data.callAttempts} />
            <Stat label="Connected call minutes" value={data.callMinutes} />
          </div>
          <section className="rounded-[14px] border border-border bg-card p-4 text-sm">
            <h3 className="font-medium">Outside service requests</h3>
            {Object.keys(data.byProvider).length === 0 ? (
              <p className="mt-2 text-muted-foreground">None this month.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {Object.entries(data.byProvider).map(([p, v]) => (
                  <li key={p} className="flex justify-between">
                    <span className="text-muted-foreground">{p}</span>
                    <span>
                      {v.calls} requests · {v.failed} failed
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <UnitEconomics />
    </Section>
  );
}
