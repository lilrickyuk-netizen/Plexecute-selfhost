import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { rows } from "@/lib/rows";
import { validZone } from "@/lib/tz";

const LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  processing: "Calling now",
  placed: "Call placed",
  not_placed: "Couldn't place the call",
  held: "Held: calling not switched on yet",
  missed_window: "Missed: too late to call",
  cancelled: "Cancelled",
};
const OUTCOME: Record<string, string> = {
  ACKNOWLEDGED: "you answered",
  HUMAN_CONNECTED: "you answered",
  NO_ANSWER: "no answer",
  BUSY: "line busy",
  FAILED: "call failed",
  RETRY_SCHEDULED: "trying again",
  MACHINE_DETECTED: "voicemail",
};

/** Calls the member asked for (via the Coach or elsewhere) and what happened to each. */
export function ScheduledCalls() {
  const { data = [] } = useQuery({
    queryKey: ["scheduled-calls"],
    queryFn: async () => {
      const list = rows(
        await supabase
          .from("scheduled_calls")
          .select("id,call_at,purpose,status,status_reason,campaign_id")
          .order("call_at", { ascending: false })
          .limit(20),
      );
      const { data: u } = await supabase.auth.getUser();
      const { data: prof } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("id", u.user?.id ?? "")
        .maybeSingle();
      const tz = validZone(prof?.timezone);
      const ids = list.map((r) => r.campaign_id).filter(Boolean) as string[];
      const camps = ids.length
        ? rows(await supabase.from("call_campaigns").select("id,state").in("id", ids))
        : [];
      return list.map((r) => ({
        ...r,
        state: camps.find((c) => c.id === r.campaign_id)?.state,
        tz,
      }));
    },
  });
  if (!data.length) return null;
  return (
    <section
      className="space-y-2 rounded-xl border border-border bg-card p-4"
      aria-label="Scheduled calls"
    >
      <h2 className="text-sm font-semibold">Scheduled calls</h2>
      <ul className="space-y-2">
        {data.map((c) => (
          <li key={c.id} className="text-sm">
            <span className="font-medium">
              {new Date(c.call_at).toLocaleString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: c.tz,
              })}
            </span>{" "}
            · {c.purpose}
            <span className="block text-xs text-muted-foreground">
              {LABEL[c.status] ?? c.status}
              {c.state && OUTCOME[c.state] ? ` · ${OUTCOME[c.state]}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
