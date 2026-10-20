import { Link } from "@tanstack/react-router";
import { rows } from "@/lib/rows";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useGoals, useProfile } from "@/lib/data";
import { feasibilityReport, startOfWeek } from "@/lib/scheduler";
import { planningGoals } from "@/lib/goals";

const h = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
const LABEL = {
  feasible: "Fits your week",
  partial: "Fits at minimum",
  infeasible: "Doesn't fit",
} as const;
const TONE = {
  feasible: "text-primary",
  partial: "text-warning",
  infeasible: "text-destructive",
} as const;

export function FeasibilityCard() {
  const { data: profile } = useProfile();
  const { data: goals = [] } = useGoals();
  const { data: commitments = [] } = useQuery({
    queryKey: ["commitments"],
    queryFn: async () => rows(await supabase.from("commitments").select("*").eq("active", true)),
  });
  if (!profile) return null;
  const split = planningGoals(goals);
  if (!split.ready.length) return null;
  const r = feasibilityReport(
    { ...profile, commitments },
    split.ready,
    startOfWeek(new Date(), profile.timezone),
    new Date(),
  );
  const c = r.capacity;
  return (
    <section className="mt-5 rounded-[14px] border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Will your goals fit?
        </p>
        <span className={`text-sm font-semibold ${TONE[r.level]}`}>{LABEL[r.level]}</span>
      </div>
      <p className="mt-2 text-sm">{r.explanation}</p>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">How your week's time is used</summary>
        <ul className="mt-2 space-y-1">
          <li>Awake time: {h(c.awake_min)} (sleep is protected)</li>
          <li>Work: {h(c.work_min)}</li>
          <li>Fixed commitments + travel buffers: {h(c.commitments_min)}</li>
          <li>Morning, evening and commute routines: {h(c.routine_buffers_min)}</li>
          <li>Spare buffer kept free (10%): {h(c.resilience_min)}</li>
          <li className="font-medium text-foreground">
            Usable for goals: {h(c.usable_min)} · goals want {h(r.demand_preferred_min)} (minimum{" "}
            {h(r.demand_minimum_min)})
          </li>
        </ul>
      </details>
      <ul className="mt-3 space-y-1.5 text-sm">
        {r.goals.map((g) => (
          <li key={g.goal_id} className="flex justify-between gap-3">
            <Link to="/app/goals/$id" params={{ id: g.goal_id }} className="hover:text-primary">
              {g.title}
            </Link>
            <span
              className={
                g.status === "below_minimum"
                  ? "text-destructive"
                  : g.status === "minimum"
                    ? "text-warning"
                    : "text-muted-foreground"
              }
            >
              {h(g.placed_min)} of {h(g.preferred_min)}
              {g.status === "below_minimum"
                ? ` · ${h(g.shortfall_vs_minimum)} short of minimum`
                : ""}
            </span>
          </li>
        ))}
        {split.waiting.map((w) => (
          <li key={w.goal.id} className="flex justify-between gap-3 text-muted-foreground">
            <span>{w.goal.title}</span>
            <span>waiting on {w.waitingOn.join(", ")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
