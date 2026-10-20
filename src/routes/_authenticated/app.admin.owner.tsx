import { FeatureHeader } from "@/components/FeatureHeader";
import { ShieldCheck } from "lucide-react";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/app/admin/owner")({
  head: () => ({
    meta: [
      { title: "Owner Control Centre | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Owner Control Centre in Plexecute." },
      { property: "og:title", content: "Owner Control Centre | Plexecute" },
      { property: "og:description", content: "Manage Owner Control Centre in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OwnerLayout,
});

const SECTIONS = [
  ["/app/admin/owner", "Overview"],
  ["/app/admin/owner/users", "Users"],
  ["/app/admin/owner/revenue", "Revenue"],
  ["/app/admin/owner/retention", "Retention"],
  ["/app/admin/owner/execution", "Execution"],
  ["/app/admin/owner/calls", "Calls"],
  ["/app/admin/owner/costs", "AI & provider costs"],
  ["/app/admin/owner/economics", "Unit economics"],
  ["/app/admin/owner/support", "Support"],
  ["/app/admin/owner/feedback", "Feedback"],
  ["/app/admin/owner/cohorts", "Cohorts"],
  ["/app/admin/owner/integrations", "Integrations"],
  ["/app/admin/owner/infrastructure", "Infrastructure"],
  ["/app/admin/owner/incidents", "Incidents"],
  ["/app/admin/owner/releases", "Releases"],
  ["/app/admin/owner/audit", "Audit"],
] as const;

function OwnerLayout() {
  return (
    <div className="space-y-5">
      <FeatureHeader
        title="Owner Control Centre"
        icon={ShieldCheck}
        description={
          'Real figures only. Members appear as codes. Anything without real data shows "Not yet available".'
        }
      />
      <nav className="member-owner-nav" aria-label="Owner sections">
        {SECTIONS.map(([to, label]) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/app/admin/owner" }}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            activeProps={{
              className:
                "rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm text-foreground",
            }}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

export const unknown = "Not yet available";
export const fmtPct = (v: number | null | undefined) => (v == null ? unknown : `${v}%`);
export const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-GB") : "—";
