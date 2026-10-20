import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getJobHealth, replayDeadJob } from "@/lib/jobs.functions";

const when = (s: string | null) => (s ? new Date(s).toLocaleString() : "never");

export function JobHealth() {
  const fn = useServerFn(getJobHealth);
  const replay = useServerFn(replayDeadJob);
  const { data, refetch } = useQuery({ queryKey: ["job-health"], queryFn: () => fn() });
  if (!data) return null;
  return (
    <section className="rounded-[20px] border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">Background work</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {data.healthy ? "All running normally." : "Needs attention."} Waiting: {data.waiting} ·
        Failed for good: {data.dead} · Longest wait: {data.oldestDueMinutes} min. Last 7 days.
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        {Object.entries(data.byKind).map(([k, v]) => (
          <li key={k}>
            <span className="font-medium">{data.labels[k] ?? k}</span>: {v.succeeded} done ·{" "}
            {v.retrying} retrying · {v.dead} failed · last success {when(v.lastSuccess)}
            {v.avgMs != null && ` · avg ${v.avgMs} ms`}
          </li>
        ))}
        {!Object.keys(data.byKind).length && (
          <li className="text-muted-foreground">Nothing has run yet.</li>
        )}
      </ul>
      {data.deadList.length > 0 && (
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-medium">Failed after all retries</h3>
          {data.deadList.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-border p-3 text-sm"
            >
              <div>
                <p>
                  {data.labels[d.kind] ?? d.kind} · {d.attempts} tries · {when(d.finished_at)}
                </p>
                <p className="text-muted-foreground">{d.last_error}</p>
                {d.history.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    History: {d.history.map((h) => `${h.event} (try ${h.attempt})`).join(" → ")}
                  </p>
                )}
              </div>
              {d.replayable ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-[10px]"
                  onClick={async () => {
                    try {
                      const r = await replay({ data: { id: d.id } });
                      toast[r.status === "succeeded" ? "success" : "error"](
                        r.status === "succeeded"
                          ? "Re-run worked"
                          : `Re-run failed: ${r.error ?? r.status}`,
                      );
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                    await refetch();
                  }}
                >
                  Run again
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Next scheduled run retries this
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
