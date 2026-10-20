import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { clearSafetyFlag, declarePregnancy, getSafety } from "@/lib/safety.functions";
import { Button } from "@/components/ui/button";
import { GENERIC_EMERGENCY } from "@/lib/safety";

const LABEL: Record<string, string> = {
  exercise_red_flag: "Warning symptoms during exercise",
  pain: "Pain reported",
  pregnancy_postpartum: "Pregnant or recently given birth",
  eating_disorder_risk: "Food or weight worries",
  self_harm_crisis: "Crisis support",
  immediate_danger: "Immediate danger",
};
const EFFECT: Record<string, string> = {
  exercise_red_flag: "Training sessions are stopped until you clear this.",
  pregnancy_postpartum:
    "Calorie-deficit targets and progressive training plans are switched off. Scheduling, learning and life planning still work.",
  eating_disorder_risk:
    "Calorie-deficit targets, strict food accountability and food or weight calls are switched off.",
  self_harm_crisis: "Normal coaching and accountability calls are paused.",
  immediate_danger: "Normal coaching and accountability calls are paused.",
};

export function useSafety() {
  const fn = useServerFn(getSafety);
  return useQuery({ queryKey: ["safety"], queryFn: () => fn() });
}

/** Crisis/emergency options shown whenever the central safety state calls for them. */
export function CrisisBanner() {
  const { data } = useSafety();
  if (!data || !["CRISIS_SUPPORT", "EMERGENCY_GUIDANCE"].includes(data.policy.state)) return null;
  const r = data.resources;
  return (
    <div
      role="alert"
      className="rounded-[14px] border border-destructive/50 bg-destructive/10 p-4 text-sm"
    >
      <p className="font-medium">Help is available now</p>
      {r ? (
        <p className="mt-1">
          {r.country}: emergency <strong>{r.emergency}</strong>, urgent advice{" "}
          <strong>{r.urgent}</strong>, or {r.crisis}.
        </p>
      ) : (
        <p className="mt-1">{GENERIC_EMERGENCY}</p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        Plexecute is not an emergency service and does not contact anyone for you.
      </p>
    </div>
  );
}

export function SafetySettings() {
  const qc = useQueryClient();
  const { data } = useSafety();
  const clear = useServerFn(clearSafetyFlag);
  const preg = useServerFn(declarePregnancy);
  const refresh = () => qc.invalidateQueries({ queryKey: ["safety"] });
  const pregnant = !!data?.flags.some((f) => f.signal === "pregnancy_postpartum");
  return (
    <section className="space-y-3 rounded-[16px] border border-border p-5">
      <h2 className="text-lg font-semibold">Safety</h2>
      <p className="text-sm text-muted-foreground">
        Plexecute doesn't diagnose anything. When something you write suggests a health risk, some
        automation is paused to keep you safe. You can clear a note when it no longer applies.
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={pregnant}
          onChange={async (e) => {
            await preg({ data: { on: e.target.checked } });
            refresh();
          }}
        />
        <span>I'm pregnant or have recently given birth</span>
      </label>
      {data?.flags.length ? (
        <ul className="space-y-2">
          {data.flags.map((f) => (
            <li
              key={f.id}
              className="flex items-start justify-between gap-3 rounded-[10px] border border-border p-3 text-sm"
            >
              <div>
                <div className="font-medium">{LABEL[f.signal] ?? f.signal}</div>
                <div className="text-xs text-muted-foreground">
                  {EFFECT[f.signal] ?? ""} Since {new Date(f.raised_at).toLocaleDateString("en-GB")}
                  .
                </div>
              </div>
              {f.signal !== "pregnancy_postpartum" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-[10px]"
                  onClick={async () => {
                    await clear({ data: { signal: f.signal as never } });
                    refresh();
                  }}
                >
                  Clear
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No active safety notes.</p>
      )}
      <CrisisBanner />
    </section>
  );
}
