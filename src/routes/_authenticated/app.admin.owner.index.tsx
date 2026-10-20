import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ownerOverview } from "@/lib/owner.functions";
import { Stat } from "@/components/AdminUI";
import { fmtPct, unknown } from "./app.admin.owner";

export const Route = createFileRoute("/_authenticated/app/admin/owner/")({
  head: () => ({
    meta: [
      { title: "Owner overview | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner overview in Plexecute." },
      { property: "og:title", content: "Owner overview | Plexecute" },
      { property: "og:description", content: "Manage Owner overview in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Overview,
});

const RANGE_LABELS = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  service_month: "This service month",
  prev_service_month: "Previous service month",
  quarter: "This quarter",
  year: "This year",
  custom: "Custom range",
} as const;
type R = keyof typeof RANGE_LABELS;

function Overview() {
  const fn = useServerFn(ownerOverview);
  const [range, setRange] = useState<R>("30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const custom = range === "custom" && from && to;
  const {
    data: d,
    error,
    isLoading,
  } = useQuery({
    queryKey: ["owner-overview", range, from, to],
    queryFn: () =>
      fn({
        data: {
          range,
          ...(custom ? { from: new Date(from).toISOString(), to: new Date(to).toISOString() } : {}),
        },
      }),
  });
  const money = (p: number | null | undefined) =>
    p == null ? unknown : `£${(p / 100).toFixed(2)}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-muted-foreground">Period</span>
          <select
            className="mt-1 h-10 rounded-md border border-border bg-background px-2"
            value={range}
            onChange={(e) => setRange(e.target.value as R)}
          >
            {Object.entries(RANGE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {range === "custom" && (
          <>
            <label className="text-sm">
              <span className="block text-muted-foreground">From</span>
              <input
                type="date"
                className="mt-1 h-10 rounded-md border border-border bg-background px-2"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="block text-muted-foreground">To</span>
              <input
                type="date"
                className="mt-1 h-10 rounded-md border border-border bg-background px-2"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </>
        )}
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">Couldn't load the overview.</p>}
      {d && (
        <>
          <Group title="Members">
            <Stat label="Registered" value={d.total} />
            <Stat label="Active in period" value={d.activeInRange} />
            <Stat label="Weekly active" value={d.wau} />
            <Stat label="Paying" value={d.paying} />
            <Stat label="Free" value={d.free} />
            <Stat label="Pro" value={d.pro} />
            <Stat label="Execute" value={d.execute} />
            <Stat label="New today / 7d / 30d" value={`${d.newToday} / ${d.new7} / ${d.new30}`} />
          </Group>
          <Group title="Revenue">
            <Stat label="MRR" value={money(d.mrrPence)} />
            <Stat
              label="Monthly revenue"
              value={d.revenueSource === "stripe" ? money(d.mrrPence) : unknown}
            />
            <Stat
              label="Billing events in period"
              value={d.revenueSource === "stripe" ? d.billingEvents : unknown}
            />
            <Stat label="Cancellations" value={d.cancelling} />
            <Stat label="Failed payments" value={d.pastDue} />
            <Stat label="Churn rate" value={fmtPct(d.churnRate)} />
          </Group>
          <Group title="Retention and activation">
            <Stat label="30-day retention" value={fmtPct(d.retention30)} />
            <Stat label="90-day retention" value={fmtPct(d.retention90)} />
            <Stat label="Life Audit completed" value={fmtPct(d.lifeAuditRate)} />
            <Stat label="First plan accepted" value={fmtPct(d.activationRate)} />
            <Stat label="Plan completion in period" value={fmtPct(d.completionRate)} />
            <Stat
              label="Execute rewards earned / applied"
              value={`${d.rewardsEarned} / ${d.rewardsApplied}`}
            />
          </Group>
          <Group title="Calls">
            <Stat label="Voice minutes" value={Math.round(d.voiceSeconds / 60)} />
            <Stat label="Call attempts" value={d.calls} />
            <Stat label="Acknowledgement rate" value={fmtPct(d.ackRate)} />
          </Group>
          <Group title="Operations">
            <Stat label="Support issues open" value={d.supportOpen} />
            <Stat label="Feedback open" value={d.feedbackOpen} />
            <Stat label="Integration failures" value={d.integrationFailures} />
            <Stat label="Background-task failures" value={d.jobFailures} />
            <Stat
              label="Incidents"
              value={d.incidentsOpen ? `${d.incidentsOpen} open` : "None open"}
            />
          </Group>
          {d.revenueSource !== "stripe" && (
            <p className="text-xs text-muted-foreground">
              Revenue figures appear once the payment service (Stripe) is connected.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>
    </section>
  );
}
