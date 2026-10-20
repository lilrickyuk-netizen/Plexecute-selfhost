import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ownerUsers } from "@/lib/owner.functions";
import { fmtDate } from "./app.admin.owner";

export const Route = createFileRoute("/_authenticated/app/admin/owner/users/")({
  head: () => ({
    meta: [
      { title: "Owner users | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner users in Plexecute." },
      { property: "og:title", content: "Owner users | Plexecute" },
      { property: "og:description", content: "Manage Owner users in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Users,
});

const SOURCES = [
  "Waiting List",
  "Founding Tester",
  "Organic",
  "Paid Marketing",
  "Referral",
  "Partnership",
  "Other",
];
const sel = "h-10 rounded-md border border-border bg-background px-2 text-sm";

function Users() {
  const fn = useServerFn(ownerUsers);
  const [page, setPage] = useState(0);
  const [code, setCode] = useState("");
  const [tier, setTier] = useState("");
  const [onb, setOnb] = useState("");
  const [source, setSource] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const { data, error } = useQuery({
    queryKey: ["owner-users", page, code, tier, onb, source, sort],
    placeholderData: keepPreviousData,
    queryFn: () =>
      fn({
        data: {
          page,
          sort,
          ...(code.length >= 4 ? { code } : {}),
          ...(tier ? { tier: tier as "free" } : {}),
          ...(onb ? { onboarded: onb === "yes" } : {}),
          ...(source ? { source } : {}),
        },
      }),
  });
  const reset =
    <T,>(f: (v: T) => void) =>
    (v: T) => {
      f(v);
      setPage(0);
    };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="ocode">
          Member code
        </label>
        <input
          id="ocode"
          className={sel}
          placeholder="Member code"
          value={code}
          onChange={(e) => reset(setCode)(e.target.value)}
        />
        <select
          aria-label="Plan"
          className={sel}
          value={tier}
          onChange={(e) => reset(setTier)(e.target.value)}
        >
          <option value="">All plans</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="execute">Execute</option>
        </select>
        <select
          aria-label="Setup"
          className={sel}
          value={onb}
          onChange={(e) => reset(setOnb)(e.target.value)}
        >
          <option value="">Any setup state</option>
          <option value="yes">Setup complete</option>
          <option value="no">Setup incomplete</option>
        </select>
        <select
          aria-label="Source"
          className={sel}
          value={source}
          onChange={(e) => reset(setSource)(e.target.value)}
        >
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Sort"
          className={sel}
          value={sort}
          onChange={(e) => setSort(e.target.value as "newest")}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>
      {error && <p className="text-sm text-destructive">Couldn't load members.</p>}
      {data && (
        <>
          <p className="text-xs text-muted-foreground">{data.total} members</p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  {[
                    "Member",
                    "Joined",
                    "Source",
                    "Plan",
                    "Subscription",
                    "Renews",
                    "Life Audit",
                    "Plan accepted",
                    "Last active",
                    "This month",
                    "Reward",
                    "Voice min",
                    "Support",
                  ].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.code} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Link
                        to="/app/admin/owner/users/$code"
                        params={{ code: r.code }}
                        className="font-mono text-primary underline"
                      >
                        {r.code}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{fmtDate(r.signup)}</td>
                    <td className="px-3 py-2">{r.source}</td>
                    <td className="px-3 py-2 capitalize">{r.tier}</td>
                    <td className="px-3 py-2">
                      {r.trial ? "Trial" : r.subscription}
                      {r.cancelling ? " (cancelling)" : ""}
                    </td>
                    <td className="px-3 py-2">{fmtDate(r.renewal)}</td>
                    <td className="px-3 py-2">{r.lifeAudit ? "Yes" : "No"}</td>
                    <td className="px-3 py-2">{r.planAccepted ? "Yes" : "No"}</td>
                    <td className="px-3 py-2">
                      {fmtDate(r.lastActivity)}
                      {r.activeThisWeek ? " ●" : ""}
                    </td>
                    <td className="px-3 py-2">
                      {r.monthCompletion == null ? "—" : `${r.monthCompletion}%`}
                    </td>
                    <td className="px-3 py-2">
                      {r.reward ? r.reward.replace("_", " ").toLowerCase() : "—"}
                    </td>
                    <td className="px-3 py-2">{r.voiceMinutes}</td>
                    <td className="px-3 py-2">{r.supportFlag ? "Open issue" : "—"}</td>
                  </tr>
                ))}
                {!data.rows.length && (
                  <tr>
                    <td colSpan={13} className="px-3 py-6 text-center text-muted-foreground">
                      No members match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <button
              className="h-10 rounded-md border border-border px-3 disabled:opacity-40"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span>
              Page {page + 1} of {pages}
            </span>
            <button
              className="h-10 rounded-md border border-border px-3 disabled:opacity-40"
              disabled={page + 1 >= pages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
