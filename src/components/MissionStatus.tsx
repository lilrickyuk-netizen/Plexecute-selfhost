import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { STAGE_LABEL, type MissionState, type Blocker } from "@/lib/mission";

/** Member-facing mission stage, open blockers and next scheduled step. No internal workings shown. */
export function MissionStatus({ goalId }: { goalId: string }) {
  const { data } = useQuery({
    queryKey: ["mission", goalId],
    queryFn: async () => {
      const [{ data: m }, { data: next }] = await Promise.all([
        supabase
          .from("goal_missions")
          .select("state,blockers,contract")
          .eq("goal_id", goalId)
          .maybeSingle(),
        supabase
          .from("plan_blocks")
          .select("title,starts_at")
          .eq("goal_id", goalId)
          .gte("starts_at", new Date().toISOString())
          .order("starts_at")
          .limit(1),
      ]);
      return { m, next: next?.[0] ?? null };
    },
  });
  if (!data?.m) return null;
  const state = data.m.state as MissionState;
  const blockers = ((data.m.blockers as Blocker[] | null) ?? []).slice(0, 3);
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Where this stands</h2>
        <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
          {STAGE_LABEL[state]}
        </span>
      </div>
      {data.next ? (
        <p className="text-sm text-foreground">
          Next: {data.next.title} ·{" "}
          {new Date(data.next.starts_at).toLocaleString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing scheduled next yet. Ask Coach to plan it.
        </p>
      )}
      {blockers.length > 0 && (
        <ul className="space-y-1 text-sm">
          {blockers.map((b, i) => (
            <li key={i} className="text-foreground">
              <span className="text-muted-foreground">Needs attention:</span> {b.detail}
              {b.route_around ? (
                <span className="text-muted-foreground"> — {b.route_around}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
