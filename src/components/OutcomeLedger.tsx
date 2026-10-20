import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOutcomeHistory, refreshMyOutcomes } from "@/lib/outcomes.functions";
import { OUTCOME_LABEL, OUTCOME_TYPES, type OutcomeType } from "@/lib/outcomes";
import { CLASS_LABEL, type EvidenceClass } from "@/lib/verification";

const REF_LABEL: Record<string, string> = {
  plan_blocks: "session",
  goal_milestones: "milestone",
  progression_events: "progression rule",
  workout_sessions: "workout",
  wellness_sessions: "wellness session",
  daily_logs: "weigh-in",
  learning_topics: "topic",
  learning_assessments: "assessment",
  experiments: "experiment",
  experiment_entries: "reading",
};

export function OutcomeLedger() {
  const qc = useQueryClient();
  const refresh = useServerFn(refreshMyOutcomes);
  const fetchHistory = useServerFn(getOutcomeHistory);
  const [type, setType] = useState<OutcomeType | "">("");
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["outcomes", type],
    queryFn: () => fetchHistory({ data: type ? { type } : {} }),
  });
  useEffect(() => {
    refresh()
      .then((r) => {
        if (r.added) qc.invalidateQueries({ queryKey: ["outcomes"] });
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Outcome record</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Meaningful progress worked out from your own records. Entries are permanent and each one
        shows what it's based on.
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <button
          onClick={() => setType("")}
          className={`rounded-[10px] border px-3 py-1 ${type === "" ? "border-primary bg-raised" : "border-border"}`}
        >
          All
        </button>
        {OUTCOME_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`rounded-[10px] border px-3 py-1 ${type === t ? "border-primary bg-raised" : "border-border"}`}
          >
            {OUTCOME_LABEL[t]}
          </button>
        ))}
      </div>
      <ul className="mt-4 divide-y divide-border rounded-[20px] border border-border bg-card">
        {isLoading && <li className="px-5 py-4 text-sm text-muted-foreground">Loading…</li>}
        {!isLoading && rows.length === 0 && (
          <li className="px-5 py-4 text-sm text-muted-foreground">
            Nothing recorded yet. Outcomes appear as your history builds up.
          </li>
        )}
        {rows.map((o) => {
          const refs = (o.observation_refs as { table: string; id: string }[]) ?? [];
          const counts = refs.reduce<Record<string, number>>(
            (a, r) => ({ ...a, [r.table]: (a[r.table] ?? 0) + 1 }),
            {},
          );
          return (
            <li key={o.id} className="px-5 py-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="font-medium">
                  {OUTCOME_LABEL[o.outcome_type as OutcomeType] ?? o.outcome_type}
                  {o.text_value ? `: ${o.text_value}` : ""}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(o.observed_at).toLocaleDateString()}
                </span>
              </div>
              <div className="text-muted-foreground">
                {o.metric.replaceAll("_", " ")}
                {o.value != null
                  ? ` · ${Number(o.value) > 0 && o.unit === "kg" ? "+" : ""}${Number(o.value)} ${o.unit ?? ""}`
                  : ""}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {CLASS_LABEL[o.evidence_class as EvidenceClass] ?? o.evidence_class} · Based on{" "}
                {Object.entries(counts)
                  .map(([t, n]) => `${n} ${REF_LABEL[t] ?? t}${n === 1 ? "" : "s"}`)
                  .join(", ") || "no linked records"}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
