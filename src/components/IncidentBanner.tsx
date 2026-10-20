import { useQuery } from "@tanstack/react-query";
import { rows } from "@/lib/rows";
import { supabase } from "@/integrations/supabase/client";

/** V3 §91 incident controls: open incidents are shown to every signed-in member. */
export function IncidentBanner() {
  const { data } = useQuery({
    queryKey: ["open-incidents"],
    queryFn: async () =>
      rows(
        await supabase
          .from("incidents")
          .select("id,member_message,status,severity")
          .neq("status", "resolved")
          .order("started_at", { ascending: false })
          .limit(3),
      ),
    refetchInterval: 120_000,
  });
  if (!data?.length) return null;
  return (
    <div role="status" className="mb-4 space-y-2">
      {data.map((i) => (
        <div
          key={i.id}
          className="rounded-[14px] border border-primary/40 bg-primary/10 p-3 text-sm"
        >
          <p className="font-medium">
            {i.status === "monitoring"
              ? "Service update: fix in place, monitoring"
              : "Service notice"}
          </p>
          <p className="text-muted-foreground">{i.member_message}</p>
        </div>
      ))}
    </div>
  );
}
