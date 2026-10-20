import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAdminOverview } from "@/lib/admin.functions";
import { PrivacyOps } from "@/components/PrivacyCentre";
import { Stat, Section } from "@/components/AdminUI";

export const Route = createFileRoute("/_authenticated/app/admin/")({
  head: () => ({
    meta: [
      { title: "Admin home | Plexecute" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Admin home in Plexecute." },
      { property: "og:title", content: "Admin home | Plexecute" },
      { property: "og:description", content: "Manage Admin home in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminHome,
});

function AdminHome() {
  const overview = useServerFn(getAdminOverview);
  const { data, error } = useQuery({ queryKey: ["admin-overview"], queryFn: () => overview() });
  return (
    <Section title="Admin overview" note="Totals only. No personal details are shown here.">
      {error && <p className="text-sm text-destructive">Couldn't load the overview.</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Members" value={data.users} />
            <Stat label="New (7 days)" value={data.newUsers} />
            <Stat label="Sessions planned (7d)" value={data.blocks7} />
            <Stat label="Coach messages (7d)" value={data.coach7} />
            <Stat label="Calls (7d)" value={data.calls7} />
            <Stat label="Billing events (7d)" value={data.billing7} />
            <Stat label="Audit events (7d)" value={data.audit7} />
            <Stat
              label="Plans"
              value={
                Object.entries(data.tierCounts)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(" · ") || "none"
              }
            />
            <Stat
              label="Monthly rewards"
              value={`earned ${data.rewards["EARNED"]} · applied ${data.rewards["APPLIED"]} · not earned ${data.rewards["NOT_EARNED"]} · in progress ${data.rewards["IN_PROGRESS"]}${data.rewards["needs_attention"] ? ` · needs attention ${data.rewards["needs_attention"]}` : ""}`}
            />
          </div>
          <section>
            <h3 className="mb-2 text-sm font-medium">Services</h3>
            <ul className="space-y-1 text-sm">
              {Object.entries(data.services).map(([k, on]) => (
                <li key={k}>
                  {on ? "✓ Working" : "○ Not switched on"} · {k}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <PrivacyOps />
    </Section>
  );
}
