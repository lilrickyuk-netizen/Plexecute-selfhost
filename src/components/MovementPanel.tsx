import { WithVoice } from "@/components/VoiceInputButton";
import { rows } from "@/lib/rows";
import { useProfile } from "@/lib/data";
import { useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMovementPlan, logMovement } from "@/lib/movement.functions";
import {
  CARDIO_GOALS,
  type CardioGoal,
  CARDIO_MODALITIES,
  INTENSITY,
  REGIONS,
  type CardioModality,
  type Intensity,
  type Region,
  type Restriction,
} from "@/lib/movement";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ExerciseDemoButton } from "@/components/ExerciseDemo";

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm ${on ? "border-execute bg-execute/15 text-execute" : "border-border text-muted-foreground hover:bg-raised"}`;

/** Cardio (Training) or mobility/recovery (Wellness & Movement), on the same deterministic engines. */
export function MovementPanel({
  mode,
  initialIntent = "mobility",
}: {
  mode: "cardio" | "mobility";
  initialIntent?: "mobility" | "flexibility" | "control";
}) {
  const qc = useQueryClient();
  const memberTz = useProfile().data?.timezone ?? null;
  const plan = useServerFn(getMovementPlan);
  const log = useServerFn(logMovement);
  const tab = mode;
  const [intensity, setIntensity] = useState<Intensity>("easy");
  const [modality, setModality] = useState<CardioModality>("walking");
  const [region, setRegion] = useState<Region>("full_body");
  const [minutes, setMinutes] = useState(15);
  const [restrictions, setRestrictions] = useState<Restriction[]>([]);
  const [experience, setExperience] = useState<"new" | "some" | "experienced">("some");
  const [intent, setIntent] = useState<"mobility" | "flexibility" | "control">(initialIntent);
  const [pace, setPace] = useState<"gentle" | "steady">("steady");
  const [equipment, setEquipment] = useState<("strap" | "blocks" | "wall")[]>(["wall"]);
  const [done, setDone] = useState({
    minutes: "",
    rpe: 4,
    completed: true,
    pain: false,
    note: "",
    tolerance: "right" as "easy" | "right" | "hard",
  });
  const [safety, setSafety] = useState(false);
  const [busy, setBusy] = useState(false);
  const [goal, setGoal] = useState<CardioGoal>("health");

  const { data: p } = useQuery({
    queryKey: [
      "movement-plan",
      intensity,
      region,
      minutes,
      restrictions,
      goal,
      experience,
      intent,
      pace,
      equipment,
    ],
    queryFn: () =>
      plan({
        data: {
          intensity,
          region,
          minutes,
          restrictions,
          goal,
          experience,
          intent,
          pace,
          equipment,
        },
      }),
  });
  const { data: history = [] } = useQuery({
    queryKey: ["movement-history", mode],
    queryFn: async () =>
      rows(
        await supabase
          .from("movement_sessions")
          .select("*")
          .eq("kind", mode)
          .order("created_at", { ascending: false })
          .limit(20),
      ),
  });

  async function save() {
    setBusy(true);
    try {
      const note = done.note.trim() || null;
      const r =
        tab === "cardio"
          ? await log({
              data: {
                kind: "cardio",
                modality,
                intensity,
                prescribedMinutes: p?.cardio.minutes ?? null,
                minutes: Number(done.minutes) || p?.cardio.minutes || 20,
                rpe: done.rpe,
                completed: done.completed,
                pain: done.pain,
                note,
              },
            })
          : await log({
              data: {
                kind: "mobility",
                region,
                minutes: Number(done.minutes) || minutes,
                restrictions,
                tolerance: done.tolerance,
                completed: done.completed,
                pain: done.pain,
                note,
              },
            });
      setSafety(r.safety);
      toast.success("Session saved");
      setDone({ ...done, minutes: "", note: "", pain: false });
      qc.invalidateQueries({ queryKey: ["movement-history"] });
      qc.invalidateQueries({ queryKey: ["movement-plan"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {safety && (
        <div
          role="alert"
          className="mt-5 rounded-[20px] border border-destructive bg-destructive/10 p-4 text-sm"
        >
          <b>Stop this activity.</b> You reported pain or a warning sign. Plexecute can't diagnose
          the cause. If you have chest pain, fainting or trouble breathing, call 999 now. For new or
          sharp pain, speak to a GP or physiotherapist before continuing.
        </div>
      )}

      {tab === "cardio" ? (
        <>
          <section className="mt-5 rounded-[20px] border border-border bg-card p-5">
            <h2 className="font-semibold">This week</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(CARDIO_GOALS) as CardioGoal[]).map((g) => (
                <button key={g} className={chip(goal === g)} onClick={() => setGoal(g)}>
                  {CARDIO_GOALS[g].label}
                </button>
              ))}
            </div>
            {p && (
              <>
                <p className="mt-3 text-2xl font-semibold">
                  {p.weekly.done}{" "}
                  <span className="text-base font-normal text-muted-foreground">
                    of {p.weekly.target} active minutes
                  </span>
                </p>
                <div className="mt-2 h-2 rounded-full bg-raised">
                  <div
                    className="h-2 rounded-full bg-execute"
                    style={{ width: `${p.weekly.pct}%` }}
                  />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {p.weekly.goal.mix}
                  {p.weekly.fromSteps
                    ? ` Includes ${p.weekly.fromSteps} min from your step count.`
                    : ""}{" "}
                  Hard minutes count double, easy minutes count half.
                </p>
                {p.plannedToday && (
                  <p className="mt-2 text-sm">
                    Planned today: {p.plannedToday.title} at{" "}
                    {new Date(p.plannedToday.starts_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      ...(memberTz ? { timeZone: memberTz } : {}),
                    })}
                    . Saving a session below marks it done.
                  </p>
                )}
              </>
            )}
          </section>
          <section className="mt-5 rounded-[20px] border border-border bg-card p-5">
            <div className="flex flex-wrap gap-2">
              {CARDIO_MODALITIES.map((m) => (
                <button
                  key={m.key}
                  className={chip(modality === m.key)}
                  onClick={() => setModality(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(Object.keys(INTENSITY) as Intensity[]).map((k) => (
                <button key={k} className={chip(intensity === k)} onClick={() => setIntensity(k)}>
                  {INTENSITY[k].label}
                </button>
              ))}
            </div>
            {p && (
              <div className="mt-4">
                <div className="text-4xl font-semibold text-execute">{p.cardio.minutes} min</div>
                <p className="mt-1">
                  Effort {p.cardio.rpe[0]}–{p.cardio.rpe[1]} out of 10. {p.cardio.talk}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{p.cardio.reason}</p>
                {p.cardio.recoveryNote && (
                  <p className="mt-1 text-sm text-warning">{p.cardio.recoveryNote}</p>
                )}
                <div className="mt-3">
                  <ExerciseDemoButton
                    exerciseKey={`cardio:${modality}`}
                    name={CARDIO_MODALITIES.find((m) => m.key === modality)?.label ?? "Cardio"}
                  />
                </div>
                {modality === "swimming" && (
                  <p className="mt-1 text-sm text-muted-foreground">Swimming is logged manually.</p>
                )}
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="mt-5 rounded-[20px] border border-border bg-card p-5">
          <div className="flex flex-wrap gap-2">
            {REGIONS.map((r) => (
              <button
                key={r.key}
                className={chip(region === r.key)}
                onClick={() => setRegion(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {[10, 15, 20, 30].map((m) => (
              <button key={m} className={chip(minutes === m)} onClick={() => setMinutes(m)}>
                {m} min
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Avoid strain on:</span>
            {(["knee", "back", "shoulder", "wrist"] as Restriction[]).map((r) => (
              <button
                key={r}
                className={chip(restrictions.includes(r))}
                onClick={() =>
                  setRestrictions((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]))
                }
              >
                {r}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Experience:</span>
            {(["new", "some", "experienced"] as const).map((x) => (
              <button key={x} className={chip(experience === x)} onClick={() => setExperience(x)}>
                {x}
              </button>
            ))}
            <span className="ml-2 text-muted-foreground">Focus:</span>
            {(["mobility", "flexibility", "control"] as const).map((x) => (
              <button key={x} className={chip(intent === x)} onClick={() => setIntent(x)}>
                {x}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Pace:</span>
            {(["gentle", "steady"] as const).map((x) => (
              <button key={x} className={chip(pace === x)} onClick={() => setPace(x)}>
                {x}
              </button>
            ))}
            <span className="ml-2 text-muted-foreground">I have:</span>
            {(["strap", "blocks", "wall"] as const).map((x) => (
              <button
                key={x}
                className={chip(equipment.includes(x))}
                onClick={() =>
                  setEquipment((e) => (e.includes(x) ? e.filter((y) => y !== x) : [...e, x]))
                }
              >
                {x}
              </button>
            ))}
          </div>
          {p && (
            <div className="mt-4">
              <div className="text-sm text-muted-foreground">
                Level {p.mobility.level} · about {p.mobility.estimatedMinutes} min ·{" "}
                {p.mobility.reason}
              </div>
              <ol className="mt-3 space-y-3">
                {p.mobility.steps.map((s, i) => (
                  <li key={s.key} className="rounded-xl bg-raised p-3">
                    <div className="flex justify-between gap-2">
                      <b>
                        {i + 1}. {s.name}
                      </b>
                      <span className="text-execute">{s.amount}</span>
                    </div>
                    <p className="text-sm">{s.cue}</p>
                    <div className="mt-2">
                      <ExerciseDemoButton exerciseKey={`pose:${s.key}`} name={s.name} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Easier: {s.regression} · Harder: {s.progression}
                    </p>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-muted-foreground">
                Never force a stretch through pain. Mild tension is fine; pain means ease off.
              </p>
            </div>
          )}
        </section>
      )}

      <section className="mt-5 rounded-[20px] border border-border bg-card p-5">
        <h2 className="font-semibold">Log this session</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Minutes done
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
              placeholder={String(tab === "cardio" ? (p?.cardio.minutes ?? 20) : minutes)}
              value={done.minutes}
              onChange={(e) => setDone({ ...done, minutes: e.target.value })}
            />
          </label>
          {tab === "cardio" ? (
            <label className="text-sm">
              Effort (1–10): {done.rpe}
              <input
                type="range"
                min={1}
                max={10}
                value={done.rpe}
                onChange={(e) => setDone({ ...done, rpe: Number(e.target.value) })}
                className="mt-3 w-full accent-[var(--color-execute)]"
              />
            </label>
          ) : (
            <div className="text-sm">
              How did it feel?
              <div className="mt-1 flex gap-2">
                {(["easy", "right", "hard"] as const).map((t) => (
                  <button
                    key={t}
                    className={chip(done.tolerance === t)}
                    onClick={() => setDone({ ...done, tolerance: t })}
                  >
                    {t === "right" ? "About right" : t === "easy" ? "Easy" : "Too hard"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={done.completed}
              onChange={(e) => setDone({ ...done, completed: e.target.checked })}
            />{" "}
            Finished it all
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={done.pain}
              onChange={(e) => setDone({ ...done, pain: e.target.checked })}
            />{" "}
            I had pain or a warning sign
          </label>
        </div>
        <WithVoice value={done.note} onChange={(v) => setDone({ ...done, note: v })}>
          <Textarea
            className="mt-3"
            placeholder="Notes (optional)"
            value={done.note}
            onChange={(e) => setDone({ ...done, note: e.target.value })}
          />
        </WithVoice>
        <Button className="mt-3" disabled={busy} onClick={save}>
          Save session
        </Button>
      </section>

      <section className="mt-5">
        <h2 className="font-semibold">
          {mode === "cardio" ? "Cardio history" : "Mobility history"}
        </h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No sessions yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-[20px] border border-border bg-card">
            {history.map((h) => (
              <li key={h.id} className="flex justify-between gap-2 px-4 py-3 text-sm">
                <span>
                  {h.performed_on} · {h.kind === "cardio" ? h.modality : `Mobility L${h.level}`}
                  {h.pain_flag ? " · pain reported" : ""}
                </span>
                <span className="text-muted-foreground">
                  {h.duration_min} min{h.rpe ? ` · effort ${h.rpe}` : ""}
                  {h.tolerance ? ` · ${h.tolerance}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
