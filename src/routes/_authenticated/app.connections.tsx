import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link2 } from "lucide-react";
import { Settings } from "@/components/MemberSettings";
import { getMyAdminStatus } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/app/connections")({
  head: () => ({
    meta: [
      { title: "Connections — Plexecute" },
      { name: "description", content: "Manage your Plexecute connections." },
      { property: "og:title", content: "Connections — Plexecute" },
      { property: "og:description", content: "Manage your Plexecute connections." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ConnectionsGate,
});

function ConnectionsGate() {
  const status = useServerFn(getMyAdminStatus);
  const { data: me, isLoading } = useQuery({ queryKey: ["admin-status"], queryFn: () => status() });
  if (isLoading) return <p className="text-sm text-muted-foreground">Checking access…</p>;
  if (!me?.isAdmin)
    return (
      <div className="rounded-[20px] border border-border bg-card p-8 text-center">
        <Link2 size={28} aria-hidden="true" className="mx-auto text-muted-foreground" />
        <h1 className="mt-3 text-xl font-semibold">Connections</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Connecting apps and devices is coming in a future upgrade. Everything else in Plexecute
          works today without it.
        </p>
      </div>
    );
  return <Settings surface="connections" />;
}
