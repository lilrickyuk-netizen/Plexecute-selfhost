import { FlaskConical } from "lucide-react";
import { FeatureHeader } from "@/components/FeatureHeader";
import { createFileRoute } from "@tanstack/react-router";
import { WithVoice } from "@/components/VoiceInputButton";
import { PaidGate } from "@/components/PaidGate";
import { rows } from "@/lib/rows";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/lib/data";
import { localDayKey } from "@/lib/tz";
import {
  analyse,
  conditionOn,
  DURATIONS,
  type Segment,
  type ExperimentResult,
} from "@/lib/experiments";
import { createExperiment, logExperiment, finishExperiment } from "@/lib/experiments.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/app/experiments")({
  head: () => ({
    meta: [
      { title: "Experiments · Plexecute" },
      {
        name: "description",
        content: "Safe, bounded personal experiments comparing two options over at least 28 days.",
      },
      { property: "og:title", content: "Experiments · Plexecute" },
      {
        property: "og:description",
        content: "Compare two safe options and see what actually happened.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <PaidGate cap="experiments" title="Experiments">
      <Experiments />
    </PaidGate>
  ),
});

const blank = {
  question: "",
  hypothesis: "",
  metric: "",
  variantA: "",
  variantB: "",
  confounders: "",
  days: 28 as 28 | 56,
};

function Experiments() {
  const qc = useQueryClient();
  const create = useServerFn(createExperiment);
  const { data: exps = [], isLoading } = useQuery({
    queryKey: ["experiments"],
    queryFn: async () =>
      rows(
        await supabase
          .from("experiments")
          .select("*, experiment_entries(*)")
          .order("created_at", { ascending: false }),
      ),
  });
  const [f, setF] = useState(blank);
  const [blocked, setBlocked] = useState<string[]>([]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["experiments"] });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.question.trim() || !f.metric.trim() || !f.variantA.trim() || !f.variantB.trim()) {
      toast.error("Add a question, a measure and both options");
      return;
    }
    try {
      const r = await create({ data: f });
      if (!r.ok) {
        setBlocked(r.reasons);
        return;
      }
      setBlocked([]);
      setF(blank);
      refresh();
      toast.success("Experiment started");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div>
      <FeatureHeader
        title="Experiments"
        icon={FlaskConical}
        description="Compare two safe options. Option A runs for 2 weeks, then option B for 2 weeks. The schedule is fixed before you start, and you need at least 4 readings for each option."
      />
      <form
        onSubmit={submit}
        className="mt-6 grid gap-3 rounded-[20px] border border-border bg-card p-5"
      >
        <Input
          placeholder="Your question (e.g. Do I study better in the morning?)"
          maxLength={200}
          value={f.question}
          onChange={(e) => setF({ ...f, question: e.target.value })}
        />
        <WithVoice value={f.hypothesis} onChange={(v) => setF({ ...f, hypothesis: v })}>
          <Textarea
            placeholder="What do you expect to happen?"
            maxLength={500}
            value={f.hypothesis}
            onChange={(e) => setF({ ...f, hypothesis: e.target.value })}
          />
        </WithVoice>
        <Input
          placeholder="What you'll measure each day (e.g. minutes studied)"
          maxLength={60}
          value={f.metric}
          onChange={(e) => setF({ ...f, metric: e.target.value })}
        />
        <div className="grid gap-2 md:grid-cols-2">
          <Input
            placeholder="Option A (e.g. study at 7pm)"
            maxLength={120}
            value={f.variantA}
            onChange={(e) => setF({ ...f, variantA: e.target.value })}
          />
          <Input
            placeholder="Option B (e.g. study at 7am)"
            maxLength={120}
            value={f.variantB}
            onChange={(e) => setF({ ...f, variantB: e.target.value })}
          />
        </div>
        <WithVoice value={f.confounders} onChange={(v) => setF({ ...f, confounders: v })}>
          <Textarea
            placeholder="Anything that could skew the result (holiday, new job, illness)"
            maxLength={500}
            value={f.confounders}
            onChange={(e) => setF({ ...f, confounders: e.target.value })}
          />
        </WithVoice>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Length</span>
          {DURATIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setF({ ...f, days: d })}
              className={`rounded-[10px] border px-3 py-1 ${f.days === d ? "border-primary bg-raised" : "border-border"}`}
            >
              {d} days
            </button>
          ))}
        </div>
        {blocked.length > 0 && (
          <div className="rounded-[12px] border border-warning p-3 text-sm">
            <p className="font-medium">This experiment can't start</p>
            <ul className="mt-1 list-disc pl-5">
              {blocked.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}
        <Button type="submit" className="rounded-[10px]">
          Check safety and start
        </Button>
      </form>
      <div className="mt-8 space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && exps.length === 0 && (
          <p className="text-sm text-muted-foreground">No experiments yet.</p>
        )}
        {exps.map((x) => (
          <ExperimentCard key={x.id} x={x as unknown as Exp} onChange={refresh} />
        ))}
      </div>
    </div>
  );
}

type Exp = {
  id: string;
  title: string;
  question: string | null;
  hypothesis: string;
  metric: string;
  variant_a: string | null;
  variant_b: string | null;
  confounders: string | null;
  start_date: string;
  end_date: string | null;
  status: string;
  conclusion: string | null;
  design: string;
  min_obs: number;
  schedule: Segment[];
  result: ExperimentResult | null;
  experiment_entries: { id: string; entry_date: string; value: number; condition: string | null }[];
};

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1));

function ExperimentCard({ x, onChange }: { x: Exp; onChange: () => void }) {
  const { data: profile } = useProfile();
  const log = useServerFn(logExperiment);
  const finish = useServerFn(finishExperiment);
  const [val, setVal] = useState("");
  const [concl, setConcl] = useState(x.conclusion ?? "");
  const today = localDayKey(new Date(), profile?.timezone);
  const ab = x.design === "ab_blocks";
  const r = ab
    ? (x.result ?? analyse(x.schedule, x.experiment_entries, x.min_obs, x.confounders, today))
    : null;
  const cond = ab ? conditionOn(x.schedule, today) : null;
  const finished = ab && !!x.end_date && today > x.end_date;
  const loggedToday = x.experiment_entries.some((e) => e.entry_date === today);

  async function doLog() {
    if (val === "" || Number.isNaN(Number(val))) return;
    try {
      await log({ data: { id: x.id, value: Number(val) } });
      setVal("");
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function doFinish(status: "completed" | "abandoned") {
    try {
      await finish({ data: { id: x.id, status, conclusion: concl.trim() } });
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="rounded-[20px] border border-border bg-card p-5">
      <div className="font-medium">{x.question ?? x.title}</div>
      <div className="text-xs text-muted-foreground">
        {x.metric} ·{" "}
        {x.status === "active"
          ? ab
            ? cond
              ? `Today: option ${cond} · ends ${x.end_date}`
              : finished
                ? "Finished, ready to review"
                : "Not started"
            : "Earlier experiment (before fixed schedules)"
          : x.status}
      </div>
      {x.hypothesis && (
        <p className="mt-2 text-sm text-muted-foreground">Expected: {x.hypothesis}</p>
      )}
      {ab && r && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-[10px] bg-raised p-2">
              <div className="text-xs text-muted-foreground">
                A: {x.variant_a} ({r.a.n})
              </div>
              {fmt(r.a.mean)}
            </div>
            <div className="rounded-[10px] bg-raised p-2">
              <div className="text-xs text-muted-foreground">
                B: {x.variant_b} ({r.b.n})
              </div>
              {fmt(r.b.mean)}
            </div>
            <div className="rounded-[10px] bg-raised p-2">
              <div className="text-xs text-muted-foreground">B minus A</div>
              {r.difference == null
                ? "—"
                : `${r.difference > 0 ? "+" : ""}${r.difference.toFixed(1)}`}
            </div>
          </div>
          {r.range && (
            <p className="mt-2 text-xs text-muted-foreground">
              Likely range of the difference: {r.range[0].toFixed(1)} to {r.range[1].toFixed(1)}.
              Confidence: {r.confidence}.
            </p>
          )}
          {!r.enough && (
            <p className="mt-2 text-xs text-muted-foreground">
              Needs at least {x.min_obs} readings for each option before a comparison is shown as a
              result.
            </p>
          )}
          <details className="mt-2 text-xs text-muted-foreground">
            <summary>Limitations</summary>
            <ul className="mt-1 list-disc pl-5">
              {r.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        </>
      )}
      {x.status === "active" && (
        <div className="mt-4 space-y-3">
          {ab && cond && (
            <div className="flex gap-2">
              <Input
                type="number"
                step="any"
                placeholder={loggedToday ? "Update today's reading" : `Today's ${x.metric}`}
                value={val}
                onChange={(e) => setVal(e.target.value)}
              />
              <Button onClick={doLog} className="rounded-[10px]">
                Log
              </Button>
            </div>
          )}
          {(finished || !ab) && (
            <>
              <WithVoice value={concl} onChange={(v) => setConcl(v)}>
                <Textarea
                  placeholder="What did you learn? Keep, change or drop it?"
                  maxLength={1000}
                  value={concl}
                  onChange={(e) => setConcl(e.target.value)}
                />
              </WithVoice>
              <Button onClick={() => doFinish("completed")} className="rounded-[10px]">
                Complete experiment
              </Button>
            </>
          )}
          <button
            onClick={() => doFinish("abandoned")}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Stop experiment
          </button>
        </div>
      )}
      {x.conclusion && x.status !== "active" && (
        <p className="mt-3 text-sm">Conclusion: {x.conclusion}</p>
      )}
    </div>
  );
}
