import { localDayKey, validZone } from "@/lib/tz";
import { useProfile } from "@/lib/data";
import { rows } from "@/lib/rows";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  approveWeekPlan,
  rejectWeekPlan,
  endPlanTrial,
  lockGoalSchedule,
} from "@/lib/planning.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Block = {
  goal_id?: string | null;
  title: string;
  starts_at: string;
  duration_min: number;
  status?: string;
  is_protected?: boolean;
};
const TRIGGER: Record<string, string> = {
  onboarding: "Your first plan",
  goal_change: "You changed a goal",
  manual: "You asked for a replan",
  recovery: "Your recovery state changed",
  calendar_change: "Your calendar changed",
  system: "Something in your Life Twin changed",
};
const whenIn = (iso: string, tz: string) =>
  new Date(iso).toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
const h = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;

function byGoal(bs: Block[]) {
  const m = new Map<string, { title: string; min: number }>();
  for (const b of bs) {
    const k = b.goal_id ?? b.title;
    const e = m.get(k) ?? { title: b.title, min: 0 };
    e.min += b.duration_min;
    m.set(k, e);
  }
  return m;
}

export function ProposalReview({
  proposal,
  current,
  onDone,
}: {
  proposal: any;
  current: Block[];
  onDone: () => Promise<unknown>;
}) {
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const tz = validZone(profile?.timezone);
  const when = (iso: string) => whenIn(iso, tz);
  const approve = useServerFn(approveWeekPlan);
  const reject = useServerFn(rejectWeekPlan);
  const lock = useServerFn(lockGoalSchedule);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const diff: any = proposal.diff_summary ?? {};
  const proposed: Block[] = diff.proposed_blocks ?? [];
  const now = new Date().toISOString();
  const replaceable = current.filter(
    (b) =>
      ["planned", "scheduled", "upcoming", "due", "contacting", "acknowledged", "snoozed"].includes(
        b.status ?? "",
      ) &&
      !b.is_protected &&
      b.starts_at >= now,
  );
  const before = byGoal(replaceable),
    after = byGoal(proposed);
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  const report = diff.feasibility_report;

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try {
      await fn();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["blocks"] }),
        qc.invalidateQueries({ queryKey: ["plan-trial"] }),
        qc.invalidateQueries({ queryKey: ["plan-locks"] }),
        onDone(),
      ]);
      toast.success(msg);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-5 border-l-2 border-execute bg-card p-5">
      <p className="text-xs uppercase tracking-widest text-execute">
        Plan v{proposal.version} ready
      </p>
      <h2 className="mt-2 text-lg font-semibold">Review before anything changes</h2>

      <div className="mt-4 grid gap-4 text-sm md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Current
          </p>
          <ul className="mt-1 space-y-0.5">
            {replaceable.length ? (
              replaceable.map((b, i) => (
                <li key={i}>
                  {when(b.starts_at)} · {b.title}
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">No upcoming sessions to change</li>
            )}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Proposed
          </p>
          <ul className="mt-1 space-y-0.5">
            {proposed.length ? (
              proposed.map((b, i) => (
                <li key={i}>
                  {when(b.starts_at)} · {b.title} ({b.duration_min} min)
                </li>
              ))
            ) : (
              <li className="text-muted-foreground">No new sessions</li>
            )}
          </ul>
        </div>
      </div>
      <div className="mt-4 space-y-2 text-sm">
        <p>
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Reason ·{" "}
          </span>
          {TRIGGER[proposal.trigger] ?? proposal.trigger}. {proposal.explanation}
        </p>
        <p>
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Evidence ·{" "}
          </span>
          {report
            ? `${h(report.capacity.usable_min)} usable after sleep, work and commitments; goals want ${h(report.demand_preferred_min)}. `
            : ""}
          {Array.isArray(diff.twin_snapshot)
            ? `Built from ${diff.twin_snapshot.length} Life Twin facts. `
            : ""}
          {diff.kept_count ? `${diff.kept_count} protected or finished sessions kept.` : ""}
        </p>
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Impact
          </span>
          <ul className="mt-1 space-y-0.5">
            {keys.map((k) => {
              const a = before.get(k)?.min ?? 0,
                b = after.get(k)?.min ?? 0;
              return (
                <li key={k}>
                  {(after.get(k) ?? before.get(k))!.title}: {h(a)} → {h(b)}
                  {b > a ? ` (+${h(b - a)})` : b < a ? ` (−${h(a - b)})` : ""}
                </li>
              );
            })}
            {(diff.unplaced ?? []).map((u: any) => (
              <li key={u.goal_id} className="text-destructive">
                {u.title}: {h(u.minutes)} couldn't fit
              </li>
            ))}
            {(diff.waiting_goals ?? []).map((w: any) => (
              <li key={w.goal_id} className="text-muted-foreground">
                {w.title}: waiting on {w.waiting_on.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          className="rounded-[10px] bg-execute text-execute-foreground hover:bg-execute/90"
          disabled={busy}
          onClick={() =>
            run(
              () => approve({ data: { proposalId: proposal.id, mode: "permanent" } }),
              "Plan applied for good",
            )
          }
        >
          Apply permanently
        </Button>
        <Button
          variant="outline"
          className="rounded-[10px]"
          disabled={busy}
          onClick={() =>
            run(
              () => approve({ data: { proposalId: proposal.id, mode: "once" } }),
              "Applied for this week only",
            )
          }
        >
          Apply once
        </Button>
        <Button
          variant="outline"
          className="rounded-[10px]"
          disabled={busy}
          onClick={() =>
            run(
              () => approve({ data: { proposalId: proposal.id, mode: "trial", trialDays: 14 } }),
              "Trying this for 2 weeks",
            )
          }
        >
          Try for 2 weeks
        </Button>
        <Button variant="ghost" className="rounded-[10px]" asChild>
          <Link to="/app/goals">Edit</Link>
        </Button>
        <Button
          variant="ghost"
          className="rounded-[10px] text-destructive"
          disabled={busy}
          onClick={() => setRejecting(true)}
        >
          Reject
        </Button>
      </div>
      {rejecting && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Input
            className="flex-1 min-w-48"
            placeholder="Why not? (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            variant="destructive"
            className="rounded-[10px]"
            disabled={busy}
            onClick={() =>
              run(
                () => reject({ data: { proposalId: proposal.id, note } }),
                "Proposal rejected. Nothing changed.",
              )
            }
          >
            Confirm reject
          </Button>
        </div>
      )}
      {replaceable.some((b) => b.goal_id) && (
        <details className="mt-4 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Never auto-change a goal's session times</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              ...new Map(
                replaceable.filter((b) => b.goal_id).map((b) => [b.goal_id!, b.title]),
              ).entries(),
            ].map(([id, title]) => (
              <button
                key={id}
                disabled={busy}
                onClick={() =>
                  run(
                    () => lock({ data: { goalId: id, locked: true } }),
                    `"${title}" times are now fixed. Replan to see the effect.`,
                  )
                }
                className="rounded-full border border-border px-3 py-1 hover:border-primary"
              >
                Lock {title}
              </button>
            ))}
          </div>
        </details>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Includes a 10% spare-time buffer. Nothing changes until you choose.
      </p>
    </section>
  );
}

/** Shows an active trial and the locks list, with keep / go back and unlock. */
export function PlanTrialsAndLocks({ onDone }: { onDone: () => Promise<unknown> }) {
  const qc = useQueryClient();
  const end = useServerFn(endPlanTrial);
  const lock = useServerFn(lockGoalSchedule);
  const { data: trial, refetch } = useQuery({
    queryKey: ["plan-trial"],
    queryFn: async () =>
      (
        await supabase
          .from("plan_versions")
          .select("id,version,trial_until")
          .eq("status", "approved")
          .eq("apply_mode", "trial")
          .order("approved_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data,
  });
  const { data: locks = [], refetch: refetchLocks } = useQuery({
    queryKey: ["plan-locks"],
    queryFn: async () =>
      rows(await supabase.from("plan_property_locks").select("*").order("created_at")),
  });
  if (!trial && !locks.length) return null;
  const finish = async (keep: boolean) => {
    try {
      const r = await end({ data: { versionId: trial!.id, keep } });
      await Promise.all([refetch(), onDone()]);
      toast.success(
        keep
          ? "Kept for good"
          : r.proposalId
            ? "Earlier plan proposed. Review it above."
            : "Trial ended",
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <section className="mt-5 space-y-3 rounded-[14px] border border-border bg-card p-4 text-sm">
      {trial && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Plan v{trial.version} is on trial until {trial.trial_until}
            {trial.trial_until && trial.trial_until <= localDayKey(new Date())
              ? " (trial over, decide now)"
              : ""}
            .
          </span>
          <span className="flex gap-2">
            <Button size="sm" className="rounded-[10px]" onClick={() => finish(true)}>
              Keep
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-[10px]"
              onClick={() => finish(false)}
            >
              Go back
            </Button>
          </span>
        </div>
      )}
      {locks.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Never auto-change
          </p>
          <ul className="mt-1 space-y-1">
            {locks.map((l: any) => (
              <li key={l.id} className="flex justify-between gap-2">
                <span>{l.label}</span>
                {l.property.startsWith("goal:") && (
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={async () => {
                      await lock({ data: { goalId: l.property.split(":")[1], locked: false } });
                      await Promise.all([
                        refetchLocks(),
                        qc.invalidateQueries({ queryKey: ["blocks"] }),
                      ]);
                      toast.success("Unlocked");
                    }}
                  >
                    Unlock
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
