import { History as HistoryIcon } from "lucide-react";
import { FeatureHeader } from "@/components/FeatureHeader";
import { createFileRoute } from "@tanstack/react-router";
import { rows } from "@/lib/rows";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/app/history")({
  head: () => ({
    meta: [
      { title: "History · Plexecute" },
      {
        name: "description",
        content: "Every plan version, session change and recorded outcome, in order.",
      },
      { property: "og:title", content: "History · Plexecute" },
      {
        property: "og:description",
        content: "Every plan version, session change and recorded outcome, in order.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: History,
});

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm ${on ? "border-execute bg-execute/15 text-execute" : "border-border text-muted-foreground hover:bg-raised"}`;
const when = (s: string) =>
  new Date(s).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const STATUS: Record<string, string> = {
  proposed: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
  superseded: "Replaced",
};

function History() {
  const [tab, setTab] = useState<"plans" | "sessions" | "outcomes" | "activity">("plans");
  const { data: plans = [] } = useQuery({
    queryKey: ["hist-plans"],
    queryFn: async () =>
      rows(
        await supabase
          .from("plan_versions")
          .select(
            "id,week_start,version,status,trigger,feasibility,explanation,created_at,approved_at",
          )
          .order("created_at", { ascending: false })
          .limit(50),
      ),
  });
  const { data: events = [] } = useQuery({
    queryKey: ["hist-events"],
    queryFn: async () =>
      rows(
        await supabase
          .from("plan_block_events")
          .select(
            "id,event_type,from_status,to_status,reason_code,note,occurred_at,plan_blocks(title)",
          )
          .order("occurred_at", { ascending: false })
          .limit(80),
      ),
  });
  const { data: outcomes = [] } = useQuery({
    queryKey: ["hist-outcomes"],
    queryFn: async () =>
      rows(
        await supabase
          .from("outcome_ledger")
          .select("id,domain,metric,value,text_value,unit,evidence_class,source,observed_at")
          .order("observed_at", { ascending: false })
          .limit(80),
      ),
  });
  const { data: audit = [] } = useQuery({
    queryKey: ["hist-audit"],
    queryFn: async () =>
      rows(
        await supabase
          .from("audit_events")
          .select("id,action,actor_type,outcome,created_at")
          .order("created_at", { ascending: false })
          .limit(80),
      ),
  });

  const empty = <p className="mt-4 text-sm text-muted-foreground">Nothing recorded yet.</p>;
  const list =
    "mt-4 divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card";

  return (
    <div>
      <FeatureHeader
        title="History"
        icon={HistoryIcon}
        description="Nothing here can be edited. It's the record of what was planned, what changed and what actually happened."
      />
      <div className="mt-5 flex flex-wrap gap-2">
        {(
          [
            ["plans", "Plan versions"],
            ["sessions", "Session changes"],
            ["outcomes", "Outcomes"],
            ["activity", "Account activity"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={chip(tab === k)} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === "plans" &&
        (plans.length ? (
          <ul className={list}>
            {plans.map((p) => (
              <li key={p.id} className="px-5 py-4 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">
                    Week of{" "}
                    {new Date(p.week_start).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}{" "}
                    · version {p.version}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {STATUS[p.status] ?? p.status}
                  </span>
                </div>
                <div className="mt-1 text-muted-foreground">{p.explanation ?? "Weekly plan"}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Reason: {p.trigger.replace("_", " ")} · {p.feasibility} · {when(p.created_at)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          empty
        ))}

      {tab === "sessions" &&
        (events.length ? (
          <ul className={list}>
            {events.map((e) => (
              <li key={e.id} className="px-5 py-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">
                    {(e.plan_blocks as { title: string } | null)?.title ?? "Session"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {when(e.occurred_at)}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  {e.from_status ? `${e.from_status.replace("_", " ")} → ` : ""}
                  {e.to_status.replace("_", " ")}
                  {e.note
                    ? ` · "${e.note}"`
                    : e.reason_code
                      ? ` · ${e.reason_code.replace("_", " ")}`
                      : ""}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          empty
        ))}

      {tab === "outcomes" &&
        (outcomes.length ? (
          <ul className={list}>
            {outcomes.map((o) => (
              <li key={o.id} className="flex justify-between gap-3 px-5 py-3 text-sm">
                <span>
                  <span className="font-medium capitalize">{o.domain}</span> ·{" "}
                  {o.metric.replaceAll("_", " ")}: {o.value ?? o.text_value} {o.unit ?? ""}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {o.evidence_class.replaceAll("_", " ")} · {when(o.observed_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          empty
        ))}

      {tab === "activity" &&
        (audit.length ? (
          <ul className={list}>
            {audit.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 px-5 py-3 text-sm">
                <span>{a.action.replaceAll(".", " · ").replaceAll("_", " ")}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {a.actor_type} · {a.outcome} · {when(a.created_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          empty
        ))}
    </div>
  );
}
