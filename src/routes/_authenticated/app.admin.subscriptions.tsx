import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminSubscriptions } from "@/lib/admin-console.functions";
import { Stat, Tally, Section, Loading } from "@/components/AdminUI";

export const Route = createFileRoute("/_authenticated/app/admin/subscriptions")({
  head: () => ({
    meta: [
      { title: "Admin subscriptions | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Admin subscriptions in Plexecute." },
      { property: "og:title", content: "Admin subscriptions | Plexecute" },
      { property: "og:description", content: "Manage Admin subscriptions in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const fn = useServerFn(adminSubscriptions);
  const { data, error } = useQuery({ queryKey: ["admin-subscriptions"], queryFn: () => fn() });
  return (
    <Section
      title="Subscriptions"
      note="Plan totals and payment notification state. Entitlement only changes from signed payment events."
    >
      {error && <p className="text-sm text-destructive">Couldn't load this section.</p>}
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Cancelling at period end" value={data.cancelling} />
            <Stat label="Trials running" value={data.trialsActive} />
            <Stat label="Payment events (30d)" value={data.webhook.count30} />
            <Stat
              label="Last payment event"
              value={data.webhook.last ? new Date(data.webhook.last).toLocaleString() : "none yet"}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Tally title="By plan" data={data.byTier} />
            <Tally title="By status" data={data.byStatus} />
            <Tally title="By billing period" data={data.byInterval} />
            <Tally title="Payment event types (30d)" data={data.webhook.byType} />
            <Tally title="Payment event processing" data={data.webhook.jobs} />
            <Tally title="Allowance changes (30d)" data={data.ledger30} />
          </div>
        </>
      )}
    </Section>
  );
}
