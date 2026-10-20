import { ContactRound } from "lucide-react";
import { FeatureHeader } from "@/components/FeatureHeader";
import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyClients } from "@/lib/professional.functions";
import { ROLE_LABEL, type ProRole } from "@/lib/professional";

export const Route = createFileRoute("/_authenticated/app/clients")({
  head: () => ({
    meta: [
      { title: "My clients · Plexecute" },
      {
        name: "description",
        content: "People who have shared parts of their Plexecute plan with you.",
      },
      { property: "og:title", content: "My clients · Plexecute" },
      {
        property: "og:description",
        content: "People who have shared parts of their Plexecute plan with you.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Clients,
});

function Clients() {
  const get = useServerFn(getMyClients);
  const { data = [] } = useQuery({ queryKey: ["pro-clients"], queryFn: () => get() });
  const child = useMatchRoute()({ to: "/app/clients/$id" });
  if (child) return <Outlet />;
  return (
    <div>
      <FeatureHeader
        title="My clients"
        icon={ContactRound}
        description="People who invited you through Professional Connect. You see only what each person allowed."
      />
      {data.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No one has shared with you yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-[20px] border border-border bg-card">
          {data.map((c) => (
            <li key={c.id}>
              <Link
                to="/app/clients/$id"
                params={{ id: c.id }}
                className="block px-5 py-4 hover:bg-raised"
              >
                <span className="font-medium">{c.client}</span>
                <span className="block text-xs text-muted-foreground">
                  As their {ROLE_LABEL[c.role as ProRole].toLowerCase()} · {c.perms.length}{" "}
                  permissions
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
