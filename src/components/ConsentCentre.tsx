import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyConsents } from "@/lib/consent.functions";
import { purposeLabel } from "@/lib/consent";

const WHERE: Record<string, string> = {
  health_data: "#calendar",
  wearable_data: "#calendar",
  calendar_access: "#calendar",
  professional_sharing: "/app/professionals",
  accountability_calls: "/app/accountability",
};

/** V3 §59: every consent with its scope, version, time and source. Withdraw where the access lives; it applies at once. */
export function ConsentCentre() {
  const fn = useServerFn(getMyConsents);
  const { data } = useQuery({ queryKey: ["consents"], queryFn: () => fn() });
  const rows = data?.current ?? [];
  return (
    <section
      id="consent"
      className="scroll-mt-20 space-y-3 rounded-[20px] border border-border bg-card p-6"
    >
      <h2 className="text-lg font-semibold">Your consents</h2>
      <p className="text-sm text-muted-foreground">
        Everything you've agreed to, with the version and when. Withdrawing takes effect straight
        away.
      </p>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No consents recorded yet.</p>
      )}
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const href =
            WHERE[r.purpose] ?? (r.purpose.startsWith("auto_adapt:") ? "#auto-adapt" : null);
          return (
            <li
              key={`${r.purpose}${r.subject_id}`}
              className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"
            >
              <div>
                <div className="font-medium">
                  {purposeLabel(r.purpose)}
                  {r.provider ? ` · ${r.provider}` : ""}
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.granted ? "Given" : "Withdrawn"}{" "}
                  {new Date(r.created_at).toLocaleString("en-GB")} · version {r.policy_version} ·
                  via {r.source}
                  {r.scope && r.scope.length > 0 && (
                    <> · covers {r.scope.join(", ").replace(/_/g, " ")}</>
                  )}
                  {r.history > 1 && <> · {r.history} changes</>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${r.granted ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
                >
                  {r.granted ? "Active" : "Withdrawn"}
                </span>
                {r.granted && href && (
                  <a href={href} className="text-xs text-primary">
                    Manage
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
