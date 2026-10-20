import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { logWellness } from "@/lib/wellness.functions";

type Phase = { label: "Breathe in" | "Hold" | "Breathe out"; secs: number };
/** Timed patterns. Holds are optional and short; "calm" and "slow" have none. */
export const PATTERNS: { key: string; label: string; blurb: string; phases: Phase[] }[] = [
  {
    key: "relax",
    label: "Relaxation breathing",
    blurb: "In for 4, out for 6. A longer out-breath helps you settle.",
    phases: [
      { label: "Breathe in", secs: 4 },
      { label: "Breathe out", secs: 6 },
    ],
  },
  {
    key: "box",
    label: "Box breathing",
    blurb: "4 in, 4 hold, 4 out, 4 hold. Skip the holds if they feel uncomfortable.",
    phases: [
      { label: "Breathe in", secs: 4 },
      { label: "Hold", secs: 4 },
      { label: "Breathe out", secs: 4 },
      { label: "Hold", secs: 4 },
    ],
  },
  {
    key: "slow",
    label: "Slow breathing",
    blurb: "About 6 breaths a minute: 5 in, 5 out.",
    phases: [
      { label: "Breathe in", secs: 5 },
      { label: "Breathe out", secs: 5 },
    ],
  },
  {
    key: "focus",
    label: "Focus breathing",
    blurb: "Even 4 in, 4 out to steady attention before work.",
    phases: [
      { label: "Breathe in", secs: 4 },
      { label: "Breathe out", secs: 4 },
    ],
  },
  {
    key: "sleep",
    label: "Pre-sleep breathing",
    blurb: "In for 4, gentle pause, long out for 8.",
    phases: [
      { label: "Breathe in", secs: 4 },
      { label: "Hold", secs: 2 },
      { label: "Breathe out", secs: 8 },
    ],
  },
  {
    key: "calm",
    label: "Calm-down breathing",
    blurb: "In through the nose, slow sigh out through the mouth.",
    phases: [
      { label: "Breathe in", secs: 3 },
      { label: "Breathe out", secs: 7 },
    ],
  },
];
const MINUTES = [2, 3, 5, 10];
const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm ${on ? "border-execute bg-execute/15 text-execute" : "border-border text-muted-foreground hover:bg-raised"}`;

export function BreathingPanel() {
  const qc = useQueryClient();
  const log = useServerFn(logWellness);
  const [pattern, setPattern] = useState(PATTERNS[0]!);
  const [minutes, setMinutes] = useState(5);
  const [left, setLeft] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [saved, setSaved] = useState(false);
  const clientId = useRef(crypto.randomUUID());
  const cycle = pattern.phases.reduce((a, p) => a + p.secs, 0);
  useEffect(() => {
    if (left == null || left <= 0) return;
    const t = setTimeout(() => {
      setLeft((l) => (l ?? 1) - 1);
      setTick((x) => x + 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [left]);
  let at = tick % cycle;
  let phase = pattern.phases[0]!;
  for (const p of pattern.phases) {
    if (at < p.secs) {
      phase = p;
      break;
    }
    at -= p.secs;
  }
  const running = left != null && left > 0;
  async function finish(done: number) {
    try {
      await log({
        data: {
          type: "breath",
          plannedMinutes: minutes,
          actualMinutes: Math.max(1, Math.round(done / 60)),
          state: done >= minutes * 60 ? "completed" : "partial",
          calmBefore: null,
          calmAfter: null,
          useful: null,
          note: pattern.label,
          focus: pattern.key,
          blockId: null,
          clientId: clientId.current,
        } as never,
      });
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["wellness-history"] });
      toast.success("Breathing session saved");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  useEffect(() => {
    if (left === 0 && !saved) void finish(minutes * 60);
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="rounded-2xl border border-border bg-surface p-5" aria-label="Breathing">
      <h2 className="text-xl font-semibold">Breathing</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {PATTERNS.map((p) => (
          <button
            key={p.key}
            className={chip(p.key === pattern.key)}
            disabled={running}
            onClick={() => setPattern(p)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{pattern.blurb}</p>
      <div className="mt-3 flex gap-2">
        {MINUTES.map((m) => (
          <button
            key={m}
            className={chip(m === minutes)}
            disabled={running}
            onClick={() => setMinutes(m)}
          >
            {m} min
          </button>
        ))}
      </div>
      <div className="mt-5 flex flex-col items-center" aria-live="polite">
        <div
          className="flex h-40 w-40 items-center justify-center rounded-full border-2 border-execute bg-execute/10 transition-transform duration-1000 ease-in-out"
          style={{
            transform: `scale(${running ? (phase.label === "Breathe in" ? 1.15 : phase.label === "Breathe out" ? 0.85 : 1) : 1})`,
          }}
          data-testid="breath-pacer"
        >
          <span className="text-center text-lg font-medium">
            {running ? phase.label : saved ? "Done" : "Ready"}
          </span>
        </div>
        {left != null && (
          <p className="mt-3 tabular-nums text-muted-foreground">
            {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left
          </p>
        )}
      </div>
      <div className="mt-4 flex justify-center gap-2">
        {!running && !saved && (
          <Button
            onClick={() => {
              setTick(0);
              setLeft(minutes * 60);
            }}
          >
            Start {minutes}-minute session
          </Button>
        )}
        {running && (
          <Button
            variant="outline"
            onClick={() => {
              const done = minutes * 60 - (left ?? 0);
              setLeft(null);
              void finish(done);
            }}
          >
            Finish now
          </Button>
        )}
        {saved && (
          <Button
            variant="outline"
            onClick={() => {
              setSaved(false);
              setLeft(null);
              clientId.current = crypto.randomUUID();
            }}
          >
            Another session
          </Button>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Breathe gently and comfortably. Stop if you feel dizzy or light-headed, and skip holds if
        you are pregnant or have a heart or lung condition. This is general wellbeing guidance, not
        treatment.
      </p>
    </section>
  );
}
