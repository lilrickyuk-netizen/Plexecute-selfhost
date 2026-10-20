import { Map as MapIcon } from "lucide-react";
import { FeatureHeader } from "@/components/FeatureHeader";
import { localDayKey, localDayRange } from "@/lib/tz";
import { rows } from "@/lib/rows";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useGoals, useProfile } from "@/lib/data";
import { DOMAINS, feasibilityReport, startOfWeek } from "@/lib/scheduler";
import { goalProgress, planningGoals } from "@/lib/goals";

export const Route = createFileRoute("/_authenticated/app/lifemap")({
  head: () => ({
    meta: [
      { title: "Life map | Plexecute" },
      {
        name: "description",
        content: "Your long-range, monthly, weekly and daily plan in one view.",
      },
      { property: "og:title", content: "Life map | Plexecute" },
      {
        property: "og:description",
        content: "Your long-range, monthly, weekly and daily plan in one view.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LifeMap,
});

const h = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
const card = "rounded-[14px] border border-border bg-card p-4";

function LifeMap() {
  const { data: profile } = useProfile();
  const { data: goals = [] } = useGoals();
  const { data: milestones = [] } = useQuery({
    queryKey: ["all-milestones"],
    queryFn: async () =>
      rows(
        await supabase.from("goal_milestones").select("*").order("due_date", { nullsFirst: false }),
      ),
  });
  const { data: commitments = [] } = useQuery({
    queryKey: ["commitments"],
    queryFn: async () => rows(await supabase.from("commitments").select("*").eq("active", true)),
  });
  const { data: versions = [] } = useQuery({
    queryKey: ["map-versions"],
    queryFn: async () =>
      rows(
        await supabase
          .from("plan_versions")
          .select("id,version,week_start,status,apply_mode,trigger,explanation,created_at")
          .order("created_at", { ascending: false })
          .limit(12),
      ),
  });
  const { data: twinConflicts = 0 } = useQuery({
    queryKey: ["map-twin-conflicts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("life_twin_facts")
        .select("fact_key")
        .is("valid_until", null);
      const c = new Map<string, number>();
      for (const r of data ?? []) c.set(r.fact_key, (c.get(r.fact_key) ?? 0) + 1);
      return [...c.values()].filter((n) => n > 1).length;
    },
  });
  const { data: today = [] } = useQuery({
    queryKey: ["map-today"],
    queryFn: async () => {
      const [a, b] = localDayRange(new Date());
      return rows(
        await supabase
          .from("plan_blocks")
          .select("title,starts_at,duration_min,status")
          .gte("starts_at", a.toISOString())
          .lt("starts_at", b.toISOString())
          .not("status", "in", "(rescheduled,replaced)")
          .order("starts_at"),
      );
    },
  });
  const { data: recovery } = useQuery({
    queryKey: ["map-recovery"],
    queryFn: async () =>
      (
        await supabase
          .from("recovery_checkins")
          .select("check_date,readiness,soreness")
          .order("check_date", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data,
  });

  if (!profile) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const split = planningGoals(goals);
  const report = split.ready.length
    ? feasibilityReport(
        { ...profile, commitments },
        split.ready,
        startOfWeek(new Date(), profile.timezone),
        new Date(),
      )
    : null;
  const byId = new Map(goals.map((g) => [g.id, g]));
  const active = goals.filter((g) => g.status === "active");

  // Long-range horizon: up to the furthest deadline or milestone, at least 3 months.
  const now = new Date();
  const dates = [...active.map((g) => g.deadline), ...milestones.map((m) => m.due_date)].filter(
    Boolean,
  ) as string[];
  const last = dates.length ? new Date(dates.sort().at(-1)!) : now;
  const months = Math.min(
    18,
    Math.max(
      3,
      (last.getFullYear() - now.getFullYear()) * 12 + last.getMonth() - now.getMonth() + 1,
    ),
  );
  const monthKeys = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString([], { month: "short", year: "numeric" }),
    };
  });

  const conflicts = [
    ...(report?.goals
      .filter((g) => g.status === "below_minimum")
      .map((g) => `${g.title} is ${h(g.shortfall_vs_minimum)} short of its minimum this week`) ??
      []),
    ...split.waiting.map((w) => `${w.goal.title} is waiting on ${w.waitingOn.join(", ")}`),
    ...(twinConflicts
      ? [`${twinConflicts} Life Twin item${twinConflicts > 1 ? "s" : ""} disagree between sources`]
      : []),
    ...active
      .filter((g) => g.deadline && g.deadline < localDayKey(now))
      .map((g) => `${g.title} is past its deadline`),
  ];

  return (
    <div className="space-y-6">
      <div>
        <FeatureHeader
          title="Life map"
          icon={MapIcon}
          description="Where your goals are heading, from months ahead down to today."
        />
      </div>

      <section className={card}>
        <h2 className="font-semibold">Long-range and monthly plan</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr>
                <th className="py-1 text-left font-medium text-muted-foreground">Goal</th>
                {monthKeys.map((m) => (
                  <th key={m.key} className="px-1 text-left font-medium text-muted-foreground">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.map((g) => (
                <tr key={g.id} className="border-t border-border">
                  <td className="py-2 pr-2">
                    <Link
                      to="/app/goals/$id"
                      params={{ id: g.id }}
                      className="font-medium hover:text-primary"
                    >
                      {g.title}
                    </Link>
                  </td>
                  {monthKeys.map((m) => {
                    const ms = milestones.filter(
                      (x) => x.goal_id === g.id && x.due_date?.startsWith(m.key),
                    );
                    const dl = g.deadline?.startsWith(m.key);
                    const live = !g.deadline || g.deadline.slice(0, 7) >= m.key;
                    return (
                      <td key={m.key} className={`px-1 align-top ${live ? "" : "opacity-30"}`}>
                        {live && <div className="h-1 rounded-full bg-primary/40" />}
                        {ms.map((x) => (
                          <div
                            key={x.id}
                            className={x.done_at ? "text-muted-foreground line-through" : ""}
                          >
                            ◆ {x.title}
                          </div>
                        ))}
                        {dl && <div className="font-semibold text-execute">Deadline</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className={card}>
          <h2 className="font-semibold">Weekly allocation</h2>
          {report ? (
            <ul className="mt-2 space-y-1 text-sm">
              {report.goals.map((g) => (
                <li key={g.goal_id} className="flex justify-between">
                  <span>{g.title}</span>
                  <span className="text-muted-foreground">
                    {h(g.placed_min)} of {h(g.preferred_min)}
                  </span>
                </li>
              ))}
              <li className="flex justify-between border-t border-border pt-1 text-xs text-muted-foreground">
                <span>Usable time</span>
                <span>{h(report.capacity.usable_min)}</span>
              </li>
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No active goals.</p>
          )}
          <Link to="/app/plan" className="mt-3 inline-block text-xs text-primary">
            Open this week's schedule →
          </Link>
        </div>
        <div className={card}>
          <h2 className="font-semibold">Today</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {today.length ? (
              today.map((b, i) => (
                <li key={i}>
                  {new Date(b.starts_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {b.title} <span className="text-muted-foreground">({b.status})</span>
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">Nothing scheduled today.</li>
            )}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Recovery:{" "}
            {recovery
              ? `last check-in ${recovery.check_date}, readiness ${recovery.readiness}/100`
              : "no check-in yet"}
            .{" "}
            <Link to="/app/recovery" className="text-primary">
              Recovery plan →
            </Link>
          </p>
        </div>
      </section>

      <section className={card}>
        <h2 className="font-semibold">Milestone map</h2>
        <ul className="mt-2 space-y-3 text-sm">
          {active.map((g) => {
            const deps = (g.dependencies ?? []).map((d) => byId.get(d)?.title).filter(Boolean);
            const ms = milestones.filter((m) => m.goal_id === g.id);
            const p = goalProgress(g.baseline_value, g.current_value, g.target_value);
            return (
              <li key={g.id}>
                <div className="font-medium">
                  {deps.length ? (
                    <span className="text-muted-foreground">{deps.join(" + ")} → </span>
                  ) : null}
                  {g.title}
                  {p != null ? (
                    <span className="text-muted-foreground"> · {Math.round(p * 100)}%</span>
                  ) : null}
                </div>
                {ms.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                    {ms.map((m, i) => (
                      <span key={m.id} className="flex items-center gap-1">
                        <span
                          className={`rounded-full border px-2 py-0.5 ${m.done_at ? "border-primary text-primary" : "border-border"}`}
                        >
                          {m.title}
                        </span>
                        {i < ms.length - 1 && "→"}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className={card}>
          <h2 className="font-semibold">Constraints</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>
              Sleep protected: {profile.sleep_time?.slice(0, 5)} to {profile.wake_time?.slice(0, 5)}
            </li>
            <li>
              Work:{" "}
              {profile.work_start
                ? `${profile.work_start.slice(0, 5)}–${profile.work_end?.slice(0, 5)} on ${profile.work_days.length} days`
                : "none set"}
            </li>
            <li>
              {commitments.length} fixed commitment{commitments.length === 1 ? "" : "s"} ·{" "}
              <Link to="/app/commitments" className="text-primary">
                manage
              </Link>
            </li>
            <li>
              Areas switched on:{" "}
              {(profile.enabled_domains ?? [])
                .map((d: string) => DOMAINS.find((x) => x.value === d)?.label ?? d)
                .join(", ") || "all"}
            </li>
          </ul>
        </div>
        <div className={card}>
          <h2 className="font-semibold">Conflicts</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {conflicts.length ? (
              conflicts.map((c, i) => (
                <li key={i} className="text-warning">
                  {c}
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">No conflicts.</li>
            )}
          </ul>
        </div>
      </section>

      <section className={card}>
        <h2 className="font-semibold">Plan versions</h2>
        <ul className="mt-2 divide-y divide-border text-sm">
          {versions.map((v) => (
            <li key={v.id} className="py-2">
              <span className="font-medium">v{v.version}</span> · week of {v.week_start} ·{" "}
              {v.status}
              {v.apply_mode
                ? ` (${v.apply_mode === "once" ? "this week only" : v.apply_mode})`
                : ""}
              <div className="text-xs text-muted-foreground">{v.explanation}</div>
            </li>
          ))}
        </ul>
        <Link to="/app/history" className="mt-2 inline-block text-xs text-primary">
          Full history →
        </Link>
      </section>
    </div>
  );
}
