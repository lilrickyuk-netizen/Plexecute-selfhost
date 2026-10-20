import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAdminStatus } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/app/admin")({
  head: () => ({
    meta: [
      { title: "Admin | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Admin in Plexecute." },
      { property: "og:title", content: "Admin | Plexecute" },
      { property: "og:description", content: "Manage Admin in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminLayout,
});

const SECTIONS = [
  ["/app/admin", "Home"],
  ["/app/admin/owner", "Owner Control Centre"],
  ["/app/admin/users", "Users"],
  ["/app/admin/subscriptions", "Subscriptions"],
  ["/app/admin/integrations", "Integrations"],
  ["/app/admin/jobs", "Jobs"],
  ["/app/admin/calls", "Calls"],
  ["/app/admin/safety", "Safety"],
  ["/app/admin/knowledge", "Knowledge"],
  ["/app/admin/flags", "Flags"],
  ["/app/admin/experiments", "Experiments"],
  ["/app/admin/audit", "Audit"],
  ["/app/admin/health", "Health"],
  ["/app/admin/quotas", "Quotas"],
  ["/app/admin/incidents", "Incidents"],
] as const;

function AdminLayout() {
  const status = useServerFn(getMyAdminStatus);
  const { data: me, isLoading } = useQuery({ queryKey: ["admin-status"], queryFn: () => status() });
  if (isLoading) return <p className="text-sm text-muted-foreground">Checking access…</p>;
  if (!me?.isAdmin)
    return (
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This area is only for Plexecute administrators.
        </p>
      </div>
    );
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs uppercase tracking-widest text-primary">Operations</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Totals and service details only. Coach conversations and health details are never shown
          here. Lookups and changes are logged.
        </p>
      </header>
      <nav className="member-owner-nav" aria-label="Admin sections">
        {SECTIONS.map(([to, label]) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/app/admin" }}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
            activeProps={{
              className:
                "rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs text-foreground",
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
