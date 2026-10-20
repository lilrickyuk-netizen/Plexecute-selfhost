import { createFileRoute } from "@tanstack/react-router";
import { Stat } from "@/components/AdminUI";
import { niceKey } from "@/components/AdminUI";
import { useAnalytics, Shell, Grid, Table, pct, NA, nice } from "@/components/OwnerKit";

export const Route = createFileRoute("/_authenticated/app/admin/owner/costs")({
  head: () => ({
    meta: [
      { title: "Owner AI and provider costs | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner AI and provider costs in Plexecute." },
      { property: "og:title", content: "Owner AI and provider costs | Plexecute" },
      { property: "og:description", content: "Manage Owner AI and provider costs in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Costs,
});

function Costs() {
  const { data: d, error, isLoading, picker } = useAnalytics();
  const u = d?.usage;
  const tokens = (u?.rows ?? []).filter((r) => r.unit.includes("token"));
  const tok = (unit: string) =>
    tokens.filter((r) => r.unit === unit).reduce((s, r) => s + Number(r.quantity), 0);
  const calls = (u?.providers ?? []).reduce((s, p) => s + p.calls, 0);
  const failed = (u?.providers ?? []).reduce((s, p) => s + p.failed, 0);
  return (
    <Shell picker={picker} error={error} loading={isLoading}>
      {u && (
        <>
          <Grid
            title="AI and provider use in period"
            note="The app records how much of each service is used, never money. Spend appears once each provider's real invoice rates are added."
          >
            <Stat label="AI input tokens" value={tok("input_tokens").toLocaleString()} />
            <Stat label="AI output tokens" value={tok("output_tokens").toLocaleString()} />
            <Stat label="Provider requests" value={calls} />
            <Stat label="Provider failure rate" value={pct(failed, calls)} />
            <Stat label="Spend this month" value={NA} />
            <Stat label="Projected month-end spend" value={NA} />
            <Stat label="AI cost per active member" value={NA} />
          </Grid>
          <section>
            <h2 className="mb-2 text-sm font-medium">Usage by service, feature and plan</h2>
            <Table
              head={["Service", "Feature", "Plan", "Amount", "Unit", "Uses", "Failed", "Members"]}
              rows={u.rows.map((r) => [
                niceKey(r.provider),
                nice(r.feature),
                r.tier,
                Number(r.quantity).toLocaleString(),
                nice(r.unit),
                r.events,
                r.failed,
                r.members,
              ])}
            />
          </section>
          <section>
            <h2 className="mb-2 text-sm font-medium">Provider health</h2>
            <Table
              head={["Service", "Requests", "Failed", "Failure rate", "Average response"]}
              rows={u.providers.map((p) => [
                niceKey(p.provider),
                p.calls,
                p.failed,
                pct(p.failed, p.calls),
                p.latency == null ? "—" : `${p.latency} ms`,
              ])}
            />
          </section>
        </>
      )}
    </Shell>
  );
}
