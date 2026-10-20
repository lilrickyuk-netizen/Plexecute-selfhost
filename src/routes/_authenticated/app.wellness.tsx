import { Heart } from "lucide-react";
import { FeatureHeader } from "@/components/FeatureHeader";
import wellnessImage from "@/assets/member-wellness.jpg";
import { zonedParts } from "@/lib/tz";
import { useProfile } from "@/lib/data";
import { createFileRoute, Link } from "@tanstack/react-router";
import { VoiceInputButton, WithVoice } from "@/components/VoiceInputButton";
import { appendTranscript } from "@/lib/voice-input";
import { rows } from "@/lib/rows";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getWellness, logWellness, saveWellnessPrefs } from "@/lib/wellness.functions";
import { SESSION_TYPES, type SessionType } from "@/lib/wellness";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { GuidedPractice } from "@/components/GuidedPractice";
import { MovementPanel } from "@/components/MovementPanel";
import { BreathingPanel } from "@/components/BreathingPanel";

type WSection = "yoga" | "mobility" | "recovery" | "meditation" | "breathing";
const WSECTIONS: { key: WSection; label: string; blurb: string }[] = [
  { key: "yoga", label: "Yoga", blurb: "Flows for body and day" },
  { key: "mobility", label: "Mobility", blurb: "Joints and range" },
  { key: "recovery", label: "Recovery", blurb: "Stretching and cool-down" },
  { key: "meditation", label: "Meditation", blurb: "Guided sessions" },
  { key: "breathing", label: "Breathing", blurb: "Timed patterns" },
];
const MOBILITY_FOCUS = [
  "mobility",
  "full_body",
  "upper_body",
  "lower_body",
  "back",
  "neck_shoulders",
  "hips",
  "legs",
  "desk",
];
const RECOVERY_FOCUS = [
  "stretching",
  "recovery",
  "post_workout",
  "flexibility",
  "lower_body",
  "upper_body",
  "back",
  "hips",
  "legs",
  "desk",
  "morning",
  "evening",
];

export const Route = createFileRoute("/_authenticated/app/wellness")({
  validateSearch: z.object({
    block: z.string().uuid().optional(),
    activity: z.enum(["yoga", "meditation"]).optional(),
    focus: z.string().max(40).optional(),
    minutes: z.coerce.number().int().min(1).max(90).optional(),
    section: z.enum(["yoga", "mobility", "recovery", "meditation", "breathing"]).optional(),
  }),
  head: () => ({
    meta: [
      { title: "Wellness & Movement: yoga, mobility, meditation · Plexecute" },
      {
        name: "description",
        content:
          "Guided yoga and meditation videos, breathing and wind-down sessions scheduled into your week.",
      },
      {
        property: "og:title",
        content: "Wellness & Movement: yoga, mobility, meditation · Plexecute",
      },
      {
        property: "og:description",
        content:
          "Guided yoga and meditation videos, breathing and wind-down sessions scheduled into your week.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Wellness,
});

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm ${on ? "border-execute bg-execute/15 text-execute" : "border-border text-muted-foreground hover:bg-raised"}`;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
type Prefs = {
  enabled: boolean;
  session_types: SessionType[];
  experience: "beginner" | "some" | "experienced";
  min_minutes: number;
  max_minutes: number;
  preferred_time: "morning" | "midday" | "evening" | "any";
  guidance: "text" | "audio" | "timer";
  sessions_per_week: number;
  reminders: boolean;
  allow_auto_move: boolean;
};

function Scale({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mt-3">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1 flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={chip(value === n)} onClick={() => onChange(n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function Wellness() {
  const { block, activity, focus, minutes, section: sectionParam } = Route.useSearch();
  const nav = Route.useNavigate();
  const section: WSection =
    sectionParam ??
    (activity === "meditation" ? "meditation" : activity === "yoga" ? "yoga" : "yoga");
  const qc = useQueryClient();
  const get = useServerFn(getWellness);
  const save = useServerFn(saveWellnessPrefs);
  const log = useServerFn(logWellness);
  const [override, setOverride] = useState<SessionType | null>(null);
  const profileTz = useProfile().data?.timezone ?? null;
  const { data } = useQuery({
    queryKey: ["wellness", override],
    queryFn: () => get({ data: { hour: zonedParts(new Date(), profileTz).h, override } }),
  });
  const { data: history = [] } = useQuery({
    queryKey: ["wellness-history"],
    queryFn: async () =>
      rows(
        await supabase
          .from("wellness_sessions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(20),
      ),
  });
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  useEffect(() => {
    if (data && !prefs) setPrefs(data.prefs as Prefs);
  }, [data, prefs]);

  // Player
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [started, setStarted] = useState(false);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const session = data?.session;
  const total = (session?.minutes ?? 0) * 60;
  useEffect(() => {
    if (!running) return;
    tick.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      if (tick.current) clearInterval(tick.current);
    };
  }, [running]);
  useEffect(() => {
    if (running && elapsed >= total && total > 0) {
      setRunning(false);
      toast.success("Session complete");
    }
  }, [elapsed, total, running]);
  let acc = 0;
  let stepIdx = 0;
  session?.steps.forEach((s, i) => {
    if (elapsed >= acc) stepIdx = i;
    acc += s.seconds;
  });
  const step = session?.steps[stepIdx];
  const guidance = prefs?.guidance ?? "text";
  useEffect(() => {
    if (
      !running ||
      guidance !== "audio" ||
      !step ||
      typeof window === "undefined" ||
      !("speechSynthesis" in window)
    )
      return;
    const u = new SpeechSynthesisUtterance(step.text);
    u.rate = 0.85;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }, [stepIdx, running, guidance, step]);

  const [fb, setFb] = useState<{
    before: number | null;
    after: number | null;
    useful: number | null;
    note: string;
  }>({ before: null, after: null, useful: null, note: "" });
  const [safety, setSafety] = useState(false);
  const [busy, setBusy] = useState(false);

  async function finish(state: "completed" | "partial" | "stopped") {
    if (!session) return;
    setBusy(true);
    setRunning(false);
    if (typeof window !== "undefined" && "speechSynthesis" in window)
      window.speechSynthesis.cancel();
    try {
      const actual =
        state === "completed"
          ? Math.max(session.minutes, Math.round(elapsed / 60))
          : Math.round(elapsed / 60);
      const r = await log({
        data: {
          type: session.type,
          plannedMinutes: session.minutes,
          actualMinutes: actual,
          state,
          calmBefore: fb.before,
          calmAfter: fb.after,
          useful: fb.useful,
          note: fb.note.trim() || null,
          blockId: block ?? null,
        },
      });
      setSafety(r.safety);
      toast.success("Session saved");
      setElapsed(0);
      setStarted(false);
      setFb({ before: null, after: null, useful: null, note: "" });
      qc.invalidateQueries({ queryKey: ["wellness"] });
      qc.invalidateQueries({ queryKey: ["wellness-history"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function savePrefs() {
    if (!prefs) return;
    setBusy(true);
    try {
      await save({ data: prefs });
      toast.success(
        prefs.enabled
          ? "Saved. Use Replan on your Plan to fit sessions into your week."
          : "Wellness sessions paused",
      );
      qc.invalidateQueries({ queryKey: ["wellness"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="member-training-cover">
        <img
          src={wellnessImage}
          width={1536}
          height={1024}
          alt="Gentle stretching on a yoga mat in a naturally lit studio"
        />
      </div>
      <FeatureHeader
        title="Wellness & Movement"
        icon={Heart}
        description="Short guided sessions that fit around your day. These support calm and focus; they are not a medical or mental-health treatment."
      />

      {safety && (
        <div className="mt-5 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm">
          <p className="font-medium">It sounds like this was hard.</p>
          <p className="mt-1">
            Please stop the session. If you are in danger or thinking about harming yourself, call
            999 or go to A&E. You can also call Samaritans free on 116 123, any time. For urgent
            health advice, call NHS 111. See{" "}
            <Link to="/safety" className="underline">
              Safety
            </Link>
            .
          </p>
        </div>
      )}

      <div className="member-segments" role="tablist" aria-label="Wellness and movement type">
        {WSECTIONS.map((x) => (
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

      {block && <GuidedPractice key={`b-${block}`} blockId={block} />}
      {!block && section === "yoga" && (
        <GuidedPractice
          key={`y-${focus}-${minutes}`}
          lock
          initial={{ activity: "yoga", focus, minutes }}
        />
      )}
      {!block && section === "mobility" && (
        <>
          <div className="mt-6">
            <MovementPanel mode="mobility" />
          </div>
          <GuidedPractice
            key="m"
            lock
            focusKeys={MOBILITY_FOCUS}
            title="Mobility follow-along videos"
            initial={{ activity: "yoga" }}
          />
        </>
      )}
      {!block && section === "recovery" && (
        <>
          <div className="mt-6">
            <MovementPanel mode="mobility" initialIntent="flexibility" />
          </div>
          <GuidedPractice
            key="r"
            lock
            focusKeys={RECOVERY_FOCUS}
            title="Stretching and recovery videos"
            initial={{ activity: "yoga" }}
          />
        </>
      )}
      {!block && section === "meditation" && (
        <GuidedPractice
          key={`d-${focus}-${minutes}`}
          lock
          initial={{ activity: "meditation", focus, minutes }}
        />
      )}
      {!block && section === "breathing" && (
        <>
          <div className="mt-6">
            <BreathingPanel />
          </div>
          <GuidedPractice
            key="br"
            lock
            focusKeys={["breathing", "relaxation", "stress", "sleep", "reset"]}
            title="Guided breathing videos"
            initial={{ activity: "meditation" }}
          />
        </>
      )}

      {(section === "meditation" || !!block) && (
        <>
          {data && session && (
            <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <div className="text-xs uppercase tracking-wide text-execute">
                Recommended now{block ? " · from your plan" : ""}
              </div>
              <h2 className="mt-1 text-xl font-semibold">
                {SESSION_TYPES[session.type].label} · {session.minutes} min
              </h2>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                {data.recommendation.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(Object.keys(SESSION_TYPES) as SessionType[]).map((t) => (
                  <button
                    key={t}
                    disabled={started}
                    className={chip(session.type === t)}
                    onClick={() => setOverride(t)}
                  >
                    {SESSION_TYPES[t].label}
                  </button>
                ))}
              </div>

              {!started ? (
                <>
                  <Scale
                    label="Optional: how calm do you feel right now? (1 = not at all, 5 = very)"
                    value={fb.before}
                    onChange={(v) => setFb({ ...fb, before: v })}
                  />
                  <Button
                    className="mt-4"
                    onClick={() => {
                      setStarted(true);
                      setRunning(true);
                    }}
                  >
                    Start session
                  </Button>
                </>
              ) : (
                <div className="mt-5">
                  <div className="h-2 overflow-hidden rounded-full bg-raised">
                    <div
                      className="h-full bg-execute transition-all"
                      style={{ width: `${Math.min(100, (elapsed / total) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {fmt(elapsed)} / {fmt(total)}
                  </div>
                  <p className="mt-4 min-h-16 text-lg leading-relaxed">
                    {guidance === "timer" ? "Timer running. Practise in your own way." : step?.text}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setRunning(!running)}>
                      {running ? "Pause" : "Resume"}
                    </Button>
                    <Button variant="outline" disabled={busy} onClick={() => finish("stopped")}>
                      Stop
                    </Button>
                  </div>
                  {elapsed >= total && (
                    <p className="mt-3 text-execute">Well done. Finish below.</p>
                  )}
                  <Scale
                    label="Optional: how calm do you feel now?"
                    value={fb.after}
                    onChange={(v) => setFb({ ...fb, after: v })}
                  />
                  <Scale
                    label="Optional: how useful was this session?"
                    value={fb.useful}
                    onChange={(v) => setFb({ ...fb, useful: v })}
                  />
                  <WithVoice
                    value={fb.note}
                    onChange={(v) => setFb({ ...fb, note: v.slice(0, 500) })}
                  >
                    <Textarea
                      className="mt-3"
                      placeholder="Optional note"
                      value={fb.note}
                      onChange={(e) => setFb({ ...fb, note: e.target.value })}
                      maxLength={500}
                    />
                  </WithVoice>
                  <div className="mt-3 flex gap-2">
                    <Button
                      disabled={busy}
                      onClick={() => finish(elapsed >= total ? "completed" : "partial")}
                    >
                      {elapsed >= total ? "Finish & save" : "Save as partly done"}
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}

          {prefs && (
            <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <h2 className="text-lg font-semibold">Your wellness settings</h2>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs.enabled}
                  onChange={(e) => setPrefs({ ...prefs, enabled: e.target.checked })}
                />{" "}
                Schedule wellness sessions in my plan
              </label>
              <div className="mt-4 text-sm text-muted-foreground">Session types</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(Object.keys(SESSION_TYPES) as SessionType[]).map((t) => {
                  const on = prefs.session_types.includes(t);
                  return (
                    <button
                      key={t}
                      className={chip(on)}
                      onClick={() =>
                        setPrefs({
                          ...prefs,
                          session_types: on
                            ? prefs.session_types.filter((x) => x !== t)
                            : [...prefs.session_types, t],
                        })
                      }
                    >
                      {SESSION_TYPES[t].label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 text-sm text-muted-foreground">Experience</div>
              <div className="mt-1 flex gap-1.5">
                {(["beginner", "some", "experienced"] as const).map((x) => (
                  <button
                    key={x}
                    className={chip(prefs.experience === x)}
                    onClick={() => setPrefs({ ...prefs, experience: x })}
                  >
                    {x === "some" ? "Some" : x[0]!.toUpperCase() + x.slice(1)}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <label>
                  Shortest (min)
                  <input
                    type="number"
                    min={2}
                    max={60}
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5"
                    value={prefs.min_minutes}
                    onChange={(e) => setPrefs({ ...prefs, min_minutes: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Longest (min)
                  <input
                    type="number"
                    min={2}
                    max={90}
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5"
                    value={prefs.max_minutes}
                    onChange={(e) => setPrefs({ ...prefs, max_minutes: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Per week
                  <input
                    type="number"
                    min={1}
                    max={14}
                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5"
                    value={prefs.sessions_per_week}
                    onChange={(e) =>
                      setPrefs({ ...prefs, sessions_per_week: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <div className="mt-4 text-sm text-muted-foreground">Preferred time</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(["morning", "midday", "evening", "any"] as const).map((x) => (
                  <button
                    key={x}
                    className={chip(prefs.preferred_time === x)}
                    onClick={() => setPrefs({ ...prefs, preferred_time: x })}
                  >
                    {x[0]!.toUpperCase() + x.slice(1)}
                  </button>
                ))}
              </div>
              <div className="mt-4 text-sm text-muted-foreground">Guidance</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(
                  [
                    ["text", "Text"],
                    ["audio", "Spoken (device voice)"],
                    ["timer", "Timer only"],
                  ] as const
                ).map(([x, l]) => (
                  <button
                    key={x}
                    className={chip(prefs.guidance === x)}
                    onClick={() => setPrefs({ ...prefs, guidance: x })}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs.reminders}
                  onChange={(e) => setPrefs({ ...prefs, reminders: e.target.checked })}
                />{" "}
                Remind me when a session is due
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={prefs.allow_auto_move}
                  onChange={(e) => setPrefs({ ...prefs, allow_auto_move: e.target.checked })}
                />{" "}
                Sessions may be moved or shortened when my day changes
              </label>
              <Button className="mt-4" disabled={busy} onClick={savePrefs}>
                Save settings
              </Button>
            </section>
          )}
        </>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-semibold">History</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No sessions yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-2xl border border-border bg-surface">
            {history.map((h) => (
              <li key={h.id} className="flex justify-between px-4 py-3 text-sm">
                <span>
                  {SESSION_TYPES[h.session_type as SessionType]?.label ?? h.session_type} ·{" "}
                  {h.actual_minutes}/{h.planned_minutes} min
                </span>
                <span className="text-muted-foreground">
                  {h.completion_state === "completed"
                    ? "Done"
                    : h.completion_state === "partial"
                      ? "Partly done"
                      : "Stopped"}{" "}
                  · {new Date(h.created_at).toLocaleDateString("en-GB")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Calm and usefulness ratings only help choose future sessions. They are not a clinical
          score.
        </p>
      </section>
    </div>
  );
}
