import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ownerUserDetail, ownerAddNote, ownerSetSource } from "@/lib/owner.functions";
import { Stat } from "@/components/AdminUI";
import { MemberTags } from "@/components/owner/MemberTags";
import { fmtDate } from "./app.admin.owner";

export const Route = createFileRoute("/_authenticated/app/admin/owner/users/$code")({
  head: () => ({
    meta: [
      { title: "Member detail | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Member detail in Plexecute." },
      { property: "og:title", content: "Member detail | Plexecute" },
      { property: "og:description", content: "Manage Member detail in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Detail,
});
const SOURCES = [
  "Waiting List",
  "Founding Tester",
  "Organic",
  "Paid Marketing",
  "Referral",
  "Partnership",
  "Other",
] as const;
const list = (o: Record<string, number>) =>
  Object.entries(o)
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
    .join(" · ") || "none";

function Detail() {
  const { code } = Route.useParams();
  const qc = useQueryClient();
  const fn = useServerFn(ownerUserDetail);
  const add = useServerFn(ownerAddNote);
  const setSrc = useServerFn(ownerSetSource);
  const [note, setNote] = useState("");
  const { data: d, error } = useQuery({
    queryKey: ["owner-user", code],
    queryFn: () => fn({ data: { code } }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["owner-user", code] });
  if (error) return <p className="text-sm text-destructive">Couldn't load this member.</p>;
  if (!d) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-5">
      <Link to="/app/admin/owner/users" className="text-sm text-primary underline">
        Back to members
      </Link>
      <h2 className="font-mono text-xl">{d.code}</h2>
      <p className="text-xs text-muted-foreground">
        Summaries only — no health values, coach messages or call content.
      </p>
      <Sec t="Activation">
        <Stat label="Joined" value={fmtDate(d.activation.signup)} />
        <Stat label="Life Audit" value={d.activation.lifeAudit ? "Done" : "Not done"} />
        <Stat label="First plan accepted" value={fmtDate(d.activation.firstPlanAccepted)} />
        <Stat label="First task done" value={fmtDate(d.activation.firstTaskCompleted)} />
        <Stat label="First call" value={fmtDate(d.activation.firstCall)} />
        <label className="rounded-[14px] border border-border p-4 text-xs text-muted-foreground">
          Source
          <select
            className="mt-1 block h-10 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground"
            value={d.activation.source}
            onChange={async (e) => {
              await setSrc({ data: { code, source: e.target.value as (typeof SOURCES)[number] } });
              refresh();
            }}
          >
            {SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </Sec>
      <Sec t="Execution (last 30 days)">
        <Stat
          label="Plan versions / accepted"
          value={`${d.execution.versions} / ${d.execution.accepted}`}
        />
        <Stat
          label="Actions by status"
          value={<span className="text-sm">{list(d.execution.last30)}</span>}
        />
      </Sec>
      <Sec t="Accountability">
        <Stat
          label="Call attempts / answered"
          value={`${d.accountability.attempts} / ${d.accountability.answered}`}
        />
        <Stat label="Voice minutes" value={d.accountability.voiceMinutes} />
        <Stat label="Stop all calls" value={d.accountability.stopAll ? "On" : "Off"} />
        <Stat
          label="Outcomes"
          value={<span className="text-sm">{list(d.accountability.outcomes)}</span>}
        />
      </Sec>
      <Sec t="Commercial">
        <Stat label="Plan" value={<span className="capitalize">{d.commercial.tier}</span>} />
        <Stat label="Subscription" value={d.commercial.subscription?.status ?? "none"} />
        <Stat label="Renews" value={fmtDate(d.commercial.subscription?.current_period_end)} />
        <Stat
          label="Cancellation reason"
          value={d.commercial.cancellationReason?.reason.replace(/_/g, " ") ?? "—"}
        />
        <Stat
          label="Rewards"
          value={
            <span className="text-sm">
              {d.commercial.rewards
                .map((r) => `${r.state.toLowerCase()} (${r.completed_count}/${r.required_count})`)
                .join(" · ") || "none"}
            </span>
          }
        />
      </Sec>
      <Sec t="Outcomes">
        <Stat label="Recorded outcomes" value={d.outcomes.total} />
        <Stat
          label="By evidence"
          value={<span className="text-sm">{list(d.outcomes.byEvidence)}</span>}
        />
      </Sec>
      <section>
        <h3 className="mb-2 text-sm font-medium">Support</h3>
        {d.support.length ? (
          <ul className="text-sm">
            {d.support.map((s) => (
              <li key={s.id}>
                {fmtDate(s.created_at)} · {s.category} · {s.status}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No issues.</p>
        )}
      </section>
      <MemberTags code={code} />
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Owner notes</h3>
        <label htmlFor="onote" className="text-xs text-muted-foreground">
          Add a note (no health or private details)
        </label>
        <textarea
          id="onote"
          className="block w-full rounded-md border border-border bg-background p-2 text-sm"
          rows={3}
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          className="h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-40"
          disabled={!note.trim()}
          onClick={async () => {
            await add({ data: { code, note } });
            setNote("");
            refresh();
          }}
        >
          Save note
        </button>
        <ul className="text-sm">
          {d.notes.map((n) => (
            <li key={n.id} className="border-t border-border py-2">
              {fmtDate(n.created_at)} — {n.note}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
function Sec({ t, children }: { t: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium">{t}</h3>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{children}</div>
    </section>
  );
}
