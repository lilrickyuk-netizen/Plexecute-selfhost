import { Route as RouteIcon } from "lucide-react";
import { FeatureHeader } from "@/components/FeatureHeader";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { draftGoalPathway, acceptGoalPathway } from "@/lib/pathway.functions";
import { proposeWeekPlan } from "@/lib/planning.functions";
import { assessPathway, CAPABILITY_LABEL, fmtMoney, type PathwayDraft } from "@/lib/pathway";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WithVoice } from "@/components/VoiceInputButton";

export const Route = createFileRoute("/_authenticated/app/pathway")({
  head: () => ({
    meta: [
      { title: "Plan any goal | Plexecute" },
      {
        name: "description",
        content:
          "Turn any goal into a researched, realistic pathway with milestones and actions that fit your life.",
      },
      { property: "og:title", content: "Plan any goal | Plexecute" },
      {
        property: "og:description",
        content: "A researched, realistic pathway to any goal, fitted around your real week.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { goal?: string } =>
    typeof s["goal"] === "string" ? { goal: s["goal"].slice(0, 400) } : {},
  component: PathwayPage,
});

type DraftResult = Awaited<ReturnType<typeof draftGoalPathway>>;
const num = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));
const todayKey = () => new Date().toISOString().slice(0, 10);

function PathwayPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const draftFn = useServerFn(draftGoalPathway);
  const acceptFn = useServerFn(acceptGoalPathway);
  const propose = useServerFn(proposeWeekPlan);
  const search = Route.useSearch();
  const [f, setF] = useState({
    goal: search.goal ?? "",
    deadline: "",
    jurisdiction: "",
    budget: "",
    monthly_saving: "",
    current: "",
    feedback: "",
    answers: "",
  });
  const [res, setRes] = useState<DraftResult | null>(null);
  const [busy, setBusy] = useState(false);

  const draft = res?.status === "draft" ? (res.draft as PathwayDraft) : null;
  const assessment = useMemo(() => {
    if (!draft || res?.status !== "draft") return null;
    return assessPathway(draft, {
      today: todayKey(),
      deadline: f.deadline || null,
      weeklyMinutesAvailable: res.assessment.weekly_minutes_available,
      budget: num(f.budget),
      monthlySaving: num(f.monthly_saving),
      current: num(f.current),
    });
  }, [draft, res, f.deadline, f.budget, f.monthly_saving, f.current]);
  const money = (n: number) => fmtMoney(n, res?.status === "draft" ? res.currency : "GBP");

  async function build(revise = false) {
    if (f.goal.trim().length < 2) return;
    setBusy(true);
    try {
      const goal = f.answers.trim() ? `${f.goal.trim()}. ${f.answers.trim()}` : f.goal.trim();
      const r = await draftFn({
        data: {
          goal,
          deadline: f.deadline || null,
          jurisdiction: f.jurisdiction || null,
          budget: num(f.budget),
          monthly_saving: num(f.monthly_saving),
          current: num(f.current),
          feedback: revise ? f.feedback || null : null,
          previous: revise && draft ? draft : undefined,
        },
      });
      setRes(r);
      if (revise) setF((x) => ({ ...x, feedback: "" }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!draft) return;
    setBusy(true);
    try {
      const r: any = await acceptFn({
        data: {
          draft,
          deadline: f.deadline || null,
          budget: num(f.budget),
          monthly_saving: num(f.monthly_saving),
          current: num(f.current),
        },
      });
      if (r.status !== "saved") {
        toast.error(
          r.errors?.[0] ?? r.assessment?.reasons?.[0] ?? "This pathway can't be accepted yet.",
        );
        return;
      }
      await propose({ data: { trigger: "goal_change" } }).catch(() => undefined);
      qc.invalidateQueries();
      toast.success("Goal added. Review the proposed update in Plan.");
      nav({ to: "/app/goals/$id", params: { id: r.goal_id } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <div className="max-w-3xl">
      <Link to="/app/goals" className="text-sm text-muted-foreground hover:text-foreground">
        ← Goals
      </Link>
      <FeatureHeader
        title="Plan any goal"
        icon={RouteIcon}
        description='Describe any goal. Plexecute works out what "done" means, checks current requirements where they matter, and tests the route against your real week and budget before anything joins your plan.'
      />

      <section className="mt-6 space-y-3 rounded-[14px] border border-border bg-card p-4">
        <WithVoice value={f.goal} onChange={(v) => setF({ ...f, goal: v })}>
          <Input
            aria-label="Your goal"
            placeholder="e.g. Qualify as an electrician, save £10,000, write a novel"
            value={f.goal}
            onChange={set("goal")}
          />
        </WithVoice>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-muted-foreground">
            Target date (optional)
            <Input type="date" value={f.deadline} onChange={set("deadline")} />
          </label>
          <label className="text-xs text-muted-foreground">
            Money available now (optional)
            <Input
              type="number"
              min="0"
              inputMode="decimal"
              value={f.budget}
              onChange={set("budget")}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Can set aside per month (optional)
            <Input
              type="number"
              min="0"
              inputMode="decimal"
              value={f.monthly_saving}
              onChange={set("monthly_saving")}
            />
          </label>
        </div>
        <Button
          className="rounded-[10px]"
          disabled={busy || f.goal.trim().length < 2}
          onClick={() => build(false)}
        >
          {busy && !draft ? "Working it out…" : "Build my pathway"}
        </Button>
      </section>

      {res?.status === "safety" || res?.status === "refused" ? (
        <div className="mt-6 rounded-[14px] border border-destructive/40 bg-card p-4 text-sm">
          {res.message}
        </div>
      ) : null}

      {res?.status === "clarify" && (
        <section className="mt-6 space-y-3 rounded-[14px] border border-primary/40 bg-card p-4">
          <h2 className="font-semibold">A quick question first</h2>
          <ul className="list-disc pl-5 text-sm">
            {res.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <Textarea
            aria-label="Your answer"
            value={f.answers}
            onChange={set("answers")}
            placeholder="Your answer"
          />
          <Button
            className="rounded-[10px]"
            disabled={busy || !f.answers.trim()}
            onClick={() => build(false)}
          >
            Continue
          </Button>
        </section>
      )}

      {draft && assessment && res?.status === "draft" && (
        <div className="mt-6 space-y-4">
          <section className="rounded-[14px] border border-border bg-card p-4">
            <h2 className="text-xl font-semibold">{draft.goal_title}</h2>
            <p className="mt-1 text-sm">Done when: {draft.success.definition}</p>
            {draft.jurisdiction && (
              <p className="mt-1 text-xs text-muted-foreground">Based on {draft.jurisdiction}</p>
            )}
            {res.boundary && <p className="mt-2 text-xs text-warning">{res.boundary}</p>}
          </section>

          <section
            className={`rounded-[14px] border bg-card p-4 ${assessment.level === "infeasible" ? "border-destructive/50" : assessment.level === "tight" ? "border-warning/50" : "border-success/40"}`}
          >
            <h3 className="font-semibold">
              {assessment.level === "infeasible"
                ? "Not realistic as it stands"
                : assessment.level === "tight"
                  ? "Realistic, but tight"
                  : "Realistic around your week"}
            </h3>
            <p className="mt-1 text-sm">
              {assessment.earliest_date
                ? `Earliest realistic finish: ${assessment.earliest_date} (about ${assessment.needed_weeks} weeks).`
                : "No finish date can be worked out yet."}{" "}
              You have about {Math.round(assessment.weekly_minutes_available / 60)} h a week free.
            </p>
            {assessment.money.required > 0 && (
              <p className="mt-1 text-sm">
                Known costs: {money(assessment.money.required)}
                {assessment.money.shortfall > 0
                  ? ` · gap ${money(assessment.money.shortfall)}`
                  : ""}
              </p>
            )}
            {assessment.reasons.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm">
                {assessment.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            {assessment.alternatives.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                {assessment.alternatives.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            {assessment.level === "infeasible" && assessment.earliest_date && f.deadline && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={() => setF({ ...f, deadline: assessment.earliest_date })}
              >
                Use the earliest realistic date
              </Button>
            )}
          </section>

          {draft.options.length > 0 && (
            <section className="rounded-[14px] border border-border bg-card p-4">
              <h3 className="font-semibold">Routes</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {draft.options.map((o) => (
                  <li key={o.key} className={o.key === draft.chosen_option ? "font-medium" : ""}>
                    {o.key === draft.chosen_option ? "✓ " : ""}
                    {o.title} — {o.summary} {o.months ? `· ~${o.months} months` : ""}{" "}
                    {o.cost ? `· ~${money(o.cost)}` : ""} {o.risk ? `· risk: ${o.risk}` : ""}
                  </li>
                ))}
              </ul>
              {draft.choice_reason && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Why this route: {draft.choice_reason}
                </p>
              )}
            </section>
          )}

          {(draft.prerequisites.length > 0 || draft.resources.length > 0) && (
            <section className="grid gap-4 rounded-[14px] border border-border bg-card p-4 sm:grid-cols-2">
              <div>
                <h3 className="font-semibold">Must be true first</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {draft.prerequisites.map((p) => (
                    <li key={p.title}>
                      {p.met ? "✓" : p.met === false ? "✗" : "?"} {p.title}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-semibold">You'll need</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {draft.resources.map((r) => (
                    <li key={r.title}>
                      {r.title}
                      {r.amount ? ` (${r.kind === "money" ? money(r.amount) : r.amount})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          <section className="rounded-[14px] border border-border bg-card p-4">
            <h3 className="font-semibold">Milestones</h3>
            <ol className="mt-2 space-y-2 text-sm">
              {draft.milestones.map((m) => (
                <li key={m.key}>
                  <div className="font-medium">
                    Stage {m.stage}: {m.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {CAPABILITY_LABEL[m.capability]} · ~{m.effort_hours} h
                    {m.min_weeks ? ` · at least ${m.min_weeks} weeks` : ""}
                    {m.cost ? ` · ${money(m.cost)}` : ""}
                    {m.depends_on.length
                      ? ` · after ${m.depends_on.map((k) => draft.milestones.find((x) => x.key === k)?.title ?? k).join(", ")}`
                      : ""}
                  </div>
                  {m.stage === draft.milestones[0]?.stage && (
                    <ul className="mt-1 list-disc pl-5 text-xs">
                      {m.actions.map((a) => (
                        <li key={a.title}>
                          {a.title} ({a.minutes} min)
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </section>

          {(draft.assumptions.length > 0 || draft.risks.length > 0) && (
            <section className="rounded-[14px] border border-border bg-card p-4 text-sm">
              {draft.assumptions.length > 0 && (
                <>
                  <h3 className="font-semibold">Assumptions</h3>
                  <ul className="mt-1 list-disc pl-5">
                    {draft.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
              {draft.risks.length > 0 && (
                <>
                  <h3 className="mt-3 font-semibold">Key risks</h3>
                  <ul className="mt-1 list-disc pl-5">
                    {draft.risks.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          {res.research.required && (
            <section className="rounded-[14px] border border-border bg-card p-4 text-sm">
              <h3 className="font-semibold">Sources checked</h3>
              {draft.sources.filter((s) => s.fact).length === 0 ? (
                <p className="mt-1 text-muted-foreground">
                  No current sources could be confirmed. Check costs and entry rules with the
                  official body.
                </p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {draft.sources
                    .filter((s) => s.fact)
                    .map((s) => (
                      <li key={s.url}>
                        {s.fact} —{" "}
                        <a
                          className="text-primary underline"
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {s.publisher}
                        </a>
                      </li>
                    ))}
                </ul>
              )}
              {draft.research_confidence !== "high" && (
                <p className="mt-2 text-xs text-warning">
                  Research confidence: {draft.research_confidence}. Some facts may need checking.
                </p>
              )}
            </section>
          )}

          {res.errors.length > 0 && (
            <div className="rounded-[14px] border border-warning/50 bg-card p-4 text-sm">
              This pathway needs fixing before it can be used: {res.errors.join(" ")}
            </div>
          )}

          <section className="space-y-3 rounded-[14px] border border-border bg-card p-4">
            <div className="flex flex-wrap gap-2">
              <Button
                className="rounded-[10px]"
                disabled={busy || assessment.level === "infeasible" || res.errors.length > 0}
                onClick={accept}
              >
                Accept and add to my plan
              </Button>
            </div>
            <WithVoice value={f.feedback} onChange={(v) => setF({ ...f, feedback: v })}>
              <Input
                aria-label="Ask to change"
                placeholder="Ask to change, e.g. I can only study at weekends"
                value={f.feedback}
                onChange={set("feedback")}
              />
            </WithVoice>
            <Button
              variant="secondary"
              disabled={busy || !f.feedback.trim()}
              onClick={() => build(true)}
            >
              {busy ? "Updating…" : "Ask to change"}
            </Button>
            <p className="text-xs text-muted-foreground">
              After accepting you can edit any milestone on the goal page.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
