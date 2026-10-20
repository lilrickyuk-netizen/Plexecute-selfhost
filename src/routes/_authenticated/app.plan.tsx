import { createFileRoute } from "@tanstack/react-router";
import { rows } from "@/lib/rows";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ListTodo } from "lucide-react";
import { FeatureHeader } from "@/components/FeatureHeader";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useBlocks } from "@/lib/data";
import { DOMAINS, startOfWeek } from "@/lib/scheduler";
import {
  approveWeekPlan,
  proposeMakeups,
  syncRoutineOccurrences,
  proposeWeekPlan,
} from "@/lib/planning.functions";
import { BlockRow } from "@/components/BlockRow";
import { getSessionBriefs } from "@/lib/session-brief.functions";
import { seedStarterPathways } from "@/lib/starter-pathways.functions";
import { FeasibilityCard } from "@/components/FeasibilityCard";
import { ProposalReview, PlanTrialsAndLocks } from "@/components/ProposalReview";
import { Button } from "@/components/ui/button";
import { DeleteWithImpact } from "@/components/DeleteWithImpact";
import { previewPlanDeletion, deletePlanConfirmed } from "@/lib/deletion.functions";
import planImage from "@/assets/member-plan.jpg";

export const Route = createFileRoute("/_authenticated/app/plan")({
  head: () => ({
    meta: [
      { title: "Weekly plan — Plexecute" },
      { name: "description", content: "Manage Weekly plan in Plexecute." },
      { property: "og:title", content: "Weekly plan — Plexecute" },
      { property: "og:description", content: "Manage Weekly plan in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Plan,
});

function Plan() {
  const qc = useQueryClient();
  const propose = useServerFn(proposeWeekPlan);
  const approve = useServerFn(approveWeekPlan);
  const makeups = useServerFn(proposeMakeups);
  const syncRoutines = useServerFn(syncRoutineOccurrences);
  const seedStarters = useServerFn(seedStarterPathways);
  const briefsFn = useServerFn(getSessionBriefs);
  const qcRoutines = useQueryClient();
  useEffect(() => {
    seedStarters()
      .then((r) => {
        if (r.seeded) qcRoutines.invalidateQueries({ queryKey: ["plan-briefs"] });
      })
      .catch(() => {});
    syncRoutines()
      .then((r) => {
        if (r.added) qcRoutines.invalidateQueries({ queryKey: ["blocks"] });
      })
      .catch(() => {});
  }, []);
  const [ws, we] = useMemo(() => {
    const a = startOfWeek(new Date());
    const b = new Date(a);
    b.setDate(b.getDate() + 7);
    return [a, b];
  }, []);
  const { data: blocks = [] } = useBlocks(ws.toISOString(), we.toISOString());
  const openIds = blocks.map((b) => b.id).slice(0, 60);
  const { data: briefs = [] } = useQuery({
    queryKey: [
      "plan-briefs",
      openIds.join(","),
      blocks.map((b) => `${b.status}${b.starts_at}`).join(","),
    ],
    queryFn: () => briefsFn({ data: { blockIds: openIds } }),
    enabled: openIds.length > 0,
  });
  const shortOf = (id: string, title: string) => {
    const x = briefs.find((y) => y.blockId === id);
    return x && x.objective !== title ? x.objective : undefined;
  };
  const [busy, setBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delWeek, setDelWeek] = useState<string | null>(null);
  const previewDel = useServerFn(previewPlanDeletion);
  const runDel = useServerFn(deletePlanConfirmed);
  const { data: proposal, refetch: refetchProposal } = useQuery({
    queryKey: ["plan-proposal"],
    queryFn: async () =>
      (
        await supabase
          .from("plan_versions")
          .select("*")
          .eq("status", "proposed")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data,
  });

  async function replan() {
    setBusy(true);
    try {
      await propose({ data: { trigger: "manual" } });
      await refetchProposal();
      toast.success("A new plan is ready for your approval");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function catchUp() {
    setBusy(true);
    try {
      const r = await makeups();
      await refetchProposal();
      if (!r.missed) toast.success("No missed sessions this week");
      else if (r.autoApplied)
        toast.success("Catch-ups added (your automatic-change settings allowed it)");
      else toast.success("Catch-up plan ready for your approval");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!proposal) return;
    setBusy(true);
    try {
      await approve({ data: { proposalId: proposal.id } });
      await Promise.all([qc.invalidateQueries({ queryKey: ["blocks"] }), refetchProposal()]);
      toast.success("Plan approved and applied");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const { data: commitments = [] } = useQuery({
    queryKey: ["commitments"],
    queryFn: async () =>
      rows(await supabase.from("commitments").select("*").eq("active", true).order("start_time")),
  });
  const commitmentsOn = (d: Date) => {
    const iso = ((d.getDay() + 6) % 7) + 1;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return commitments.filter((c) =>
      c.recurrence === "weekly" ? c.days.includes(iso) : c.on_date === key,
    );
  };
  const areas = Object.entries(
    blocks.reduce<Record<string, { min: number; done: number }>>((acc, b) => {
      const a = (acc[b.domain] ??= { min: 0, done: 0 });
      a.min += b.duration_min;
      if (b.status === "done") a.done += b.duration_min;
      return acc;
    }, {}),
  ).sort((x, y) => y[1].min - x[1].min);

  const diff =
    proposal?.diff_summary &&
    typeof proposal.diff_summary === "object" &&
    !Array.isArray(proposal.diff_summary)
      ? (proposal.diff_summary as Record<string, unknown>)
      : null;

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(ws);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div>
      <div className="member-training-cover">
        <img
          src={planImage}
          width={1536}
          height={1024}
          alt="Weekly planner and pencil on a daylight-lit desk"
        />
      </div>
      <FeatureHeader
        title="Your week"
        icon={ListTodo}
        eyebrow={<>Week of {ws.toLocaleDateString([], { day: "numeric", month: "long" })}</>}
        actions={
          <>
            <Button variant="outline" onClick={catchUp} disabled={busy} className="rounded-[10px]">
              Catch up missed
            </Button>
            <Button
              variant="outline"
              onClick={() => setDelOpen(true)}
              disabled={busy}
              className="rounded-[10px] text-destructive"
            >
              Delete this week's plan
            </Button>
            <Button onClick={replan} disabled={busy} className="rounded-[10px]">
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Replan rest of week
            </Button>
          </>
        }
      />
      <DeleteWithImpact
        open={delOpen}
        onOpenChange={setDelOpen}
        title="Delete this week's plan?"
        load={async () => {
          const r = await previewDel({ data: {} });
          setDelWeek(r.week_start);
          return r;
        }}
        run={(token) => runDel({ data: { weekStart: delWeek!, confirm: true, token } })}
        onDone={() => {
          qc.invalidateQueries();
          toast.message("Press Replan rest of week whenever you want a new plan.");
        }}
      />
      {proposal && diff && (
        <ProposalReview proposal={proposal} current={blocks} onDone={refetchProposal} />
      )}
      <PlanTrialsAndLocks onDone={refetchProposal} />

      <FeasibilityCard />

      {areas.length > 0 && (
        <section className="mt-6">
          <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
            This week across your life
          </p>
          <div className="flex flex-wrap gap-2">
            {areas.map(([domain, v]) => (
              <span
                key={domain}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs"
              >
                {DOMAINS.find((x) => x.value === domain)?.label ?? domain} ·{" "}
                {Math.round(v.min / 6) / 10}h
                {v.done ? ` · ${Math.round((v.done / v.min) * 100)}% done` : ""}
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="member-plan-days">
        {days.map((d) => {
          const items = blocks.filter(
            (b) => new Date(b.starts_at).toDateString() === d.toDateString(),
          );
          const isToday = d.toDateString() === new Date().toDateString();
          return (
            <section className="member-plan-day" key={d.toISOString()}>
              <h2
                className={`mb-3 text-sm font-medium ${isToday ? "text-execute" : "text-muted-foreground"}`}
              >
                {d.toLocaleDateString([], { weekday: "long", day: "numeric" })}
                {isToday ? " · Today" : ""}
              </h2>
              {commitmentsOn(d).map((c) => (
                <p
                  key={c.id}
                  className="mb-2 rounded-[10px] bg-muted/40 px-4 py-2 text-xs text-muted-foreground"
                >
                  {c.start_time.slice(0, 5)}–{c.end_time.slice(0, 5)} · {c.title}{" "}
                  <span className="opacity-70">(fixed)</span>
                </p>
              ))}
              {items.length ? (
                <div className="space-y-2">
                  {items.map((b) => (
                    <BlockRow key={b.id} block={b} objective={shortOf(b.id, b.title)} />
                  ))}
                </div>
              ) : (
                <p className="rounded-[14px] border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Free day — rest counts too.
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
