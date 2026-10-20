import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ownerSupport, ownerUpdateSupport } from "@/lib/owner.functions";
import { fmtDate } from "./app.admin.owner";

export const Route = createFileRoute("/_authenticated/app/admin/owner/support")({
  head: () => ({
    meta: [
      { title: "Owner support | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner support in Plexecute." },
      { property: "og:title", content: "Owner support | Plexecute" },
      { property: "og:description", content: "Manage Owner support in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Support,
});
const STATUSES = ["OPEN", "INVESTIGATING", "FIXED", "CLOSED"] as const;

function Support() {
  const fn = useServerFn(ownerSupport);
  const upd = useServerFn(ownerUpdateSupport);
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const { data, error } = useQuery({
    queryKey: ["owner-support", status, page],
    queryFn: () => fn({ data: { page, ...(status ? { status } : {}) } }),
  });
  return (
    <div className="space-y-3">
      <select
        aria-label="Status"
        className="h-10 rounded-md border border-border bg-background px-2 text-sm"
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          setPage(0);
        }}
      >
        <option value="">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      {error && <p className="text-sm text-destructive">Couldn't load support issues.</p>}
      {data && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                {["Created", "Member", "Type", "Plan", "Severity", "Status", "Resolved"].map(
                  (h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2">{fmtDate(r.created_at)}</td>
                  <td className="px-3 py-2 font-mono">{r.member ?? "—"}</td>
                  <td className="px-3 py-2">{r.category}</td>
                  <td className="px-3 py-2 capitalize">{r.tier}</td>
                  <td className="px-3 py-2">{r.severity}</td>
                  <td className="px-3 py-2">
                    <select
                      aria-label={`Status for issue from ${fmtDate(r.created_at)}`}
                      className="h-9 rounded-md border border-border bg-background px-1"
                      value={r.status}
                      onChange={async (e) => {
                        await upd({ data: { id: r.id, status: e.target.value as "OPEN" } });
                        qc.invalidateQueries({ queryKey: ["owner-support"] });
                      }}
                    >
                      {STATUSES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">{fmtDate(r.resolved_at)}</td>
                </tr>
              ))}
              {!data.rows.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    No issues.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > 25 && (
        <div className="flex gap-2">
          <button
            className="h-10 rounded-md border border-border px-3"
            disabled={!page}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <button
            className="h-10 rounded-md border border-border px-3"
            disabled={(page + 1) * 25 >= data.total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
