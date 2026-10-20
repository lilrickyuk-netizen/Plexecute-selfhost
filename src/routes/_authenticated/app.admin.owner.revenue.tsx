import { createFileRoute } from "@tanstack/react-router";
import { Stat } from "@/components/AdminUI";
import {
  useAnalytics,
  Shell,
  Grid,
  Table,
  gbpOr,
  NA,
  countsRows,
  nice,
} from "@/components/OwnerKit";

export const Route = createFileRoute("/_authenticated/app/admin/owner/revenue")({
  head: () => ({
    meta: [
      { title: "Owner revenue | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner revenue in Plexecute." },
      { property: "og:title", content: "Owner revenue | Plexecute" },
      { property: "og:description", content: "Manage Owner revenue in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Revenue,
});

function Revenue() {
  const { data: d, error, isLoading, picker } = useAnalytics();
  const m = d?.money;
  const r = d?.revenue;
  return (
    <Shell picker={picker} error={error} loading={isLoading}>
      {d && r && (
        <>
          <Grid
            title="Recurring revenue"
            note={
              m
                ? "Worked out from list prices of subscriptions confirmed by Stripe."
                : "Revenue appears once the payment service (Stripe) is connected. Nothing here is estimated."
            }
          >
            <Stat label="MRR" value={gbpOr(m?.mrr)} />
            <Stat label="ARR" value={gbpOr(m?.arr)} />
            <Stat label="Pro revenue / month" value={gbpOr(m?.pro)} />
            <Stat label="Execute revenue / month" value={gbpOr(m?.execute)} />
            <Stat label="Annual plans" value={m ? m.annualPlans : NA} />
            <Stat label="Average per paying member" value={gbpOr(m?.arppu)} />
            <Stat label="Collected revenue (invoices)" value={NA} />
            <Stat label="Refunds" value={NA} />
          </Grid>
          <Grid title="Subscriptions in period">
            <Stat label="New subscriptions" value={r.newSubs} />
            <Stat label="On free trial" value={r.trialing} />
            <Stat label="Cancelling at period end" value={r.cancelling} />
            <Stat label="Cancelled" value={r.cancelled} />
            <Stat label="Failed payments" value={r.pastDue} />
            <Stat label="Voice top-ups bought" value={r.topups} />
          </Grid>
          <Grid title="Execute rewards">
            <Stat label="Earned" value={r.rewardsEarned} />
            <Stat label="Applied" value={r.rewardsApplied} />
            <Stat label="Value applied" value={gbpOr(r.rewardPenceApplied)} />
          </Grid>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <h2 className="mb-2 text-sm font-medium">Paying members by source</h2>
              <Table head={["Source", "Paying"]} rows={countsRows(r.bySource)} />
            </div>
            <div>
              <h2 className="mb-2 text-sm font-medium">Paying members by sign-up month</h2>
              <Table head={["Cohort", "Paying"]} rows={countsRows(r.byCohort)} />
            </div>
            <div>
              <h2 className="mb-2 text-sm font-medium">Payment events received</h2>
              <Table
                head={["Event", "Count"]}
                rows={Object.entries(r.billingEventTypes).map(([k, v]) => [
                  nice(k.replace(/\./g, " ")),
                  v,
                ])}
                empty="None — Stripe isn't connected yet."
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Upgrades, downgrades and recovered payments are counted from Stripe's events once it's
            connected.
          </p>
        </>
      )}
    </Shell>
  );
}
