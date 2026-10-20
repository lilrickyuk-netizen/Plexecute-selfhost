import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminUserDetail } from "@/lib/admin-console.functions";
import { Stat, Tally, Section, Loading } from "@/components/AdminUI";

export const Route = createFileRoute("/_authenticated/app/admin/users/$id")({
  head: () => ({
    meta: [
      { title: "Member details | Plexecute admin" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Manage Member details in Plexecute." },
      { property: "og:title", content: "Member details | Plexecute admin" },
      { property: "og:description", content: "Manage Member details in Plexecute." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UserDetail,
});

const d = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : "none");

function UserDetail() {
  const { id } = Route.useParams();
  const detail = useServerFn(adminUserDetail);
  const { data, error } = useQuery({
    queryKey: ["admin-user", id],
    queryFn: () => detail({ data: { id } }),
  });
  if (error) return <p className="text-sm text-destructive">Couldn't load this member.</p>;
  if (!data) return <Loading />;
  if (!data.found)
    return <p className="text-sm text-muted-foreground">No member with that reference.</p>;
  const p = data.profile,
    s = data.subscription;
  return (
    <Section
      title={`Member ${data.ref}`}
      note="Account and service details for support. Conversations, food, health readings and call content are not shown. This view was logged."
    >
      <Link to="/app/admin/users" className="text-xs text-primary">
        Back to users
      </Link>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Plan" value={p.tier} />
        <Stat label="Account" value={p.account_status} />
        <Stat label="Setup finished" value={p.onboarded ? "yes" : "no"} />
        <Stat label="Data use paused" value={p.processing_restricted ? "yes" : "no"} />
        <Stat label="Joined" value={new Date(p.created_at).toLocaleDateString()} />
        <Stat
          label="Last sign in"
          value={data.lastSignIn ? new Date(data.lastSignIn).toLocaleDateString() : "never"}
        />
        <Stat label="Time zone" value={p.timezone} />
        <Stat label="Active safety notes" value={data.activeSafetyNotes} />
      </div>
      <section className="rounded-[14px] border border-border bg-card p-4 text-sm">
        <h3 className="font-medium">Subscription</h3>
        {s ? (
          <p className="mt-2 text-muted-foreground">
            {s.tier} · {s.status} · {s.billing_interval ?? "no interval"} · renews{" "}
            {d(s.current_period_end)}
            {s.cancel_at_period_end ? " · cancels at period end" : ""}
            {s.trial_ends_at ? ` · trial ends ${d(s.trial_ends_at)}` : ""} · trial used{" "}
            {s.trial_used ? "yes" : "no"}
          </p>
        ) : (
          <p className="mt-2 text-muted-foreground">No paid subscription.</p>
        )}
      </section>
      <div className="grid gap-3 md:grid-cols-2">
        <Tally title="Record counts" data={data.counts} />
        <Tally
          title={`Calls in the last 30 days (${data.calls30.campaigns}, ${data.calls30.connectedMinutes} min)`}
          data={data.calls30.byState}
        />
      </div>
      <section className="rounded-[14px] border border-border bg-card p-4 text-sm">
        <h3 className="font-medium">Consents</h3>
        {data.consents.length === 0 ? (
          <p className="mt-2 text-muted-foreground">None recorded.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {data.consents.map((c, i) => (
              <li key={i} className="text-muted-foreground">
                {d(c.occurred_at)} · {c.action} ·{" "}
                {[c.domain, c.purpose].filter(Boolean).join(" / ")} · {c.policy_version} ·{" "}
                {c.source}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-[14px] border border-border bg-card p-4 text-sm">
        <h3 className="font-medium">Data requests</h3>
        {data.requests.length === 0 ? (
          <p className="mt-2 text-muted-foreground">None.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {data.requests.map((r, i) => (
              <li key={i} className="text-muted-foreground">
                {r.request_type} · {r.status} · reply by {d(r.due_at)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Section>
  );
}
