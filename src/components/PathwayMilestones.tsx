import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { updatePathwayMilestone } from "@/lib/pathway.functions";
import { proposeWeekPlan } from "@/lib/planning.functions";
import { CAPABILITY_LABEL, EVIDENCE_LABEL, type Capability, type Evidence } from "@/lib/pathway";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Row = {
  id: string;
  title: string;
  stage: number;
  status: string;
  is_major: boolean;
  evidence_type: string | null;
  evidence_note: string | null;
  capability: string | null;
  blocked_reason: string | null;
  actions: { title: string; minutes: number; capability: string; done?: boolean }[];
  sources: { url: string; title: string; publisher: string; retrieved_at: string; fact: string }[];
};
const STATUS: Record<string, string> = {
  pending: "Waiting on earlier steps",
  active: "Now",
  blocked: "Blocked",
  failed: "Retry",
  done: "Done",
};

export function PathwayMilestones({
  goal,
  milestones,
}: {
  goal: { id: string; success_definition?: string | null; pathway?: any };
  milestones: Row[];
}) {
  const qc = useQueryClient();
  const update = useServerFn(updatePathwayMilestone);
  const propose = useServerFn(proposeWeekPlan);
  const [open, setOpen] = useState<{ id: string; mode: "complete" | "block" | "fail" } | null>(
    null,
  );
  const [note, setNote] = useState("");
  const stages = [...new Set(milestones.map((m) => m.stage))].sort((a, b) => a - b);

  async function run(
    id: string,
    action: "complete" | "block" | "fail" | "unblock" | "toggle_action",
    extra: Record<string, unknown> = {},
  ) {
    try {
      const r: any = await update({ data: { milestone_id: id, action, ...extra } as never });
      if (r.status === "rejected") toast.error(r.message);
      else if (r.message) toast.success(r.message);
      setOpen(null);
      setNote("");
      qc.invalidateQueries({ queryKey: ["milestones", goal.id] });
      qc.invalidateQueries({ queryKey: ["goals"] });
      if (action !== "toggle_action" && r.status === "ok") {
        await propose({ data: { trigger: "goal_change" } }).catch(() => undefined);
        qc.invalidateQueries({ queryKey: ["plan-proposal"] });
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <section className="rounded-[14px] border border-border bg-card p-4">
      <h2 className="font-semibold">Pathway</h2>
      {goal.success_definition && (
        <p className="mt-1 text-sm">Done when: {goal.success_definition}</p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Only steps marked "Now" are scheduled. Later stages unlock as you finish earlier ones.
      </p>
      {stages.map((s) => (
        <div key={s} className="mt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Stage {s}
          </div>
          <ul className="mt-2 space-y-3">
            {milestones
              .filter((m) => m.stage === s)
              .map((m) => (
                <li
                  key={m.id}
                  className={`rounded-[10px] border p-3 text-sm ${m.status === "active" || m.status === "failed" ? "border-primary/40" : "border-border"}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`flex-1 font-medium ${m.status === "done" ? "text-muted-foreground line-through" : ""}`}
                    >
                      {m.title}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${m.status === "blocked" ? "bg-destructive/15 text-destructive" : m.status === "done" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
                    >
                      {STATUS[m.status] ?? m.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {CAPABILITY_LABEL[(m.capability ?? "user_performs") as Capability]} · Proof:{" "}
                    {EVIDENCE_LABEL[(m.evidence_type ?? "user_confirms") as Evidence]}
                  </div>
                  {m.blocked_reason && (
                    <div className="mt-1 text-xs text-warning">{m.blocked_reason}</div>
                  )}
                  {m.evidence_note && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Evidence: {m.evidence_note}
                    </div>
                  )}
                  {m.status !== "done" && m.actions.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {m.actions.map((a, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={!!a.done}
                            disabled={m.status === "pending"}
                            aria-label={`Tick off ${a.title}`}
                            onChange={() => run(m.id, "toggle_action", { action_index: i })}
                          />
                          <span className={a.done ? "text-muted-foreground line-through" : ""}>
                            {a.title}{" "}
                            <span className="text-muted-foreground">· {a.minutes} min</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.sources?.length > 0 && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        Why this step is needed
                      </summary>
                      <ul className="mt-1 space-y-1">
                        {m.sources.map((src, i) => (
                          <li key={i}>
                            {src.fact && <span>{src.fact} — </span>}
                            <a
                              className="text-primary underline"
                              href={src.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {src.publisher}
                            </a>
                            <span className="text-muted-foreground">
                              {" "}
                              · checked {new Date(src.retrieved_at).toLocaleDateString()}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {(m.status === "active" || m.status === "failed") && open?.id !== m.id && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="rounded-[10px]"
                        onClick={() =>
                          m.is_major &&
                          m.evidence_type !== "user_confirms" &&
                          m.evidence_type !== "amount_reached"
                            ? setOpen({ id: m.id, mode: "complete" })
                            : run(m.id, "complete")
                        }
                      >
                        Mark done
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpen({ id: m.id, mode: "block" })}
                      >
                        It's blocked
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpen({ id: m.id, mode: "fail" })}
                      >
                        Didn't pass / didn't work
                      </Button>
                    </div>
                  )}
                  {m.status === "blocked" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2"
                      onClick={() => run(m.id, "unblock")}
                    >
                      Resolved — carry on
                    </Button>
                  )}
                  {open?.id === m.id && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Input
                        aria-label={open.mode === "complete" ? "Evidence" : "What happened"}
                        className="min-w-48 flex-1"
                        placeholder={
                          open.mode === "complete"
                            ? EVIDENCE_LABEL[(m.evidence_type ?? "user_confirms") as Evidence]
                            : "What happened?"
                        }
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <Button
                        size="sm"
                        className="rounded-[10px]"
                        onClick={() =>
                          run(
                            m.id,
                            open.mode,
                            open.mode === "complete" ? { evidence: note } : { reason: note },
                          )
                        }
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
