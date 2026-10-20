import { nicePage } from "@/components/AdminUI";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAppHealth } from "@/lib/observability.functions";

const STATE: Record<string, string> = {
  ok: "Working",
  degraded: "Some failures",
  down: "Mostly failing",
};

export function AppHealth() {
  const fn = useServerFn(getAppHealth);
  const { data } = useQuery({ queryKey: ["app-health"], queryFn: () => fn() });
  if (!data) return null;
  return (
    <section className="rounded-[20px] border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">App health (last 24 hours)</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Errors: {data.errors24h}
        {Object.keys(data.bySource).length > 0 &&
          ` (${Object.entries(data.bySource)
            .map(
              ([k, v]) =>
                `${k === "client" ? "in the app" : k === "job" ? "background" : "server"} ${v}`,
            )
            .join(" · ")})`}
        . Outside error tracking: {data.monitoring.errorTracking ? "on" : "not switched on"} ·
        Product analytics: {data.monitoring.productAnalytics ? "on" : "not switched on"}.
      </p>
      {data.topErrors.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-medium">Most frequent errors</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {data.topErrors.map((e, i) => (
              <li key={i}>
                <span className="font-medium">{e.count}×</span>{" "}
                <span className="break-words">
                  {e.message.replace(/\/_serverFn\/\S+/g, "background request")}
                </span>{" "}
                <span className="text-muted-foreground">
                  · {nicePage(e.route)} · last {new Date(e.last).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3">
        <h3 className="text-sm font-medium">Outside services</h3>
        {data.providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No calls to outside services yet.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {data.providers.map((p) => (
              <li key={p.provider}>
                <span className="font-medium">{p.provider}</span>: {STATE[p.state]} · {p.calls}{" "}
                calls · {p.successRate}% ok{p.p95Ms != null && ` · 95% under ${p.p95Ms} ms`}
                {p.lastFailureAt &&
                  ` · last failure ${new Date(p.lastFailureAt).toLocaleTimeString()}`}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
