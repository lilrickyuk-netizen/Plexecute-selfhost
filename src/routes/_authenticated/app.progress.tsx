import { TrendingUp } from "lucide-react";
import { FeatureHeader } from "@/components/FeatureHeader";
import progressImage from "@/assets/member-progress.jpg";
import { unitsOf, displayToKg, weightUnit, kgToDisplay, fmtWeight } from "@/lib/units";
import { ExecutionReward } from "@/components/ExecutionReward";
import { useAllows } from "@/components/PaidGate";
import { rows } from "@/lib/rows";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useLogs, useProfile, useGoals, uid } from "@/lib/data";
import { Input } from "@/components/ui/input";
import { OutcomeLedger } from "@/components/OutcomeLedger";
import { getBehaviourModel } from "@/lib/behaviour.functions";
import { getSafety } from "@/lib/safety.functions";
import {
  goalTrajectory,
  planVsActual,
  recoveryPattern,
  smoothed,
  weeklyAdherence,
  type ProgressBlock,
} from "@/lib/progress";
import { localDayKey } from "@/lib/tz";

export const Route = createFileRoute("/_authenticated/app/progress")({
  head: () => ({
    meta: [
      { title: "Progress · Plexecute" },
      {
        name: "description",
        content:
          "Outcome-focused progress: goals, adherence, plan vs actual, training, body, recovery, learning, patterns and experiments.",
      },
      { property: "og:title", content: "Progress · Plexecute" },
      {
        property: "og:description",
        content:
          "Outcome-focused progress: goals, adherence, plan vs actual, training, body, recovery, learning, patterns and experiments.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Progress,
});

const KINDS = [
  { k: "weight", label: "Weight (kg)" },
  { k: "sleep", label: "Sleep (hours)" },
  { k: "energy", label: "Energy (1–10)" },
];
const NOTE =
  "These views describe what your records show. A link between two things here doesn't mean one caused the other.";
const card = "rounded-[20px] border border-border bg-card p-6";
const POS: Record<string, string> = {
  ahead: "Ahead of the straight-line path",
  on_line: "Close to the straight-line path",
  behind: "Behind the straight-line path",
};

function Progress() {
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const tz = profile?.timezone ?? null;
  const u = unitsOf(profile);
  const now = useMemo(() => new Date(), []);
  const since = useMemo(() => new Date(now.getTime() - 56 * 864e5).toISOString(), [now]);
  const { data: goals = [] } = useGoals();
  const { data: logs = [] } = useLogs();
  const useProgressQuery = <T,>(key: string, fn: () => Promise<T>) =>
    useQuery({ queryKey: ["progress", key], queryFn: fn });
  const { data: blocks = [] } = useProgressQuery(
    "blocks",
    async () =>
      rows(
        await supabase
          .from("plan_blocks")
          .select("id,status,starts_at,duration_min,domain,goal_id,evidence")
          .gte("starts_at", since)
          .or(`starts_at.lte.${now.toISOString()},status.in.(done,partial)`)
          .limit(2000),
      ) as ProgressBlock[],
  );
  const { data: metrics = [] } = useProgressQuery("metrics", async () =>
    rows(
      await supabase
        .from("goal_metric_entries")
        .select("goal_id,value,recorded_at")
        .order("recorded_at"),
    ),
  );
  const { data: milestones = [] } = useProgressQuery("ms", async () =>
    rows(await supabase.from("goal_milestones").select("id,goal_id,title,done_at")),
  );
  const { data: prog = [] } = useProgressQuery("prog", async () =>
    rows(
      await supabase
        .from("progression_events")
        .select("id,rule,created_at,prior,next,programme_prescriptions(exercise_key)")
        .order("created_at", { ascending: false })
        .limit(10),
    ),
  );
  const { data: checkins = [] } = useProgressQuery("rec", async () =>
    rows(
      await supabase
        .from("recovery_checkins")
        .select("check_date,readiness,sleep_quality,energy,ill_or_injured")
        .order("check_date", { ascending: false })
        .limit(60),
    ),
  );
  const { data: topics = [] } = useProgressQuery("topics", async () =>
    rows(
      await supabase
        .from("learning_topics")
        .select("id,title,done_at")
        .not("done_at", "is", null)
        .order("done_at", { ascending: false })
        .limit(8),
    ),
  );
  const { data: assess = [] } = useProgressQuery("assess", async () =>
    rows(
      await supabase
        .from("learning_assessments")
        .select("id,title,kind,score,taken_at")
        .not("score", "is", null)
        .order("taken_at", { ascending: false })
        .limit(8),
    ),
  );
  const { data: wprefs } = useProgressQuery(
    "wp",
    async () =>
      (
        await supabase
          .from("wellness_preferences")
          .select("enabled,sessions_per_week")
          .maybeSingle()
      ).data,
  );
  const { data: wsess = [] } = useProgressQuery("ws", async () =>
    rows(
      await supabase
        .from("wellness_sessions")
        .select("id,created_at,completion_state")
        .gte("created_at", since),
    ),
  );
  const { data: exps = [] } = useProgressQuery("exps", async () =>
    rows(
      await supabase
        .from("experiments")
        .select("id,title,status,result,end_date")
        .order("created_at", { ascending: false })
        .limit(6),
    ),
  );
  const fetchModel = useServerFn(getBehaviourModel);
  const modelAllowed = useAllows("behaviour_model");
  const { data: model } = useQuery({
    queryKey: ["behaviour-model"],
    queryFn: () => fetchModel(),
    enabled: !!modelAllowed,
  });
  const fetchSafety = useServerFn(getSafety);
  const { data: safety } = useQuery({ queryKey: ["safety"], queryFn: () => fetchSafety() });
  const [vals, setVals] = useState<Record<string, string>>({});

  const weeks = weeklyAdherence(blocks, tz, now, 8);
  const pva = planVsActual(blocks, now);
  const rec = recoveryPattern(checkins, 28, now, tz);
  const weights = smoothed(
    logs
      .filter((l) => l.kind === "weight")
      .map((l) => ({ day: l.log_date, value: Number(l.value) })),
  );
  const activeGoals = goals.filter((g) => g.status !== "archived");
  const bodyPaused = !!safety?.policy.blockCalorieDeficit;
  const observations = (model?.observations ?? []).filter((o) => o.enough).slice(0, 4);

  async function log(kind: string) {
    const v = Number(vals[kind]);
    if (!vals[kind] || isNaN(v)) return;
    const { error } = await supabase.from("daily_logs").insert({
      user_id: await uid(),
      kind,
      value: kind === "weight" ? displayToKg(v, u) : v,
      log_date: localDayKey(new Date(), tz),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setVals({ ...vals, [kind]: "" });
    qc.invalidateQueries({ queryKey: ["logs"] });
    toast.success("Logged");
  }

  return (
    <div>
      <div className="member-training-cover">
        <img
          src={progressImage}
          width={1536}
          height={1024}
          alt="A hand adding the final wooden block to a small stack"
        />
      </div>
      <FeatureHeader
        title="Progress"
        icon={TrendingUp}
        description="Organised around outcomes. Unknown stays unknown: only what you mark or what's verified counts."
      />
      <p className="mt-2 text-xs text-muted-foreground">{NOTE}</p>

      <Section title="Goal trajectory">
        {activeGoals.length === 0 ? (
          <Empty />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {activeGoals.map((g) => {
              const t = goalTrajectory(
                g,
                metrics.filter((m) => m.goal_id === g.id),
                tz,
                now,
              );
              const ms = milestones.filter((m) => m.goal_id === g.id);
              return (
                <Link
                  key={g.id}
                  to="/app/goals/$id"
                  params={{ id: g.id }}
                  className="rounded-[14px] border border-border bg-raised/40 p-4 hover:bg-raised"
                >
                  <p className="font-medium">{g.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.latest != null
                      ? `Latest ${t.latest}${g.target_unit ? ` ${g.target_unit}` : ""}`
                      : "No readings yet"}
                    {g.target_value != null
                      ? ` · target ${g.target_value}${g.target_unit ? ` ${g.target_unit}` : ""}`
                      : ""}
                    {t.pctToTarget != null ? ` · ${t.pctToTarget}% of the way` : ""}
                  </p>
                  <Spark values={t.points.map((p) => p.value)} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.enough
                      ? t.position
                        ? POS[t.position]
                        : "No deadline to compare against"
                      : "Needs at least 2 readings to show a trend"}
                    {ms.length
                      ? ` · milestones ${ms.filter((m) => m.done_at).length}/${ms.length}`
                      : ""}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        title="Adherence over time"
        sub="Last 8 weeks, Monday to Sunday in your time zone. Moved or cancelled sessions aren't counted."
      >
        <div className="space-y-3">
          {weeks.map((w, i) => (
            <div key={w.week} className="flex items-center gap-4 text-sm">
              <span className="w-24 text-muted-foreground">
                {i === weeks.length - 1
                  ? "This week"
                  : new Date(`${w.week}T12:00:00Z`).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
              </span>
              <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-raised">
                {w.planned > 0 && (
                  <>
                    <div
                      className="h-full bg-success"
                      style={{ width: `${(w.done / w.planned) * 100}%` }}
                    />
                    <div
                      className="h-full bg-execute/60"
                      style={{ width: `${(w.partial / w.planned) * 100}%` }}
                    />
                    <div
                      className="h-full bg-warning"
                      style={{ width: `${(w.skipped / w.planned) * 100}%` }}
                    />
                  </>
                )}
              </div>
              <span className="w-28 text-right tabular-nums text-muted-foreground">
                {w.planned ? `${w.done}/${w.planned} done` : "nothing due"}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Green done · blue partly done · amber skipped · empty not marked
        </p>
      </Section>

      <Section
        title="Plan vs actual"
        sub="Minutes planned in sessions that were due in the last 8 weeks, against minutes in sessions marked done."
      >
        {pva.length === 0 ? (
          <Empty />
        ) : (
          <ul className="divide-y divide-border text-sm">
            {pva.map((d) => (
              <li key={d.domain} className="flex justify-between gap-3 py-2">
                <span className="capitalize">{d.domain}</span>
                <span className="tabular-nums text-muted-foreground">
                  {d.doneMin} of {d.plannedMin} min · {d.doneCount}/{d.plannedCount} sessions
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Training progression"
        sub="Each change the training rules made, newest first."
      >
        {prog.length === 0 ? (
          <Empty />
        ) : (
          <ul className="divide-y divide-border text-sm">
            {prog.map((p) => {
              const pr = p.prior as Record<string, unknown>,
                nx = p.next as Record<string, unknown>;
              const ex =
                (p.programme_prescriptions as { exercise_key: string } | null)?.exercise_key ??
                "exercise";
              const diff = ["load_kg", "reps", "sets"]
                .filter((k) => pr?.[k] !== nx?.[k] && nx?.[k] != null)
                .map((k) => `${k.replace("_kg", " kg")}: ${pr?.[k] ?? "–"} → ${nx[k]}`)
                .join(", ");
              return (
                <li key={p.id} className="flex justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium capitalize">{ex.replaceAll("_", " ")}</span> ·{" "}
                    {p.rule.replaceAll("_", " ")}
                    {diff ? ` · ${diff}` : ""}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <Link to="/app/training" className="mt-3 inline-block text-xs text-execute">
          Training history and personal records →
        </Link>
      </Section>

      <Section
        title="Weight trend"
        sub="Each weigh-in with the average of your last 7. Daily readings move around; the average is the steadier guide."
      >
        {!bodyPaused && weights.length >= 2 ? (
          <>
            <p className="text-sm">
              Latest {fmtWeight(Number(weights[weights.length - 1]!.value), u)} · 7-reading average{" "}
              {fmtWeight(weights[weights.length - 1]!.avg, u)} · {weights.length} weigh-ins
            </p>
            <Spark values={weights.slice(-30).map((w) => w.avg)} />
          </>
        ) : (
          <Empty
            text={
              bodyPaused
                ? "Weight trends are paused while a safety note is active."
                : "Log at least 2 weigh-ins below to see a trend."
            }
          />
        )}
        <Link to="/app/nutrition" className="mt-3 inline-block text-xs text-execute">
          Nutrition targets and food adherence →
        </Link>
      </Section>

      <Section
        title="Sleep and recovery"
        sub="Your check-ins over the last 28 days. This isn't a medical or sleep assessment."
      >
        {rec.logged === 0 ? (
          <Empty text="No check-ins in the last 28 days." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 text-sm">
              <Mini label="Days checked in" value={`${rec.logged}/${rec.days}`} />
              <Mini label="Average readiness" value={rec.readiness ?? "—"} />
              <Mini label="Average sleep quality" value={rec.sleep ?? "—"} />
              <Mini label="Ill or injured days" value={rec.illDays} />
            </div>
            <Spark values={rec.series.map((c) => Number(c.readiness))} />
          </>
        )}
        <Link to="/app/recovery" className="mt-3 inline-block text-xs text-execute">
          Recovery check-in →
        </Link>
      </Section>

      <Section title="Learning milestones">
        {topics.length + assess.length === 0 ? (
          <Empty />
        ) : (
          <ul className="divide-y divide-border text-sm">
            {topics.map((t) => (
              <li key={t.id} className="flex justify-between py-2">
                <span>Finished: {t.title}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(t.done_at!).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              </li>
            ))}
            {assess.map((a) => (
              <li key={a.id} className="flex justify-between py-2">
                <span>
                  {a.title} ({a.kind}): {a.score}
                </span>
                <span className="text-xs text-muted-foreground">
                  {a.taken_at
                    ? new Date(a.taken_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {wprefs?.enabled && (
        <Section title="Wellness" sub="Guided sessions in the last 8 weeks.">
          <p className="text-sm">
            {wsess.filter((s) => s.completion_state === "completed").length} completed of{" "}
            {wsess.length} started · your target is {wprefs.sessions_per_week} a week
          </p>
        </Section>
      )}

      <Section
        title="Your patterns"
        sub="Associations found in your own history, only once there's enough evidence."
      >
        {observations.length === 0 ? (
          <Empty text="Not enough evidence yet." />
        ) : (
          <ul className="space-y-2 text-sm">
            {observations.map((o) => (
              <li key={o.key}>
                <span className="font-medium">{o.title}.</span> {o.text}{" "}
                <span className="text-xs text-muted-foreground">
                  ({o.sample} sessions, {o.days} days)
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link to="/app/patterns" className="mt-3 inline-block text-xs text-execute">
          All patterns →
        </Link>
      </Section>

      <Section title="Experiments and results">
        {exps.length === 0 ? (
          <Empty />
        ) : (
          <ul className="divide-y divide-border text-sm">
            {exps.map((x) => {
              const r = x.result as {
                enough?: boolean;
                difference?: number;
                confidence?: string;
              } | null;
              return (
                <li key={x.id} className="flex justify-between gap-3 py-2">
                  <span>{x.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {x.status !== "completed"
                      ? x.status
                      : r?.enough
                        ? `difference ${r.difference?.toFixed(1)} · ${r.confidence} confidence`
                        : "not enough readings"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Results show what happened during the experiment, not proof of cause.
        </p>
        <Link to="/app/experiments" className="mt-1 inline-block text-xs text-execute">
          Experiments →
        </Link>
      </Section>

      <ExecutionReward />
      <OutcomeLedger />

      <h2 className="mt-10 text-lg font-semibold">Daily check-in</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {KINDS.map(({ k, label: l0 }) => {
          const label = k === "weight" ? `Weight (${weightUnit(u)})` : l0;
          const show = (n: number) => (k === "weight" ? kgToDisplay(n, u) : n);
          const series = logs.filter((l) => l.kind === k);
          const last = series[series.length - 1];
          return (
            <div key={k} className="rounded-[14px] border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 font-display text-2xl font-semibold">
                {last ? show(Number(last.value)) : "—"}
              </p>
              <Spark values={series.slice(-14).map((s) => show(Number(s.value)))} />
              <div className="mt-3 flex gap-2">
                <Input
                  type="number"
                  step="0.1"
                  value={vals[k] ?? ""}
                  onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
                  className="h-8"
                  aria-label={label}
                />
                <button
                  onClick={() => log(k)}
                  className="rounded-[10px] bg-primary px-3 text-xs text-primary-foreground"
                >
                  Log
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`mt-6 ${card}`}>
      <h2 className="text-sm font-medium">{title}</h2>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
function Empty({ text = "Nothing recorded yet." }: { text?: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}
function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[14px] border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold">{value}</p>
    </div>
  );
}
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="mt-2 h-8" />;
  const min = Math.min(...values),
    max = Math.max(...values);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / (max - min || 1)) * 28}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 32" className="mt-2 h-8 w-full" preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
