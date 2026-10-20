import { createFileRoute } from "@tanstack/react-router";
import { Stat } from "@/components/AdminUI";
import {
  useAnalytics,
  useIntelligence,
  Shell,
  Grid,
  Table,
  pct,
  countsRows,
} from "@/components/OwnerKit";

export const Route = createFileRoute("/_authenticated/app/admin/owner/execution")({
  head: () => ({
    meta: [
      { title: "Owner execution | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner execution in Plexecute." },
      { property: "og:title", content: "Owner execution | Plexecute" },
      { property: "og:description", content: "Manage Owner execution in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Execution,
});

function Execution() {
  const { data: d, error, isLoading, picker } = useAnalytics();
  const e = d?.execution;
  const { data: li } = useIntelligence();
  const b = e?.blocks ?? {};
  const total = Object.entries(b)
    .filter(([k]) => k !== "cancelled")
    .reduce((s, [, n]) => s + n, 0);
  const sum = (...ks: string[]) => ks.reduce((s, k) => s + (b[k] ?? 0), 0);
  return (
    <Shell picker={picker} error={error} loading={isLoading}>
      {e && (
        <>
          <Grid title="Activation (all time)">
            <Stat label="Life Audit completed" value={pct(e.lifeAudit, e.members)} />
            <Stat label="First plan accepted" value={pct(e.planAccepted, e.members)} />
          </Grid>
          <Grid title="Planned actions in period">
            <Stat label="Planned actions" value={total} />
            <Stat label="Completed" value={sum("done")} />
            <Stat label="Completion rate" value={pct(sum("done"), total)} />
            <Stat label="Skipped rate" value={pct(sum("skip", "skipped"), total)} />
            <Stat label="Blocked rate" value={pct(sum("blocked"), total)} />
            <Stat label="Moved, then done" value={pct(e.movedDone, e.movedBlocks)} />
            <Stat
              label="Plans proposed / accepted"
              value={`${e.versionsInRange} / ${e.acceptedInRange}`}
            />
            <Stat label="Recovery Mode used" value={e.recoveryUses} />
          </Grid>
          <Grid title="Monthly reward and outcomes">
            <Stat
              label="Full month completed (reward earned)"
              value={(e.rewards["EARNED"] ?? 0) + (e.rewards["APPLIED"] ?? 0)}
            />
            <Stat label="Outcomes recorded" value={e.outcomes} />
          </Grid>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <h2 className="mb-2 text-sm font-medium">Actions by status</h2>
              <Table head={["Status", "Count"]} rows={countsRows(b)} />
            </div>
            <div>
              <h2 className="mb-2 text-sm font-medium">Outcomes by evidence</h2>
              <Table head={["Evidence", "Count"]} rows={countsRows(e.evidence)} />
            </div>
            <div>
              <h2 className="mb-2 text-sm font-medium">Reward months ending in period</h2>
              <Table head={["State", "Count"]} rows={countsRows(e.rewards)} />
            </div>
          </div>
          {li && (
            <>
              <Grid title="Coach intelligence">
                <Stat label="Multi-area Coach requests" value={li.multiDomain} />
                <Stat label="Daily briefings" value={li.dailyBriefs} />
                <Stat label="Weekly reviews" value={li.weeklyReviews} />
                <Stat
                  label="Proactive signals / acted on"
                  value={`${li.signals} / ${li.signalsAccepted}`}
                />
                <Stat label="Members with goal conflicts" value={li.conflicts} />
                <Stat label="Members with a goal behind" value={li.goalsBehind} />
                <Stat label="Members with open blockers" value={li.blockers} />
              </Grid>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <h2 className="mb-2 text-sm font-medium">Repeated-miss causes</h2>
                  <Table head={["Cause", "Count"]} rows={countsRows(li.failureReasons)} />
                </div>
                <div>
                  <h2 className="mb-2 text-sm font-medium">Pathway confidence</h2>
                  <Table head={["Level", "Count"]} rows={countsRows(li.confidence)} />
                </div>
                <div>
                  <h2 className="mb-2 text-sm font-medium">Goals by area (current)</h2>
                  <Table head={["Area", "Goals"]} rows={countsRows(li.goalDomains)} />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </Shell>
  );
}
