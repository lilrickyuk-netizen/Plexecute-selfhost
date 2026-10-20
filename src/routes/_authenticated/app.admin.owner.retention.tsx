import { createFileRoute } from "@tanstack/react-router";
import { Stat } from "@/components/AdminUI";
import { useAnalytics, Shell, Grid, Table, pct, nice } from "@/components/OwnerKit";

export const Route = createFileRoute("/_authenticated/app/admin/owner/retention")({
  head: () => ({
    meta: [
      { title: "Owner retention | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner retention in Plexecute." },
      { property: "og:title", content: "Owner retention | Plexecute" },
      { property: "og:description", content: "Manage Owner retention in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Retention,
});
const DAYS = ["7", "14", "30", "60", "90"];
type Ret = Record<string, { eligible: number; kept: number }>;
const cell = (r: Ret | undefined, d: string) =>
  r?.[d] ? (r[d].eligible ? `${pct(r[d].kept, r[d].eligible)} (${r[d].eligible})` : "—") : "—";

function Retention() {
  const { data: d, error, isLoading, picker } = useAnalytics();
  const t = d?.retention;
  const breakdown = (title: string, o: Record<string, Ret>) => (
    <div>
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      <Table
        head={["Group", ...DAYS.map((x) => `${x}-day`)]}
        rows={Object.entries(o)
          .sort()
          .map(([k, v]) => [nice(k), ...DAYS.map((x) => cell(v, x))])}
      />
    </div>
  );
  return (
    <Shell picker={picker} error={error} loading={isLoading}>
      {t && (
        <>
          <Grid
            title="Retention"
            note="A member counts as kept at N days if they acted on their plan on or after day N. Figures in brackets are members old enough to count. Shows “Not yet available” until anyone is old enough."
          >
            {DAYS.map((x) => (
              <Stat
                key={x}
                label={`${x}-day retention`}
                value={
                  t.overall[x]?.eligible
                    ? pct(t.overall[x].kept, t.overall[x].eligible)
                    : "Not yet available"
                }
              />
            ))}
          </Grid>
          <Grid title="Renewal and churn">
            <Stat
              label="Churn rate"
              value={pct(t.cancelled + t.cancelling, t.paying + t.cancelled)}
            />
            <Stat label="Cancelling now" value={t.cancelling} />
            <Stat label="Renewal rate" value={pct(t.paying, t.paying + t.cancelled)} />
            <Stat label="Inactive 30+ days" value={t.inactive30} />
          </Grid>
          {breakdown("By plan", t.byTier)}
          {breakdown("By source", t.bySource)}
          {breakdown("By sign-up month", t.byCohort)}
        </>
      )}
    </Shell>
  );
}
