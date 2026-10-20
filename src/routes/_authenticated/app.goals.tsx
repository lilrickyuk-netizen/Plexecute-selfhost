import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { goalProgress, planningGoals } from "@/lib/goals";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useGoals, useProfile, uid } from "@/lib/data";
import { DOMAINS } from "@/lib/scheduler";
import { proposeWeekPlan } from "@/lib/planning.functions";
import { GoalEditor } from "@/components/GoalEditor";
import { DeleteWithImpact } from "@/components/DeleteWithImpact";
import { previewGoalDeletion, deleteGoalConfirmed } from "@/lib/deletion.functions";
import { Button } from "@/components/ui/button";
import { LifeDirection } from "@/components/LifeDirection";
import { FeatureHeader } from "@/components/FeatureHeader";
import { Target } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/goals")({
  head: () => ({
    meta: [
      { title: "Goals | Plexecute" },
      { name: "description", content: "Your goals, milestones and progress measures." },
      { property: "og:title", content: "Goals | Plexecute" },
      { property: "og:description", content: "Your goals, milestones and progress measures." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Goals,
});

const blank = {
  title: "",
  domain: "training",
  weekly_minutes: 120,
  session_minutes: 45,
  preferred_time: "any",
  why: "",
};

function Goals() {
  const matchRoute = useMatchRoute();
  if (matchRoute({ to: "/app/goals/$id" })) return <Outlet />;
  return <GoalsList />;
}

function GoalsList() {
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const propose = useServerFn(proposeWeekPlan);
  const { data: goals = [] } = useGoals();
  const [draft, setDraft] = useState<typeof blank | null>(null);
  const [del, setDel] = useState<{ id: string; title: string } | null>(null);
  const previewDel = useServerFn(previewGoalDeletion);
  const runDel = useServerFn(deleteGoalConfirmed);
  const active = goals.filter((g) => g.status === "active");
  const waiting = new Map(planningGoals(goals).waiting.map((w) => [w.goal.id, w.waitingOn]));
  const max = profile?.tier === "free" ? 3 : 20;

  async function refresh() {
    qc.invalidateQueries({ queryKey: ["goals"] });
    if (profile) {
      await propose({ data: { trigger: "goal_change" } });
      qc.invalidateQueries({ queryKey: ["plan-proposal"] });
    }
  }

  async function add() {
    if (!draft?.title.trim()) return;
    const { data, error } = await supabase
      .from("goals")
      .insert({ ...draft, user_id: await uid() })
      .select()
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setDraft(null);
    await refresh();
    toast.success("Goal added. Review the proposed update in Plan.");
  }

  async function setStatus(id: string, status: string) {
    await supabase.from("goals").update({ status }).eq("id", id);
    await refresh();
  }

  function dismiss(id: string) {
    setDel({ id, title: goals.find((g) => g.id === id)?.title ?? "goal" });
  }

  const proposed = goals.filter((g) => g.status === "proposed");

  return (
    <div>
      <FeatureHeader
        title="Goals"
        icon={Target}
        description={`${active.length} of ${max} active goals on your plan.`}
        actions={
          <Button asChild variant="secondary">
            <Link to="/app/pathway">Plan any goal</Link>
          </Button>
        }
      />
      {proposed.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-medium">Proposed by your coach</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These only join your plan when you confirm them.
          </p>
          <div className="mt-3 space-y-3">
            {proposed.map((g) => (
              <div
                key={g.id}
                className="flex items-center gap-4 rounded-[14px] border border-primary/40 bg-card p-4"
              >
                <div className="flex-1">
                  <div className="font-medium">{g.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {DOMAINS.find((d) => d.value === g.domain)?.label} · {g.weekly_minutes} min/week
                    · {g.session_minutes} min sessions
                  </div>
                  {g.why && <div className="mt-1 text-xs text-muted-foreground">{g.why}</div>}
                </div>
                <Button
                  className="rounded-[10px]"
                  disabled={active.length >= max}
                  onClick={async () => {
                    await setStatus(g.id, "active");
                    toast.success("Goal added. Review the proposed update in Plan.");
                  }}
                >
                  Confirm
                </Button>
                <button
                  onClick={() => dismiss(g.id)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="member-goal-grid mt-6">
        {goals
          .filter((g) => g.status !== "proposed" && g.status !== "superseded")
          .map((g) => (
            <div
              key={g.id}
              className="member-goal-card grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
            >
              <div className="flex-1">
                <Link
                  to="/app/goals/$id"
                  params={{ id: g.id }}
                  className={`font-medium hover:text-primary ${g.status !== "active" ? "text-muted-foreground" : ""}`}
                >
                  {g.title}
                  {g.is_protected ? " · Protected" : ""}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {DOMAINS.find((d) => d.value === g.domain)?.label} · {g.weekly_minutes} min/week ·{" "}
                  {g.session_minutes} min sessions
                  {g.status !== "active"
                    ? ` · ${g.status === "abandoned" ? "stopped" : g.status}`
                    : ""}
                  {(() => {
                    const p = goalProgress(g.baseline_value, g.current_value, g.target_value);
                    return p == null ? null : ` · ${Math.round(p * 100)}% to target`;
                  })()}
                </div>
                {waiting.has(g.id) && (
                  <div className="text-xs text-warning">
                    Waiting on: {waiting.get(g.id)?.join(", ")} (not planned yet)
                  </div>
                )}
                {(() => {
                  const progress = goalProgress(g.baseline_value, g.current_value, g.target_value);
                  return progress == null ? null : (
                    <progress
                      className="member-goal-progress"
                      value={progress}
                      max={1}
                      aria-label={`${g.title} progress`}
                    />
                  );
                })()}
              </div>
              <div className="flex flex-col items-end gap-1">
                {g.status === "active" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStatus(g.id, "paused")}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Pause
                  </Button>
                ) : g.status === "paused" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={active.length >= max}
                    onClick={() => setStatus(g.id, "active")}
                    className="text-xs text-primary disabled:opacity-40"
                  >
                    Resume
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDel({ id: g.id, title: g.title })}
                  aria-label={`Delete ${g.title}`}
                  className="text-xs text-destructive hover:underline"
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
      </div>
      <LifeDirection activeGoals={active.length} />
      <DeleteWithImpact
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title={`Delete "${del?.title ?? ""}"?`}
        load={() => previewDel({ data: { goalId: del!.id } })}
        run={(token) => runDel({ data: { goalId: del!.id, confirm: true, token } })}
        onDone={() => {
          qc.invalidateQueries();
        }}
      />
      {draft ? (
        <div className="mt-6 space-y-3">
          <GoalEditor goal={draft} onChange={setDraft} />
          <div className="flex gap-2">
            <Button className="rounded-[10px]" onClick={add}>
              Save goal
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          className="mt-6 rounded-[10px]"
          disabled={active.length >= max}
          onClick={() => setDraft(blank)}
        >
          {active.length >= max ? "Goal limit reached on Free" : "Add goal"}
        </Button>
      )}
    </div>
  );
}
