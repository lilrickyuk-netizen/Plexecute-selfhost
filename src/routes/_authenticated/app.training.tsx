import trainingImage from "@/assets/member-training.jpg";
import { FeatureHeader } from "@/components/FeatureHeader";
import { useProfile } from "@/lib/data";
import { unitsOf, fmtWeight, kgToDisplay, displayToKg, weightUnit } from "@/lib/units";
import { createFileRoute } from "@tanstack/react-router";
import { rows } from "@/lib/rows";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldAlert, Timer, Repeat2, Dumbbell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  EX,
  estimate1RM,
  nextTrainingDay,
  returningLoad,
  substitutes,
  type Equipment,
} from "@/lib/training";
import { newOpId, sendOrQueue } from "@/lib/offline";
import { matchesTrainingSection as matches, showsActiveWorkout } from "@/lib/training-sections";
import {
  createProgramme,
  finishWorkout,
  logWorkoutSet,
  startWorkout,
  substituteExercise,
} from "@/lib/training.functions";
import { Input } from "@/components/ui/input";
import { ExerciseDemoButton } from "@/components/ExerciseDemo";
import { MovementPanel } from "@/components/MovementPanel";
import { buildConditioningProgramme } from "@/lib/conditioning";
import { RecoveryPanel } from "@/components/RecoveryPanel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/app/training")({
  head: () => ({
    meta: [
      { title: "Training: strength, bodyweight, cardio, recovery · Plexecute" },
      {
        name: "description",
        content: "Your versioned training programme, workouts, progression and daily recovery.",
      },
      {
        property: "og:title",
        content: "Training: strength, bodyweight, cardio, recovery · Plexecute",
      },
      {
        property: "og:description",
        content: "Your versioned training programme, workouts, progression and daily recovery.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (
    s: Record<string, unknown>,
  ): { section?: "strength" | "bodyweight" | "cardio" | "conditioning" | "recovery" } => {
    const v = (["strength", "bodyweight", "cardio", "conditioning", "recovery"] as const).find(
      (x) => x === s["section"],
    );
    return v ? { section: v } : {};
  },
  component: TrainingPage,
});

type Section = "strength" | "bodyweight" | "cardio" | "conditioning";
const SECTIONS: { key: Section; label: string; blurb: string }[] = [
  { key: "strength", label: "Strength", blurb: "Weights, dumbbells, machines" },
  { key: "bodyweight", label: "Bodyweight", blurb: "No equipment, anywhere" },
  { key: "cardio", label: "Cardio", blurb: "Walk, run, cycle, row, swim" },
  { key: "conditioning", label: "Conditioning", blurb: "Short-rest circuits" },
];
const ALL_SECTIONS: { key: Section | "recovery"; label: string; blurb: string }[] = [
  ...SECTIONS,
  { key: "recovery", label: "Recovery", blurb: "Daily check-in and readiness" },
];
const PRESET: Record<Exclude<Section, "cardio">, { goal?: string; equipment?: string }> = {
  strength: { goal: "strength", equipment: "gym" },
  bodyweight: { equipment: "bodyweight" },
  conditioning: { goal: "conditioning" },
};

function TrainingPage() {
  const { section: chosen } = Route.useSearch();
  const nav = Route.useNavigate();
  // With no tab chosen, open the tab that holds the member's active programme so its sessions and
  // progression are visible straight away.
  const { data: prog } = useQuery({
    queryKey: ["programme"],
    enabled: !chosen,
    queryFn: async () =>
      (
        await supabase
          .from("training_programmes")
          .select("*")
          .eq("status", "active")
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data,
  });
  const section: Section | "recovery" =
    chosen ??
    (prog
      ? ((["bodyweight", "conditioning", "strength"] as const).find((k) => matches(k, prog)) ??
        "strength")
      : "strength");
  return (
    <div>
      <FeatureHeader
        title="Training"
        icon={Dumbbell}
        description="Plexecute builds your workouts. Demonstration videos are optional."
      />
      <div className="member-training-cover">
        <img src={trainingImage} width={1536} height={1024} alt="Strength training equipment" />
      </div>
      <div className="member-segments" role="tablist" aria-label="Training type">
        {ALL_SECTIONS.map((x) => (
          <Button
            variant="ghost"
            key={x.key}
            role="tab"
            aria-selected={section === x.key}
            onClick={() => nav({ search: { section: x.key } })}
          >
            <span className={`block font-semibold ${section === x.key ? "text-execute" : ""}`}>
              {x.label}
            </span>
          </Button>
        ))}
      </div>
      <div className="mt-6">
        {section === "recovery" ? (
          <RecoveryPanel />
        ) : section === "cardio" ? (
          <MovementPanel mode="cardio" />
        ) : (
          <Training key={section} section={section} />
        )}
      </div>
    </div>
  );
}

const LIMITS = [
  ["knee_pain", "Knee"],
  ["back_pain", "Lower back"],
  ["shoulder_pain", "Shoulder"],
  ["wrist_pain", "Wrist"],
] as const;

function Training({ section }: { section: Exclude<Section, "cardio"> }) {
  const qc = useQueryClient();
  const { data: programme, isLoading } = useQuery({
    queryKey: ["programme"],
    queryFn: async () =>
      (
        await supabase
          .from("training_programmes")
          .select("*")
          .eq("status", "active")
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data,
  });
  const { data: rxs = [] } = useQuery({
    queryKey: ["rx", programme?.id],
    enabled: !!programme,
    queryFn: async () =>
      rows(
        await supabase
          .from("programme_prescriptions")
          .select("*")
          .eq("programme_id", programme!.id)
          .order("day_index")
          .order("order_index"),
      ),
  });
  const { data: active } = useQuery({
    queryKey: ["workout-active"],
    queryFn: async () =>
      (
        await supabase
          .from("workout_sessions")
          .select("*")
          .eq("status", "in_progress")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data,
  });
  const { data: recent = [] } = useQuery({
    queryKey: ["workout-recent", programme?.id],
    enabled: !!programme,
    queryFn: async () =>
      rows(
        await supabase
          .from("workout_sessions")
          .select("day_index,status,started_at")
          .eq("programme_id", programme!.id)
          .order("started_at", { ascending: false })
          .limit(20),
      ),
  });
  const [editing, setEditing] = useState(false);
  const sectionLabel = SECTIONS.find((x) => x.key === section)?.label ?? "Strength";

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!programme || editing)
    return (
      <Setup
        onDone={() => {
          setEditing(false);
          qc.invalidateQueries();
        }}
        current={programme ?? null}
        preset={PRESET[section]}
        sectionLabel={sectionLabel}
      />
    );
  if (!matches(section, programme))
    return (
      <section className="rounded-[20px] border border-border bg-card p-5">
        <p className="font-medium">
          Your current programme is {programme.goal} with {programme.equipment} equipment.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Build a {sectionLabel.toLowerCase()} programme instead? Your history and progress are
          kept.
        </p>
        <Button className="mt-3" onClick={() => setEditing(true)}>
          Build a {sectionLabel.toLowerCase()} programme
        </Button>
      </section>
    );
  if (active && showsActiveWorkout(section, programme, active))
    return (
      <Workout
        session={active}
        rxs={rxs.filter((r) => r.day_index === active.day_index)}
        equipment={programme.equipment as Equipment}
      />
    );
  // The Conditioning tab shows its own fixed HIIT / circuit / aerobic programme, never a
  // copy of the strength or bodyweight programme.
  if (section === "conditioning") return <ConditioningProgramme current={programme} />;
  const days = [...new Set(rxs.map((r) => r.day_index))];
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-execute">
            Programme v{programme.version}
          </p>
          <h1 className="mt-1 text-3xl font-semibold capitalize">
            {programme.goal} · {programme.days_per_week} days
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {programme.equipment} equipment · {programme.session_minutes} min sessions · working
            sets at 2 to 3 reps in reserve
          </p>
        </div>
        <Button variant="outline" className="rounded-[10px]" onClick={() => setEditing(true)}>
          New version
        </Button>
      </div>
      <StartDay
        programmeId={programme.id}
        days={days}
        rxs={rxs}
        next={nextTrainingDay(recent, days.length)}
      />
      <History />
    </div>
  );
}

function ConditioningProgramme({
  current,
}: {
  current: {
    experience: string;
    equipment: string;
    limitations?: string[] | null;
    days_per_week?: number;
  } | null;
}) {
  const plan = buildConditioningProgramme({
    experience: current?.experience === "intermediate" ? "intermediate" : "novice",
    equipment:
      current?.equipment === "gym" || current?.equipment === "home"
        ? current.equipment
        : "bodyweight",
    limitations: (current?.limitations ?? []) as (
      "knee_pain" | "back_pain" | "shoulder_pain" | "wrist_pain"
    )[],
    daysPerWeek: current?.days_per_week ?? 3,
  });
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-execute">Conditioning</p>
        <h1 className="mt-1 text-3xl font-semibold">HIIT · circuits · aerobic base</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Three sessions a week, adapted to your experience, equipment and any limitations.
        </p>
        {plan.notes.map((n) => (
          <p key={n} className="mt-1 text-xs text-muted-foreground">
            {n}
          </p>
        ))}
      </div>
      {plan.days.map((d) => (
        <section key={d.key} className="rounded-[20px] border border-border bg-card p-5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold">{d.title}</h2>
            <p className="text-sm text-muted-foreground">{d.duration}</p>
          </div>
          {d.blocks.map((b) => (
            <div key={b.heading} className="mt-3">
              <p className="text-sm font-medium">{b.heading}</p>
              <ul className="mt-1 space-y-1">
                {b.steps.map((s) => (
                  <li key={s.name} className="text-sm text-muted-foreground">
                    <span className="text-foreground">{s.name}</span> — {s.amount}
                    {s.note ? <span className="block text-xs">{s.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      <section className="rounded-[20px] border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">Weekly schedule</h2>
        <ul className="mt-2 space-y-1">
          {plan.schedule.map((s) => (
            <li key={s.day} className="text-sm text-muted-foreground">
              <span className="text-foreground">{s.day}:</span> {s.session}
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-[20px] border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">Progression</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every 1–2 weeks, progress by using one or more of:
        </p>
        <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
          {plan.progression.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Setup({
  onDone,
  current,
  preset,
  sectionLabel,
}: {
  sectionLabel: string;
  preset?: { goal?: string; equipment?: string };
  onDone: () => void;
  current: {
    goal: string;
    experience: string;
    equipment: string;
    days_per_week: number;
    session_minutes: number;
  } | null;
}) {
  const create = useServerFn(createProgramme);
  const [f, setF] = useState({
    goal: preset?.goal ?? current?.goal ?? "hypertrophy",
    experience: current?.experience ?? "novice",
    equipment:
      preset?.equipment ??
      (current?.equipment === "bodyweight" ? "gym" : current?.equipment) ??
      "gym",
    days: current?.days_per_week ?? 3,
    sessionMinutes: current?.session_minutes ?? 60,
    limitations: [] as string[],
  });
  const [busy, setBusy] = useState(false);
  const opt = (k: "goal" | "experience" | "equipment", vals: [string, string][]) => (
    <div className="flex flex-wrap gap-2">
      {vals.map(([v, l]) => (
        <button
          type="button"
          key={v}
          onClick={() => setF({ ...f, [k]: v })}
          className={`rounded-[10px] border px-3 py-2 text-sm ${f[k] === v ? "border-primary bg-primary text-primary-foreground" : "border-border bg-raised"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
  async function submit() {
    setBusy(true);
    try {
      await create({
        data: {
          ...f,
          goal: f.goal as "strength",
          experience: f.experience as "novice",
          equipment: f.equipment as "gym",
          limitations: f.limitations as "knee_pain"[],
        },
      });
      toast.success(
        "Programme created. Replan on your Plan page to place its workouts in your week.",
      );
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <h1 className="text-3xl font-semibold">Build your {sectionLabel.toLowerCase()} programme</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Plexecute builds a versioned programme from fixed rules. Every later change records the rule
        and evidence behind it.
      </p>
      <div className="mt-6 space-y-5 rounded-[20px] border border-border bg-card p-6">
        <div>
          <p className="mb-2 text-sm font-medium">Goal</p>
          {opt("goal", [
            ["strength", "Strength"],
            ["hypertrophy", "Muscle"],
            ["general", "General fitness"],
            ["conditioning", "Conditioning"],
            ["mixed", "Strength + muscle"],
          ])}
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Experience</p>
          {opt("experience", [
            ["novice", "New or returning"],
            ["intermediate", "1+ year consistent"],
          ])}
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Equipment</p>
          {opt("equipment", [
            ["gym", "Full gym"],
            ["home", "Dumbbells at home"],
            ["bodyweight", "Bodyweight only"],
          ])}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            Days per week
            <Input
              type="number"
              min={2}
              max={6}
              value={f.days}
              onChange={(e) => setF({ ...f, days: Number(e.target.value) })}
            />
          </label>
          <label className="text-sm">
            Minutes per session
            <Input
              type="number"
              min={20}
              max={120}
              value={f.sessionMinutes}
              onChange={(e) => setF({ ...f, sessionMinutes: Number(e.target.value) })}
            />
          </label>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Anything that hurts or limits you?</p>
          <div className="flex flex-wrap gap-2">
            {LIMITS.map(([v, l]) => {
              const on = f.limitations.includes(v);
              return (
                <button
                  type="button"
                  key={v}
                  onClick={() =>
                    setF({
                      ...f,
                      limitations: on
                        ? f.limitations.filter((x) => x !== v)
                        : [...f.limitations, v],
                    })
                  }
                  className={`rounded-[10px] border px-3 py-2 text-sm ${on ? "border-warning text-warning" : "border-border bg-raised"}`}
                >
                  {l}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Plexecute avoids movements that commonly aggravate these. It does not diagnose. See a
            professional for new or sharp pain.
          </p>
        </div>
        <Button
          className="w-full rounded-[10px]"
          disabled={
            busy || f.days < 2 || f.days > 6 || f.sessionMinutes < 20 || f.sessionMinutes > 120
          }
          onClick={submit}
        >
          Create programme
        </Button>
      </div>
    </div>
  );
}

type Rx = {
  id: string;
  day_index: number;
  exercise_key: string;
  sets: number;
  rep_min: number;
  rep_max: number;
  rir_target: number;
  rest_sec: number;
  load_kg: number | null;
};

function StartDay({
  programmeId,
  days,
  rxs,
  next,
}: {
  programmeId: string;
  days: number[];
  rxs: Rx[];
  next: ReturnType<typeof nextTrainingDay>;
}) {
  const U = unitsOf(useProfile().data);
  const qc = useQueryClient();
  const start = useServerFn(startWorkout);
  return (
    <>
      <p className="mt-6 rounded-[14px] border border-execute/40 bg-execute/10 p-3 text-sm">
        Next up: <b>Day {next.dayIndex + 1}</b>. {next.why}
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {days.map((d) => (
          <section
            key={d}
            className={`rounded-[20px] border bg-card p-5 ${d === next.dayIndex ? "border-execute" : "border-border"}`}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">
                Day {d + 1}
                {d === next.dayIndex ? " · next" : ""}
              </h2>
              <Button
                size="sm"
                className="rounded-[10px] bg-execute text-execute-foreground hover:bg-execute/90"
                onClick={async () => {
                  try {
                    const s = await start({ data: { programmeId, dayIndex: d } });
                    if (s.recovery_state !== "GREEN")
                      toast.message(`Recovery is ${s.recovery_state}. Loads won't increase today.`);
                    qc.invalidateQueries({ queryKey: ["workout-active"] });
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                Start
              </Button>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm">
              {rxs
                .filter((r) => r.day_index === d)
                .map((r) => (
                  <li key={r.id} className="flex justify-between gap-2">
                    <span>{EX[r.exercise_key]?.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {r.sets}×{r.rep_min}–{r.rep_max}
                      {r.load_kg != null
                        ? ` @ ${fmtWeight(returningLoad(Number(r.load_kg), next.returnFactor, EX[r.exercise_key]?.increment_kg ?? 2.5), U)}`
                        : ""}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function Workout({
  session,
  rxs,
  equipment,
}: {
  session: { id: string; recovery_state: string; started_at: string };
  rxs: Rx[];
  equipment: Equipment;
}) {
  const U = unitsOf(useProfile().data);
  const qc = useQueryClient();
  const log = useServerFn(logWorkoutSet);
  const finish = useServerFn(finishWorkout);
  const swap = useServerFn(substituteExercise);
  const { data: sets = [] } = useQuery({
    queryKey: ["session-sets", session.id],
    queryFn: async () =>
      rows(
        await supabase
          .from("workout_sets")
          .select("*")
          .eq("session_id", session.id)
          .order("created_at"),
      ),
  });
  const [inputs, setInputs] = useState<Record<string, { w: string; r: string; rir: string }>>({});
  const [restEnd, setRestEnd] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [swapFor, setSwapFor] = useState<Rx | null>(null);
  const [stopOpen, setStopOpen] = useState(false);
  useEffect(() => {
    if (!restEnd) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [restEnd]);
  const left = restEnd ? Math.max(0, Math.round((restEnd - now) / 1000)) : 0;

  async function addSet(rx: Rx) {
    const v = inputs[rx.id] ?? {
      w: rx.load_kg != null ? String(kgToDisplay(Number(rx.load_kg), U)) : "",
      r: "",
      rir: "",
    };
    const w = v.w ? displayToKg(Number(v.w), U) : Number(rx.load_kg || 0);
    if (!v.r) {
      toast.error("Enter your reps");
      return;
    }
    try {
      const payload = {
        sessionId: session.id,
        prescriptionId: rx.id,
        weightKg: w,
        reps: Number(v.r),
        rir: v.rir === "" ? null : Number(v.rir),
      };
      const id = newOpId();
      const r = await sendOrQueue("set", payload, id, () =>
        log({ data: { ...payload, clientOpId: id, clientRecordedAt: new Date().toISOString() } }),
      );
      setInputs({ ...inputs, [rx.id]: { w: String(w), r: "", rir: "" } });
      if (r.queued)
        toast.message("You're offline. Set saved on this device and will sync when you reconnect.");
      setRestEnd(Date.now() + (r.queued ? rx.rest_sec : r.result.restSec) * 1000);
      setNow(Date.now());
      qc.invalidateQueries({ queryKey: ["session-sets", session.id] });
      qc.invalidateQueries({ queryKey: ["rx"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function end(outcome: "completed" | "safety_stopped", note?: string) {
    try {
      const r = await finish({ data: { sessionId: session.id, outcome, note } });
      if (outcome === "safety_stopped")
        toast.message(
          "Workout stopped. If you have chest pain, fainting or severe breathlessness, call 999 now.",
        );
      else if (r.changes.length) r.changes.forEach((c) => toast.success(`${c.exercise}: ${c.why}`));
      else toast.success("Workout saved. No prescription changes yet.");
      qc.invalidateQueries();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-execute">
        Workout in progress · recovery {session.recovery_state}
      </p>
      <h1 className="mt-1 text-3xl font-semibold">Log your sets</h1>
      {restEnd && left > 0 && (
        <div className="sticky top-2 z-10 mt-4 flex items-center justify-between rounded-[14px] border border-execute bg-card p-3 text-sm">
          <span className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-execute" /> Rest
          </span>
          <span className="font-display text-xl tabular-nums">
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setRestEnd(null)}>
            Skip
          </Button>
        </div>
      )}
      <div className="mt-6 space-y-4">
        {rxs.map((rx) => {
          const ex = EX[rx.exercise_key]!;
          const done = sets.filter((s) => s.prescription_id === rx.id);
          const v = inputs[rx.id] ?? {
            w: rx.load_kg != null ? String(kgToDisplay(Number(rx.load_kg), U)) : "",
            r: "",
            rir: "",
          };
          return (
            <section key={rx.id} className="rounded-[20px] border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{ex.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {rx.sets} sets × {rx.rep_min}–{rx.rep_max} reps · {rx.rir_target} in reserve ·
                    rest {Math.round((rx.rest_sec / 60) * 10) / 10} min
                    {rx.load_kg != null
                      ? ` · ${fmtWeight(Number(rx.load_kg), U)}`
                      : ex.loaded
                        ? " · pick a load you can do for the top of the range"
                        : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSwapFor(rx)}
                  aria-label="Swap exercise"
                >
                  <Repeat2 className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Targets {ex.primary_muscles.join(", ")} · {ex.execution_cues[0]}
              </p>
              <div className="mt-2">
                <ExerciseDemoButton exerciseKey={rx.exercise_key} name={ex.name} />
              </div>
              <details className="mt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer">Technique</summary>
                <ul className="mt-1 list-disc pl-4">
                  {[...ex.setup_steps, ...ex.execution_cues].map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <p className="mt-1">Avoid: {ex.common_errors.join("; ")}</p>
              </details>
              {done.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm tabular-nums">
                  {done.map((s) => (
                    <li key={s.id} className="text-muted-foreground">
                      Set {s.set_number}: {fmtWeight(Number(s.weight_kg), U)} × {s.reps}
                      {s.rir != null ? ` · ${Number(s.rir)} RIR` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 grid grid-cols-4 gap-2">
                <Input
                  type="number"
                  step="0.5"
                  placeholder={weightUnit(U)}
                  aria-label={`Weight (${weightUnit(U)})`}
                  value={v.w}
                  onChange={(e) => setInputs({ ...inputs, [rx.id]: { ...v, w: e.target.value } })}
                  disabled={!ex.loaded && rx.exercise_key !== "split_squat"}
                />
                <Input
                  type="number"
                  placeholder={rx.exercise_key === "plank" ? "secs" : "reps"}
                  value={v.r}
                  onChange={(e) => setInputs({ ...inputs, [rx.id]: { ...v, r: e.target.value } })}
                />
                <Input
                  type="number"
                  min={0}
                  max={6}
                  placeholder="RIR"
                  value={v.rir}
                  onChange={(e) => setInputs({ ...inputs, [rx.id]: { ...v, rir: e.target.value } })}
                />
                <Button onClick={() => addSet(rx)} className="rounded-[10px]">
                  Log set {done.length + 1}
                </Button>
              </div>
            </section>
          );
        })}
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          className="rounded-[10px] bg-execute text-execute-foreground hover:bg-execute/90"
          onClick={() => end("completed")}
        >
          Finish workout
        </Button>
        <Button
          variant="outline"
          className="rounded-[10px] text-destructive"
          onClick={() => setStopOpen(true)}
        >
          <ShieldAlert className="h-4 w-4" /> Stop: pain or symptoms
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        RIR = reps in reserve: how many more good reps you could have done.
      </p>
      <Dialog open={!!swapFor} onOpenChange={(o) => !o && setSwapFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Swap {swapFor ? EX[swapFor.exercise_key]?.name : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {swapFor &&
              substitutes(swapFor.exercise_key, equipment).map((s) => (
                <button
                  key={s.key}
                  className="w-full rounded-[10px] border border-border bg-raised p-3 text-left text-sm"
                  onClick={async () => {
                    try {
                      await swap({ data: { prescriptionId: swapFor.id, exerciseKey: s.key } });
                      setSwapFor(null);
                      qc.invalidateQueries({ queryKey: ["rx"] });
                      toast.success(`Swapped to ${s.name}`);
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  {s.name}
                  <span className="block text-xs text-muted-foreground">
                    {s.primary_muscles.join(", ")}
                  </span>
                </button>
              ))}
            {swapFor && !substitutes(swapFor.exercise_key, equipment).length && (
              <p className="text-sm text-muted-foreground">No matching swap for your equipment.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={stopOpen} onOpenChange={setStopOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop this workout</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            Stop now. If you have chest pain, fainting, severe breathlessness or sudden severe pain,
            call 999 or go to A&E. Plexecute can't diagnose the cause.
          </p>
          <div className="flex gap-2">
            {[
              "Sharp or new pain",
              "Dizzy or faint",
              "Chest pain or breathing",
              "Other symptom",
            ].map((r) => (
              <Button
                key={r}
                size="sm"
                variant="outline"
                onClick={() => {
                  setStopOpen(false);
                  end("safety_stopped", r);
                }}
              >
                {r}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function History() {
  const U = unitsOf(useProfile().data);
  const { data: sets = [] } = useQuery({
    queryKey: ["sets"],
    queryFn: async () =>
      rows(
        await supabase
          .from("workout_sets")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(500),
      ),
  });
  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions"],
    queryFn: async () =>
      rows(
        await supabase
          .from("workout_sessions")
          .select("*")
          .neq("status", "in_progress")
          .order("started_at", { ascending: false })
          .limit(20),
      ),
  });
  const { data: events = [] } = useQuery({
    queryKey: ["progression"],
    queryFn: async () =>
      rows(
        await supabase
          .from("progression_events")
          .select("*, programme_prescriptions(exercise_key)")
          .order("created_at", { ascending: false })
          .limit(20),
      ),
  });
  const prs = useMemo(() => {
    const m = new Map<string, { e1rm: number; w: number; r: number }>();
    for (const s of sets) {
      const ex = Object.values(EX).find((x) => x.name === s.exercise);
      const v = estimate1RM(Number(s.weight_kg), s.reps, ex?.loaded ?? Number(s.weight_kg) > 0);
      if (v != null && v > (m.get(s.exercise)?.e1rm ?? 0))
        m.set(s.exercise, { e1rm: v, w: Number(s.weight_kg), r: s.reps });
    }
    return [...m.entries()];
  }, [sets]);
  return (
    <div className="mt-10 grid gap-6 md:grid-cols-2">
      <section>
        <h2 className="text-lg font-semibold">Personal records</h2>
        {prs.length ? (
          <ul className="mt-3 space-y-1.5 text-sm">
            {prs.map(([n, p]) => (
              <li key={n} className="flex justify-between">
                <span>{n}</span>
                <span className="tabular-nums text-muted-foreground">
                  {fmtWeight(p.w, U)} × {p.r} · est. 1RM {fmtWeight(p.e1rm, U)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Log loaded sets of 1 to 10 reps to see estimated records.
          </p>
        )}
      </section>
      <section>
        <h2 className="text-lg font-semibold">Why your programme changed</h2>
        {events.length ? (
          <ul className="mt-3 space-y-2 text-sm">
            {events.map((e) => {
              const nx = e.next as Record<string, unknown>;
              const pr = e.prior as Record<string, unknown>;
              const ev = e.evidence as Record<string, unknown>;
              const key =
                (e.programme_prescriptions as { exercise_key: string } | null)?.exercise_key ?? "";
              return (
                <li key={e.id} className="rounded-[10px] border border-border bg-card p-3">
                  <span className="font-medium">{EX[key]?.name ?? key}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleDateString()} · {e.rule.replace(/_/g, " ")}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {pr["load_kg"] != null || nx["load_kg"] != null
                      ? `${pr["load_kg"] != null ? fmtWeight(Number(pr["load_kg"]), U) : "none"} → ${nx["load_kg"] != null ? fmtWeight(Number(nx["load_kg"]), U) : "none"}. `
                      : ""}
                    {String(ev["why"] ?? "")}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No automatic changes yet. Progression needs two comparable sessions.
          </p>
        )}
      </section>
      <section className="md:col-span-2">
        <h2 className="text-lg font-semibold">Workout history</h2>
        {sessions.length ? (
          <ul className="mt-3 space-y-1.5 text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex justify-between">
                <span>
                  {new Date(s.started_at).toLocaleDateString([], {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}{" "}
                  · Day {(s.day_index ?? 0) + 1}
                </span>
                <span
                  className={
                    s.status === "safety_stopped" ? "text-destructive" : "text-muted-foreground"
                  }
                >
                  {s.status.replace("_", " ")} · {sets.filter((x) => x.session_id === s.id).length}{" "}
                  sets
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No workouts yet.</p>
        )}
      </section>
    </div>
  );
}
