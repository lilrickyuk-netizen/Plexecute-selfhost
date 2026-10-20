import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  ownerCohorts,
  ownerSaveCohort,
  ownerDeleteCohort,
  ownerCohortMetrics,
  SOURCES,
  type CohortRules,
} from "@/lib/owner.functions";
import { pct } from "@/components/OwnerKit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/app/admin/owner/cohorts")({
  head: () => ({
    meta: [
      { title: "Owner cohorts | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner cohorts in Plexecute." },
      { property: "og:title", content: "Owner cohorts | Plexecute" },
      { property: "og:description", content: "Manage Owner cohorts in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Cohorts,
});

const sel = "h-9 rounded-md border border-border bg-background px-2 text-sm";

function CohortRow({
  name,
  rules,
  onDelete,
}: {
  name: string;
  rules: CohortRules;
  onDelete?: () => void;
}) {
  const fn = useServerFn(ownerCohortMetrics);
  const { data: m, error } = useQuery({
    queryKey: ["owner-cohort", rules],
    queryFn: () => fn({ data: { rules } }),
  });
  if (error)
    return (
      <tr>
        <td className="p-2">{name}</td>
        <td colSpan={12} className="p-2 text-destructive">
          Couldn't load.
        </td>
      </tr>
    );
  if (!m)
    return (
      <tr>
        <td className="p-2">{name}</td>
        <td colSpan={12} className="p-2 text-muted-foreground">
          Loading…
        </td>
      </tr>
    );
  const cells = [
    m.members,
    pct(m.lifeAudit, m.members),
    pct(m.planAccepted, m.members),
    pct(m.activeWeek, m.members),
    pct(m.blocksDone, m.blocksPlanned),
    m.rewardsEarned,
    m.paying,
    m.renewed,
    pct(m.cancelled, m.paying + m.cancelled),
    m.members ? (m.supportIssues / m.members).toFixed(2) : "—",
    `${m.callCampaigns} / ${Math.round(m.connectedSeconds / 60)}m`,
    m.aiEvents,
    m.outcomes,
  ];
  return (
    <tr className="border-t border-border">
      <td className="p-2 font-medium">
        {name}
        {onDelete && (
          <button onClick={onDelete} className="ml-2 text-xs text-muted-foreground underline">
            Delete
          </button>
        )}
      </td>
      {cells.map((c, i) => (
        <td key={i} className="p-2 tabular-nums">
          {c}
        </td>
      ))}
    </tr>
  );
}

function Cohorts() {
  const list = useServerFn(ownerCohorts);
  const save = useServerFn(ownerSaveCohort);
  const del = useServerFn(ownerDeleteCohort);
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: ["owner-cohorts"], queryFn: () => list() });
  const [name, setName] = useState("");
  const [r, setR] = useState<
    Partial<
      Record<
        | "signup_from"
        | "signup_to"
        | "tier"
        | "source"
        | "sub_state"
        | "active"
        | "tag"
        | "first_n",
        string
      >
    >
  >({});
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof r) => (e: { target: { value: string } }) =>
    setR((o) => ({ ...o, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const rules = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== "")) as CohortRules;
    try {
      await save({ data: { name, rules } });
      setName("");
      setR({});
      qc.invalidateQueries({ queryKey: ["owner-cohorts"] });
    } catch {
      setMsg("Give the cohort a name and check the filters.");
    }
  };

  // Monthly signup cohorts for the last 6 months, computed from real signups.
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i + 1, 0));
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    return {
      name: `Signed up ${s.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}`,
      rules: { signup_from: iso(s), signup_to: iso(e) } as CohortRules,
    };
  });

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-3 rounded-[14px] border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Save a cohort</h2>
        <div className="flex flex-wrap gap-2">
          <label className="text-xs">
            Name
            <Input
              aria-label="Cohort name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 w-56"
            />
          </label>
          <label className="text-xs">
            Signed up from
            <Input
              type="date"
              aria-label="Signed up from"
              value={r.signup_from ?? ""}
              onChange={set("signup_from")}
              className="h-9"
            />
          </label>
          <label className="text-xs">
            Signed up to
            <Input
              type="date"
              aria-label="Signed up to"
              value={r.signup_to ?? ""}
              onChange={set("signup_to")}
              className="h-9"
            />
          </label>
          <label className="flex flex-col text-xs">
            Plan
            <select aria-label="Plan" className={sel} value={r.tier ?? ""} onChange={set("tier")}>
              <option value="">Any</option>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="execute">Execute</option>
            </select>
          </label>
          <label className="flex flex-col text-xs">
            Source
            <select
              aria-label="Source"
              className={sel}
              value={r.source ?? ""}
              onChange={set("source")}
            >
              <option value="">Any</option>
              {SOURCES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs">
            Subscription
            <select
              aria-label="Subscription"
              className={sel}
              value={r.sub_state ?? ""}
              onChange={set("sub_state")}
            >
              <option value="">Any</option>
              {["none", "trialing", "active", "past_due", "canceled"].map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs">
            Activity (30 days)
            <select
              aria-label="Activity"
              className={sel}
              value={r.active ?? ""}
              onChange={set("active")}
            >
              <option value="">Any</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
          <label className="flex flex-col text-xs">
            Tag
            <select aria-label="Tag" className={sel} value={r.tag ?? ""} onChange={set("tag")}>
              <option value="">Any</option>
              {(data?.tags ?? []).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            First N members
            <Input
              type="number"
              min={1}
              aria-label="First N members"
              value={r.first_n ?? ""}
              onChange={set("first_n")}
              className="h-9 w-28"
            />
          </label>
        </div>
        <Button type="submit" size="sm">
          Save cohort
        </Button>
        {msg && <p className="text-sm text-destructive">{msg}</p>}
        <p className="text-xs text-muted-foreground">
          Tags are added on a member's page. Campaign and country aren't recorded, so they can't be
          filtered.
        </p>
      </form>

      {error && <p className="text-sm text-destructive">Couldn't load cohorts.</p>}
      <div className="overflow-x-auto rounded-[14px] border border-border">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              {[
                "Cohort",
                "Members",
                "Life Audit",
                "Plan accepted",
                "Active this week",
                "Sessions done (30d)",
                "Rewards earned",
                "Paying",
                "Renewed",
                "Churn",
                "Support per member",
                "Calls / minutes",
                "AI uses",
                "Outcomes",
              ].map((h) => (
                <th key={h} className="p-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.saved ?? []).map((c) => (
              <CohortRow
                key={c.id}
                name={c.name}
                rules={c.rules}
                onDelete={async () => {
                  await del({ data: { id: c.id } });
                  qc.invalidateQueries({ queryKey: ["owner-cohorts"] });
                }}
              />
            ))}
            {(data?.presets ?? []).map((c) => (
              <CohortRow key={c.name} name={c.name} rules={c.rules} />
            ))}
            {months.map((c) => (
              <CohortRow key={c.name} name={c.name} rules={c.rules} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Revenue and AI/provider cost per cohort stay unavailable until real payment and invoice data
        exist. Each row is counted from stored records.
      </p>
    </div>
  );
}
