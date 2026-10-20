import { createFileRoute, Link } from "@tanstack/react-router";
import { VoiceInputButton, WithVoice } from "@/components/VoiceInputButton";
import { appendTranscript } from "@/lib/voice-input";
import { rows } from "@/lib/rows";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useGoals, uid } from "@/lib/data";
import { DOMAINS, startOfWeek } from "@/lib/scheduler";
import { goalProgress, createsCycle, GOAL_STATUSES } from "@/lib/goals";
import { proposeWeekPlan } from "@/lib/planning.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LearningPlan } from "@/components/LearningPlan";
import { CareerResearch } from "@/components/CareerResearch";
import { BehaviourPlan } from "@/components/BehaviourPlan";
import { PathwayMilestones } from "@/components/PathwayMilestones";
import { MissionStatus } from "@/components/MissionStatus";

export const Route = createFileRoute("/_authenticated/app/goals/$id")({
  head: () => ({
    meta: [
      { title: "Goal details | Plexecute" },
      { name: "description", content: "Milestones, measures and progress for one goal." },
      { property: "og:title", content: "Goal details | Plexecute" },
      { property: "og:description", content: "Milestones, measures and progress for one goal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GoalDetail,
});

const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function GoalDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const propose = useServerFn(proposeWeekPlan);
  const { data: goals = [] } = useGoals();
  const goal = goals.find((g) => g.id === id);
  const [form, setForm] = useState<any>(null);
  const [ms, setMs] = useState({ title: "", target_value: "", due_date: "" });
  const [entry, setEntry] = useState({ value: "", note: "" });

  useEffect(() => {
    if (goal && !form) setForm({ ...goal });
  }, [goal, form]);

  const { data: milestones = [] } = useQuery({
    queryKey: ["milestones", id],
    queryFn: async () =>
      rows(
        await supabase
          .from("goal_milestones")
          .select("*")
          .eq("goal_id", id)
          .order("position")
          .order("created_at"),
      ),
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["metric-entries", id],
    queryFn: async () =>
      rows(
        await supabase
          .from("goal_metric_entries")
          .select("*")
          .eq("goal_id", id)
          .order("recorded_at", { ascending: false })
          .limit(30),
      ),
  });
  const { data: week } = useQuery({
    queryKey: ["goal-week", id],
    queryFn: async () => {
      const ws = startOfWeek(new Date());
      const we = new Date(ws);
      we.setDate(we.getDate() + 7);
      const { data } = await supabase
        .from("plan_blocks")
        .select("status,duration_min")
        .eq("goal_id", id)
        .gte("starts_at", ws.toISOString())
        .lt("starts_at", we.toISOString());
      const rows = data ?? [];
      return {
        planned: rows.reduce((s, r) => s + r.duration_min, 0),
        done: rows.filter((r) => r.status === "done").reduce((s, r) => s + r.duration_min, 0),
        count: rows.length,
      };
    },
  });

  if (!goal || !form) return <div className="text-sm text-muted-foreground">Loading goal…</div>;
  const progress = goalProgress(goal.baseline_value, goal.current_value, goal.target_value);
  const others = goals.filter((g) => g.id !== id);

  async function replan() {
    await propose({ data: { trigger: "goal_change" } });
    qc.invalidateQueries({ queryKey: ["plan-proposal"] });
  }

  async function save() {
    const num = (v: any) => (v === "" || v == null ? null : Number(v));
    const patch = {
      title: String(form.title).trim(),
      domain: form.domain,
      why: form.why || null,
      current_state: form.current_state || null,
      target_state: form.target_state || null,
      target_metric: form.target_metric || null,
      target_unit: form.target_unit || null,
      baseline_value: num(form.baseline_value),
      target_value: num(form.target_value),
      deadline: form.deadline || null,
      priority: Number(form.priority),
      minimum_weekly_minutes: Number(form.minimum_weekly_minutes),
      weekly_minutes: Number(form.weekly_minutes),
      session_minutes: Number(form.session_minutes),
      preferred_time: form.preferred_time,
      prerequisites: form.prerequisites || null,
      dependencies: form.dependencies ?? [],
      is_protected: !!form.is_protected,
      status: form.status,
      completed_at:
        form.status === "completed" ? (goal!.completed_at ?? new Date().toISOString()) : null,
    };
    if (!patch.title) {
      toast.error("Give the goal a name.");
      return;
    }
    if (patch.minimum_weekly_minutes > patch.weekly_minutes) {
      toast.error("Minimum time can't be more than preferred time.");
      return;
    }
    const { error } = await supabase.from("goals").update(patch).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["goals"] });
    await replan();
    toast.success("Goal saved. Review the proposed update in Plan.");
  }

  function toggleDep(dep: string) {
    const cur: string[] = form.dependencies ?? [];
    if (cur.includes(dep)) {
      setForm({ ...form, dependencies: cur.filter((d) => d !== dep) });
      return;
    }
    if (
      createsCycle(
        goals.map((g) => (g.id === id ? { ...g, dependencies: cur } : g)),
        id,
        dep,
      )
    ) {
      toast.error("That would make the goals wait on each other.");
      return;
    }
    setForm({ ...form, dependencies: [...cur, dep] });
  }

  async function addMilestone() {
    if (!ms.title.trim()) return;
    const { error } = await supabase.from("goal_milestones").insert({
      goal_id: id,
      user_id: await uid(),
      title: ms.title.trim(),
      target_value: ms.target_value === "" ? null : Number(ms.target_value),
      due_date: ms.due_date || null,
      position: milestones.length,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setMs({ title: "", target_value: "", due_date: "" });
    qc.invalidateQueries({ queryKey: ["milestones", id] });
  }
  async function toggleMilestone(m: any) {
    await supabase
      .from("goal_milestones")
      .update({ done_at: m.done_at ? null : new Date().toISOString() })
      .eq("id", m.id);
    qc.invalidateQueries({ queryKey: ["milestones", id] });
  }
  async function removeMilestone(mid: string) {
    await supabase.from("goal_milestones").delete().eq("id", mid);
    qc.invalidateQueries({ queryKey: ["milestones", id] });
  }

  async function logValue() {
    if (entry.value === "" || Number.isNaN(Number(entry.value))) {
      toast.error("Enter a number.");
      return;
    }
    const value = Number(entry.value);
    const { error } = await supabase
      .from("goal_metric_entries")
      .insert({ goal_id: id, user_id: await uid(), value, note: entry.note || null });
    if (error) {
      toast.error(error.message);
      return;
    }
    const patch: any = { current_value: value };
    if (goal!.baseline_value == null) patch.baseline_value = value;
    await supabase.from("goals").update(patch).eq("id", id);
    // Auto-tick milestones whose target has been reached (direction-aware).
    const up = (goal!.target_value ?? value) >= (goal!.baseline_value ?? value);
    const reached = milestones.filter(
      (m: any) =>
        !m.done_at &&
        m.target_value != null &&
        (up ? value >= m.target_value : value <= m.target_value),
    );
    if (reached.length)
      await supabase
        .from("goal_milestones")
        .update({ done_at: new Date().toISOString() })
        .in(
          "id",
          reached.map((m: any) => m.id),
        );
    setEntry({ value: "", note: "" });
    qc.invalidateQueries({ queryKey: ["goals"] });
    qc.invalidateQueries({ queryKey: ["metric-entries", id] });
    qc.invalidateQueries({ queryKey: ["milestones", id] });
    toast.success(
      reached.length
        ? `Logged. ${reached.length} milestone${reached.length > 1 ? "s" : ""} reached.`
        : "Logged.",
    );
  }

  const f = (k: string) => ({
    value: form[k] ?? "",
    onChange: (e: any) => setForm({ ...form, [k]: e.target.value }),
  });

  return (
    <div className="space-y-8">
      <div>
        <Link to="/app/goals" className="text-xs text-muted-foreground hover:text-foreground">
          ← All goals
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">{goal.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {DOMAINS.find((d) => d.value === goal.domain)?.label} ·{" "}
          {GOAL_STATUSES.find((s) => s.value === goal.status)?.label}
          {goal.is_protected ? " · Protected" : ""}
        </p>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-[14px] border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Progress to target</div>
          <div className="mt-1 text-2xl font-semibold">
            {progress == null ? "Not measured yet" : `${Math.round(progress * 100)}%`}
          </div>
          {progress != null && (
            <div className="mt-2 h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}
          <div className="mt-2 text-xs text-muted-foreground">
            {goal.baseline_value ?? "?"} → {goal.current_value ?? "?"} of {goal.target_value ?? "?"}{" "}
            {goal.target_unit ?? ""}
          </div>
        </div>
        <div className="rounded-[14px] border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">This week</div>
          <div className="mt-1 text-2xl font-semibold">
            {week ? `${week.done} / ${week.planned} min` : "…"}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {week?.count ?? 0} sessions planned · minimum {goal.minimum_weekly_minutes} min
          </div>
        </div>
        <div className="rounded-[14px] border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">Milestones</div>
          <div className="mt-1 text-2xl font-semibold">
            {milestones.filter((m: any) => m.done_at).length} / {milestones.length}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {goal.deadline ? `Deadline ${goal.deadline}` : "No deadline"}
          </div>
        </div>
      </section>

      <section className="rounded-[14px] border border-border bg-card p-4">
        <h2 className="font-semibold">Log a measurement</h2>
        <p className="text-xs text-muted-foreground">
          {goal.target_metric
            ? `${goal.target_metric}${goal.target_unit ? ` (${goal.target_unit})` : ""}`
            : "Set a measure below to track a number."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Input
            className="w-32"
            type="number"
            step="any"
            placeholder="Value"
            {...{
              value: entry.value,
              onChange: (e) => setEntry({ ...entry, value: e.target.value }),
            }}
          />
          <div className="min-w-40 flex-1">
            <WithVoice value={entry.note} onChange={(v) => setEntry({ ...entry, note: v })}>
              <Input
                aria-label="Note (optional)"

                placeholder="Note (optional)"
                value={entry.note}
                onChange={(e) => setEntry({ ...entry, note: e.target.value })}
              />
            </WithVoice>
          </div>
          <Button className="rounded-[10px]" onClick={logValue}>
            Log
          </Button>
        </div>
        {entries.length > 0 && (
          <ul className="mt-3 divide-y divide-border text-sm">
            {entries.map((e: any) => (
              <li key={e.id} className="flex justify-between py-1.5">
                <span>
                  {e.value} {goal.target_unit ?? ""}
                  {e.note ? ` · ${e.note}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(e.recorded_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MissionStatus goalId={id} />
      {(goal as any).pathway ? (
        <PathwayMilestones goal={goal as any} milestones={milestones as any} />
      ) : (
        <section className="rounded-[14px] border border-border bg-card p-4">
          <h2 className="font-semibold">Milestones</h2>
          <ul className="mt-3 space-y-2">
            {milestones.map((m: any) => (
              <li key={m.id} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={!!m.done_at}
                  onChange={() => toggleMilestone(m)}
                  aria-label={`Mark ${m.title} done`}
                />
                <span className={`flex-1 ${m.done_at ? "text-muted-foreground line-through" : ""}`}>
                  {m.title}
                  {m.target_value != null ? ` (${m.target_value} ${goal.target_unit ?? ""})` : ""}
                  {m.due_date ? ` · by ${m.due_date}` : ""}
                </span>
                <button
                  onClick={() => removeMilestone(m.id)}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              </li>
            ))}
            {milestones.length === 0 && (
              <li className="text-xs text-muted-foreground">
                No milestones yet. Break the goal into steps.
              </li>
            )}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <div className="min-w-40 flex-1">
              <WithVoice value={ms.title} onChange={(v) => setMs({ ...ms, title: v })}>
                <Input
                  aria-label="Milestone"

                  placeholder="Milestone, e.g. Run 5 km without stopping"
                  value={ms.title}
                  onChange={(e) => setMs({ ...ms, title: e.target.value })}
                />
              </WithVoice>
            </div>
            <Input
              className="w-28"
              type="number"
              step="any"
              placeholder="Target"
              value={ms.target_value}
              onChange={(e) => setMs({ ...ms, target_value: e.target.value })}
            />
            <Input
              aria-label="Milestone due date"
              className="w-40"
              type="date"
              value={ms.due_date}
              onChange={(e) => setMs({ ...ms, due_date: e.target.value })}
            />
            <Button variant="secondary" className="rounded-[10px]" onClick={addMilestone}>
              Add
            </Button>
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-[14px] border border-border bg-card p-4">
        <h2 className="font-semibold">Goal details</h2>
        <WithVoice value={form.title ?? ""} onChange={(v) => setForm({ ...form, title: v })}>
          <Input placeholder="Goal" {...f("title")} />
        </WithVoice>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            Area
            <select className={sel} {...f("domain")}>
              {DOMAINS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Status
            <select className={sel} {...f("status")}>
              {GOAL_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Where you are now
            <WithVoice
              value={form.current_state ?? ""}
              onChange={(v) => setForm({ ...form, current_state: v })}
            >
              <Input {...f("current_state")} placeholder="e.g. Can run 2 km" />
            </WithVoice>
          </label>
          <label className="text-xs text-muted-foreground">
            Where you want to be
            <WithVoice
              value={form.target_state ?? ""}
              onChange={(v) => setForm({ ...form, target_state: v })}
            >
              <Input {...f("target_state")} placeholder="e.g. Run a 10 km race" />
            </WithVoice>
          </label>
          <label className="text-xs text-muted-foreground">
            Measure
            <Input {...f("target_metric")} placeholder="e.g. Longest run" />
          </label>
          <label className="text-xs text-muted-foreground">
            Unit
            <Input {...f("target_unit")} placeholder="e.g. km" />
          </label>
          <label className="text-xs text-muted-foreground">
            Starting value
            <Input type="number" step="any" {...f("baseline_value")} />
          </label>
          <label className="text-xs text-muted-foreground">
            Target value
            <Input type="number" step="any" {...f("target_value")} />
          </label>
          <label className="text-xs text-muted-foreground">
            Deadline (optional)
            <Input type="date" {...f("deadline")} />
          </label>
          <label className="text-xs text-muted-foreground">
            Priority (5 = highest)
            <select className={sel} {...f("priority")}>
              {[5, 4, 3, 2, 1].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            Minimum min/week
            <Input type="number" min={0} {...f("minimum_weekly_minutes")} />
          </label>
          <label className="text-xs text-muted-foreground">
            Preferred min/week
            <Input type="number" min={10} {...f("weekly_minutes")} />
          </label>
          <label className="text-xs text-muted-foreground">
            Min/session
            <Input type="number" min={10} {...f("session_minutes")} />
          </label>
          <label className="text-xs text-muted-foreground">
            Best time
            <select className={sel} {...f("preferred_time")}>
              <option value="any">Any time</option>
              <option value="morning">Morning</option>
              <option value="midday">Midday</option>
              <option value="evening">Evening</option>
            </select>
          </label>
        </div>
        <label className="block text-xs text-muted-foreground">
          What you need first (prerequisites)
          <Input {...f("prerequisites")} placeholder="e.g. Running shoes, GP all-clear" />
        </label>
        <label className="block text-xs text-muted-foreground">
          Why it matters
          <Input {...f("why")} />
        </label>
        {others.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Starts after these goals are completed:
            <div className="mt-2 flex flex-wrap gap-2">
              {others.map((o) => {
                const on = (form.dependencies ?? []).includes(o.id);
                return (
                  <button
                    key={o.id}
                    onClick={() => toggleDep(o.id)}
                    className={`rounded-full border px-3 py-1 ${on ? "border-primary text-primary" : "border-border"}`}
                  >
                    {o.title}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!form.is_protected}
            onChange={(e) => setForm({ ...form, is_protected: e.target.checked })}
          />{" "}
          Protect this goal (planned first, never cut for other goals)
        </label>
        <Button className="rounded-[10px]" onClick={save}>
          Save goal
        </Button>
      </section>
      {(goal.domain === "learning" || goal.domain === "career") && (
        <CareerResearch goalId={goal.id} title={goal.title} />
      )}
      <BehaviourPlan goalId={goal.id} />
      {goal.domain === "learning" && <LearningPlan goalId={goal.id} deadline={goal.deadline} />}
    </div>
  );
}
