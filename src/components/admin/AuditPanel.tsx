import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminAudit } from "@/lib/admin-console.functions";
import { Stat, Tally, Section, Loading } from "@/components/AdminUI";

export function AuditPanel() {
  const fn = useServerFn(adminAudit);
  const { data, error } = useQuery({ queryKey: ["admin-audit"], queryFn: () => fn() });
  return (
    <Section
      title="Audit"
      note="Every admin lookup and change, plus totals of member activity records for the last 7 days."
    >
      {error && <p className="text-sm text-destructive">Couldn't load this section.</p>}
      {!data ? (
        <Loading />
      ) : (
        <>
          <Stat label="Activity records (7d)" value={data.events7} />
          <div className="grid gap-3 md:grid-cols-3">
            <Tally title="By action" data={data.byAction} />
            <Tally title="By who acted" data={data.byActor} />
            <Tally title="By result" data={data.byOutcome} />
          </div>
          <section className="rounded-[14px] border border-border bg-card p-4 text-sm">
            <h3 className="font-medium">Admin actions</h3>
            {data.adminActions.length === 0 ? (
              <p className="mt-2 text-muted-foreground">None yet.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {data.adminActions.map((a) => (
                  <li key={a.id} className="text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()} · admin {a.admin_id} ·{" "}
                    {a.action.replace(/_/g, " ")}
                    {a.target_ref ? ` · ${a.target_ref}` : ""}
                    {a.reason ? ` · "${a.reason}"` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Section>
  );
}
