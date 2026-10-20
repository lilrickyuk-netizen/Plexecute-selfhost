import { useState } from "react";
import { rows } from "@/lib/rows";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { runResearch, applyFindings } from "@/lib/research.functions";
import { CATEGORY_LABEL, TRUST_LABEL, type Category, type Trust } from "@/lib/research";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CareerResearch({ goalId, title }: { goalId: string; title: string }) {
  const qc = useQueryClient();
  const run = useServerFn(runResearch),
    apply = useServerFn(applyFindings);
  const [query, setQuery] = useState(title);
  const [where, setWhere] = useState("United Kingdom");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const k = ["research", goalId];
  const { data = [] } = useQuery({
    queryKey: k,
    queryFn: async () =>
      rows(
        await supabase
          .from("career_research")
          .select("*, research_sources(*), research_findings(*)")
          .eq("goal_id", goalId)
          .order("created_at", { ascending: false })
          .limit(5),
      ),
  });

  async function go() {
    setBusy(true);
    try {
      const r = await run({ data: { goalId, query, jurisdiction: where } });
      toast.success(
        `${r.findings} sourced facts found${r.dropped ? `, ${r.dropped} unverifiable claims left out` : ""}`,
      );
      qc.invalidateQueries({ queryKey: k });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    try {
      const r = await apply({ data: { goalId, findingIds: [...picked] } });
      toast.success(
        `Added ${r.milestones} milestones, ${r.resources} resources, ${r.prerequisites} prerequisites`,
      );
      setPicked(new Set());
      qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Research requirements</h2>
      <p className="text-sm text-muted-foreground">
        Searches current public sources for qualifications, pathways, courses, prerequisites, exams,
        registration, skills and deadlines. Each fact is shown with its source and quote. Always
        check with the official body before making decisions.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-md"
          value={query}
          maxLength={300}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. become a chartered accountant"
        />
        <Input
          className="w-48"
          value={where}
          maxLength={80}
          onChange={(e) => setWhere(e.target.value)}
          placeholder="Country / region"
        />
        <Button disabled={busy || query.trim().length < 3 || where.trim().length < 2} onClick={go}>
          {busy ? "Researching…" : "Research"}
        </Button>
      </div>
      {data.map((r: any) => (
        <div key={r.id} className="rounded-[14px] border border-border bg-card p-4">
          <div className="text-xs text-muted-foreground">
            "{r.query}" · {r.jurisdiction} · fetched {new Date(r.created_at).toLocaleDateString()}
          </div>
          {r.interpretation && (
            <div className="mt-2 rounded-md border border-dashed border-border p-3 text-sm">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                AI interpretation, not a sourced fact
              </div>
              <p className="mt-1 whitespace-pre-wrap">{r.interpretation}</p>
            </div>
          )}
          <ul className="mt-3 space-y-2">
            {(r.research_findings ?? []).map((f: any) => {
              const s = (r.research_sources ?? []).find((x: any) => x.id === f.source_id);
              return (
                <li key={f.id} className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={!!f.applied_at}
                    checked={picked.has(f.id) || !!f.applied_at}
                    onChange={(e) => {
                      const n = new Set(picked);
                      if (e.target.checked) n.add(f.id);
                      else n.delete(f.id);
                      setPicked(n);
                    }}
                  />
                  <div>
                    <span className="text-xs text-execute">
                      {CATEGORY_LABEL[f.category as Category]}
                    </span>{" "}
                    {f.statement}
                    <div className="text-xs text-muted-foreground">
                      "{f.quote}" ·{" "}
                      {s && (
                        <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                          {s.publisher}
                        </a>
                      )}{" "}
                      · {s && TRUST_LABEL[s.trust as Trust]}
                      {f.applied_at ? " · added to goal" : ""}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {(r.research_findings ?? []).length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              No facts could be verified against the sources.
            </p>
          )}
        </div>
      ))}
      {picked.size > 0 && <Button onClick={add}>Add {picked.size} to this goal</Button>}
    </section>
  );
}
