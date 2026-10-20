import { Compass } from "lucide-react";
import { FeatureHeader } from "@/components/FeatureHeader";
import { createFileRoute } from "@tanstack/react-router";
import { PaidGate } from "@/components/PaidGate";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBehaviourModel, setBehaviourFeedback } from "@/lib/behaviour.functions";

export const Route = createFileRoute("/_authenticated/app/patterns")({
  head: () => ({
    meta: [
      { title: "Your patterns · Plexecute" },
      {
        name: "description",
        content: "What your own history shows about when and how you get things done.",
      },
      { property: "og:title", content: "Your patterns · Plexecute" },
      {
        property: "og:description",
        content: "Personal behaviour patterns with sample sizes and time windows.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <PaidGate cap="behaviour_model" title="Patterns">
      <Patterns />
    </PaidGate>
  ),
});

function Patterns() {
  const get = useServerFn(getBehaviourModel);
  const save = useServerFn(setBehaviourFeedback);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["behaviour-model"], queryFn: () => get() });
  const fb = new Map((data?.feedback ?? []).map((f) => [f.observation_key, f.verdict]));
  const act = async (key: string, verdict: "hidden" | "wrong" | null) => {
    await save({ data: { key, verdict } });
    qc.invalidateQueries({ queryKey: ["behaviour-model"] });
  };
  const shown = (data?.observations ?? []).filter((o) => fb.get(o.key) !== "hidden");
  const hidden = (data?.observations ?? []).filter((o) => fb.get(o.key) === "hidden");
  return (
    <div>
      <FeatureHeader
        title="Your patterns"
        icon={Compass}
        description="Built only from your own history. A pattern appears once there are at least 5 comparable sessions in each group and 14 days of history. These are associations, not causes. Nothing here is used to sell to you."
      />
      {isLoading && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}
      <div className="mt-6 space-y-3">
        {shown.map((o) => (
          <div key={o.key} className="rounded-[20px] border border-border bg-card p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-medium">{o.title}</h2>
              <span className="text-xs text-muted-foreground">
                {o.sample} {o.kind === "count" && o.key === "food" ? "days" : "items"} · {o.days}{" "}
                days
              </span>
            </div>
            <p className={`mt-2 text-sm ${o.enough ? "" : "text-muted-foreground"}`}>{o.text}</p>
            {fb.get(o.key) === "wrong" && (
              <p className="mt-2 text-xs text-muted-foreground">
                You marked this as not right. The coach won't rely on it.
              </p>
            )}
            <div className="mt-3 flex gap-4 text-xs">
              {fb.get(o.key) === "wrong" ? (
                <button className="underline" onClick={() => act(o.key, null)}>
                  Undo
                </button>
              ) : (
                <button className="underline" onClick={() => act(o.key, "wrong")}>
                  This isn't right
                </button>
              )}
              <button
                className="underline text-muted-foreground"
                onClick={() => act(o.key, "hidden")}
              >
                Hide
              </button>
            </div>
          </div>
        ))}
      </div>
      {hidden.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-muted-foreground">Hidden</h2>
          {hidden.map((o) => (
            <div key={o.key} className="mt-2 flex justify-between text-sm">
              <span>{o.title}</span>
              <button className="underline" onClick={() => act(o.key, null)}>
                Show
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
