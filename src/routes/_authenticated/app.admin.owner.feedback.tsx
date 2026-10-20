import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ownerFeedback, ownerSaveFeedback, FEEDBACK_CATEGORIES } from "@/lib/owner.functions";
import { fmtDate } from "./app.admin.owner";

export const Route = createFileRoute("/_authenticated/app/admin/owner/feedback")({
  head: () => ({
    meta: [
      { title: "Owner feedback | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner feedback in Plexecute." },
      { property: "og:title", content: "Owner feedback | Plexecute" },
      { property: "og:description", content: "Manage Owner feedback in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Feedback,
});
const LABEL: Record<string, string> = {
  bug: "Bug",
  confusing_ux: "Confusing to use",
  poor_recommendation: "Poor recommendation",
  accountability: "Accountability / calling",
  billing: "Billing",
  integration: "Integration",
  missing_feature: "Missing feature",
  positive: "Positive",
  other: "Other",
};
const STATUSES = ["OPEN", "INVESTIGATING", "FIXED", "CLOSED"] as const;
const f = "h-10 rounded-md border border-border bg-background px-2 text-sm";

function Feedback() {
  const fn = useServerFn(ownerFeedback);
  const save = useServerFn(ownerSaveFeedback);
  const qc = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["owner-feedback"],
    queryFn: () => fn({ data: {} }),
  });
  const [cat, setCat] = useState<(typeof FEEDBACK_CATEGORIES)[number]>("bug");
  const [sev, setSev] = useState<"low" | "normal" | "high" | "critical">("normal");
  const [notes, setNotes] = useState("");
  const [code, setCode] = useState("");
  const [source, setSource] = useState("owner");
  const [msg, setMsg] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["owner-feedback"] });
  return (
    <div className="space-y-4">
      <form
        className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await save({
              data: { category: cat, severity: sev, notes, source, ...(code ? { code } : {}) },
            });
            setNotes("");
            setCode("");
            setMsg("Saved.");
            refresh();
          } catch (err) {
            setMsg((err as Error).message);
          }
        }}
      >
        <label className="text-sm">
          Category
          <select
            className={`${f} mt-1 block w-full`}
            value={cat}
            onChange={(e) => setCat(e.target.value as "bug")}
          >
            {FEEDBACK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Severity
          <select
            className={`${f} mt-1 block w-full`}
            value={sev}
            onChange={(e) => setSev(e.target.value as "low")}
          >
            {["low", "normal", "high", "critical"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Member code (optional)
          <input
            className={`${f} mt-1 block w-full`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Source
          <input
            className={`${f} mt-1 block w-full`}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <label className="text-sm md:col-span-2">
          Notes
          <textarea
            className="mt-1 block w-full rounded-md border border-border bg-background p-2 text-sm"
            rows={2}
            value={notes}
            maxLength={4000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <div className="flex items-center gap-3">
          <button
            className="h-10 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-40"
            disabled={!notes.trim()}
          >
            Add feedback
          </button>
          <span role="status" className="text-xs text-muted-foreground">
            {msg}
          </span>
        </div>
      </form>
      {error && <p className="text-sm text-destructive">Couldn't load feedback.</p>}
      {data && (
        <ul className="space-y-2">
          {data.rows.map((r) => (
            <li key={r.id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{LABEL[r.category]}</span>
                <span className="text-muted-foreground">
                  {r.severity} · {fmtDate(r.created_at)} · {r.source}
                  {r.member ? ` · ${r.member}` : ""}
                </span>
                <select
                  aria-label="Feedback status"
                  className="ml-auto h-9 rounded-md border border-border bg-background px-1"
                  value={r.status}
                  onChange={async (e) => {
                    await save({
                      data: {
                        id: r.id,
                        category: r.category as "bug",
                        severity: r.severity as "low",
                        notes: r.notes,
                        source: r.source,
                        status: e.target.value as "OPEN",
                        resolution: r.resolution ?? undefined,
                        linked_ref: r.linked_ref ?? undefined,
                      },
                    });
                    refresh();
                  }}
                >
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <p className="mt-1">{r.notes}</p>
            </li>
          ))}
          {!data.rows.length && (
            <li className="text-sm text-muted-foreground">No feedback recorded yet.</li>
          )}
        </ul>
      )}
    </div>
  );
}
