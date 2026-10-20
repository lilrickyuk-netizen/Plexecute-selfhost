import { createFileRoute } from "@tanstack/react-router";
import { Stat } from "@/components/AdminUI";
import { useAnalytics, Shell, Grid, Table, pct, countsRows, NA } from "@/components/OwnerKit";

export const Route = createFileRoute("/_authenticated/app/admin/owner/calls")({
  head: () => ({
    meta: [
      { title: "Owner calls | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner calls in Plexecute." },
      { property: "og:title", content: "Owner calls | Plexecute" },
      { property: "og:description", content: "Manage Owner calls in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Calls,
});

function Calls() {
  const { data: d, error, isLoading, picker } = useAnalytics();
  const c = d?.calls;
  const mins = (s: number) => Math.round(s / 60);
  return (
    <Shell picker={picker} error={error} loading={isLoading}>
      {c && (
        <>
          <Grid
            title="Calls in period"
            note="Counts and lengths only — no call recordings or transcripts. Calls start once Twilio is connected."
          >
            <Stat label="Call campaigns" value={c.campaigns} />
            <Stat label="Call attempts" value={c.attempts} />
            <Stat label="Answered" value={c.answered} />
            <Stat label="Acknowledgement rate" value={pct(c.acked, c.campaigns)} />
            <Stat label="No answer" value={pct(c.noAnswer, c.attempts)} />
            <Stat label="Busy" value={pct(c.busy, c.attempts)} />
            <Stat label="Voicemail / machine" value={pct(c.machine, c.attempts)} />
            <Stat label="Failed" value={c.failed} />
            <Stat label="Retries" value={c.retries} />
            <Stat label="Connected minutes" value={mins(c.connectedSeconds)} />
            <Stat
              label="Average connected length"
              value={c.answered ? `${Math.round(c.connectedSeconds / c.answered)}s` : NA}
            />
            <Stat label="Stop all calls switched on" value={c.stopAll} />
            <Stat label="Phone service errors" value={c.providerErrors} />
            <Stat label="Call cost" value={NA} />
          </Grid>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <h2 className="mb-2 text-sm font-medium">Campaigns by plan</h2>
              <Table head={["Plan", "Campaigns"]} rows={countsRows(c.campaignsByTier)} />
            </div>
            <div>
              <h2 className="mb-2 text-sm font-medium">Connected minutes by plan</h2>
              <Table
                head={["Plan", "Minutes"]}
                rows={Object.entries(c.connectedByTier).map(([k, v]) => [k, mins(v ?? 0)])}
              />
            </div>
            <div>
              <h2 className="mb-2 text-sm font-medium">Campaign results</h2>
              <Table head={["Result", "Count"]} rows={countsRows(c.campaignStates)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Call cost needs Twilio's real invoice rates; it is never estimated.
          </p>
        </>
      )}
    </Shell>
  );
}
