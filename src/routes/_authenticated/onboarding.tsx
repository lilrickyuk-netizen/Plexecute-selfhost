import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { seedStarterPathways } from "@/lib/starter-pathways.functions";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/lib/data";
import { writeCache } from "@/lib/offline";
import { buildWeekPlan, DOMAINS, feasibility, startOfWeek } from "@/lib/scheduler";
import { approveWeekPlan, proposeWeekPlan } from "@/lib/planning.functions";
import { recordOnboardingConsents } from "@/lib/consent.functions";
import { extractIntake } from "@/lib/intake.functions";
import {
  applyDefaults,
  commitmentsForPlan,
  COMMIT_KINDS,
  dayList,
  EMPTY_DRAFT,
  FITNESS,
  goalsForPlan,
  missingQuestions,
  needsVisionQuestion,
  VISION_AREAS,
  VISION_HELP,
  VISION_QUESTION,
  allDay,
  type IntakeCommitment,
  type IntakeDraft,
  type IntakeGoal,
  type Question,
} from "@/lib/intake";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { appendTranscript } from "@/lib/voice-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OnboardingQuestionnaire } from "@/components/OnboardingQuestionnaire";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Get started · Plexecute" },
      { name: "robots", content: "noindex" },
      {
        name: "description",
        content:
          "Set your life priorities and turn your first goal into an executable Plexecute plan.",
      },
      { property: "og:title", content: "Get started · Plexecute" },
      {
        property: "og:description",
        content:
          "Set your life priorities and turn your first goal into an executable Plexecute plan.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Onboarding,
});

const STAGES = ["Basics", "Questions", "Check", "Your plan"] as const;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIMEZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Australia/Sydney",
  "Asia/Dubai",
  "Asia/Singapore",
  "UTC",
];
const OPENING =
  "Tell me about the goal you want to work on and the life your plan needs to fit — your work, study, family, responsibilities, interests and ambitions.";

type Msg = { role: "member" | "plexecute"; text: string };

function Onboarding() {
  const { data: profile } = useProfile();
  const navigate = useNavigate();
  const propose = useServerFn(proposeWeekPlan);
  const seedStarters = useServerFn(seedStarterPathways);
  const approve = useServerFn(approveWeekPlan);
  const consentFn = useServerFn(recordOnboardingConsents);
  const extract = useServerFn(extractIntake);
  const qc = useQueryClient();
  const browserTz =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "Europe/London";
  const us = /^(America|US)\//.test(browserTz || "");

  const [stage, setStage] = useState(0);
  const [id, setId] = useState({
    display_name: "",
    timezone: browserTz || "Europe/London",
    units: us ? "imperial" : "metric",
    billing_country: us ? "US" : "GB",
  });
  const [ack, setAck] = useState({ adult: false, terms: false });
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "plexecute", text: OPENING }]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState<IntakeDraft | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [saving, setSaving] = useState(false);
  const [interactions, setInteractions] = useState(0);
  const [visionAskedState, setVisionAsked] = useState(false);
  const visionAsked = visionAskedState;
  const endRef = useRef<HTMLDivElement>(null);
  // Scroll only the conversation, never the page or its answer controls.
  useEffect(() => {
    const conversation = endRef.current?.parentElement;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [msgs.length]);

  const d = draft ?? EMPTY_DRAFT;
  const goals = goalsForPlan(d);
  const commits = commitmentsForPlan(d);
  const sched = {
    wake_time: d.wake_time ?? "07:00",
    sleep_time: d.sleep_time ?? "23:00",
    work_start: d.work?.start ?? "09:00",
    work_end: d.work?.end ?? "17:30",
    work_days: d.work?.days ?? [],
    timezone: id.timezone,
    commitments: commits,
  };
  const preview = useMemo(
    () =>
      buildWeekPlan(sched, goals, startOfWeek(new Date(), id.timezone), { notBefore: new Date() }),
    [JSON.stringify(sched), JSON.stringify(goals)],
  );
  const feas = feasibility(preview);
  const liveQuestions = draft ? missingQuestions(draft) : [];

  async function send(text: string, base: Msg[] = msgs, askedNow?: boolean, visionUnsure = false) {
    const t = text.trim();
    if (!t || thinking) return;
    // The questionnaire answers the 5-year question in the same submit, before state updates land.
    const visionAsked = askedNow ?? visionAskedState;
    setInteractions((n) => n + 1);
    const next = [...base, { role: "member" as const, text: t }];
    setMsgs(next);
    setInput("");
    setThinking(true);
    try {
      const r = await extract({ data: { current: draft, messages: next.slice(-20) } });
      if (r.safety) {
        setMsgs([...next, { role: "plexecute", text: r.safety }]);
        return;
      }
      // The member's reply to the 5-year question counts as answered even if nothing structured came out.
      const got =
        r.draft && visionUnsure
          ? {
              ...r.draft,
              vision: { _confirmed: true, answered: true, summary: null, objectives: [] },
            }
          : r.draft && draft?.vision.answered && !r.draft.vision.objectives.length
            ? { ...r.draft, vision: draft.vision }
            : r.draft && visionAsked && !r.draft.vision.answered
              ? {
                  ...r.draft,
                  vision: {
                    _confirmed: true,
                    answered: true,
                    summary: /\b(don'?t know|not sure|no idea|unsure)\b/i.test(t)
                      ? null
                      : t.slice(0, 600),
                    objectives: [],
                  },
                }
              : r.draft;
      setDraft(got);
      setQuestions(r.questions);
      if (r.questions.length) {
        setMsgs([
          ...next,
          {
            role: "plexecute",
            text: `Thanks — a few things I still need:\n${r.questions.map((q) => `• ${q.text}`).join("\n")}`,
          },
        ]);
      } else if (got && needsVisionQuestion(got) && !visionAsked) {
        setVisionAsked(true);
        setMsgs([
          ...next,
          { role: "plexecute", text: `One more: ${VISION_QUESTION}\n${VISION_HELP}` },
        ]);
      } else {
        setMsgs([
          ...next,
          { role: "plexecute", text: "I've got enough to build your first plan." },
        ]);
        setStage(2);
      }
    } catch (e) {
      setMsgs([...next, { role: "plexecute", text: `${(e as Error).message}` }]);
    } finally {
      setThinking(false);
    }
  }

  async function finish() {
    if (!profile || !draft) return;
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const userId = u.user!.id;
      await consentFn({ data: { adult: true, safety: true } });
      const dob =
        (u.user!.user_metadata?.["date_of_birth"] as string | undefined) ??
        profile.date_of_birth ??
        null;
      const transcript = msgs.filter((m) => m.role === "member").map((m) => m.text);
      const { error: pe } = await supabase
        .from("profiles")
        .update({
          wake_time: sched.wake_time,
          sleep_time: sched.sleep_time,
          work_start: sched.work_start,
          work_end: sched.work_end,
          work_days: sched.work_days,
          display_name: id.display_name.trim(),
          timezone: id.timezone,
          units: id.units,
          billing_country: id.billing_country,
          enabled_domains: DOMAINS.map((x) => x.value),
          coaching_style: "direct",
          reminders_enabled: true,
          ...(draft.nutrition_goal ? { nutrition_goal: draft.nutrition_goal } : {}),
          life_audit: {
            version: 3,
            source: "conversational_intake",
            desired_future: d.priorities ?? "",
            priorities: d.priorities ?? "",
            energy: d.energy ?? "",
            biggest_blocker: d.blocker ?? "",
            study_availability: "",
            intake_transcript: transcript,
            assumed: d.assumed,
          },
          onboarded: true,
          date_of_birth: dob,
        })
        .eq("id", userId);
      if (pe) throw pe;
      // Retry-safe: a second Accept after a failure never duplicates what the first one saved.
      const [{ data: haveC }, { data: haveG }, { data: haveF }] = await Promise.all([
        supabase.from("commitments").select("title").eq("user_id", userId),
        supabase.from("goals").select("title").eq("user_id", userId),
        supabase.from("life_twin_facts").select("fact_key").eq("user_id", userId),
      ]);
      const hasC = new Set((haveC ?? []).map((x) => x.title));
      const hasG = new Set((haveG ?? []).map((x) => x.title));
      const hasF = new Set((haveF ?? []).map((x) => x.fact_key));
      const newCommits = commits.filter((c) => !hasC.has(c.title));
      if (newCommits.length) {
        const { error } = await supabase.from("commitments").insert(
          newCommits.map((c) => ({
            user_id: userId,
            title: c.title,
            kind: c.kind,
            recurrence: c.recurrence,
            days: c.days,
            on_date: c.on_date,
            start_time: c.start_time,
            end_time: c.end_time,
            is_hard: true,
          })),
        );
        if (error) throw error;
      }
      const fitnessGoal = d.goals.find((g) => FITNESS.has(g.domain));
      const facts: { domain: string; fact_key: string; fact_value: unknown }[] = [
        { domain: "identity", fact_key: "priorities", fact_value: d.priorities },
        { domain: "behaviour", fact_key: "energy_pattern", fact_value: d.energy },
        { domain: "behaviour", fact_key: "main_blocker", fact_value: d.blocker },
        {
          domain: "sleep",
          fact_key: "routine",
          fact_value: { wake: sched.wake_time, bed: sched.sleep_time },
        },
        {
          domain: "work",
          fact_key: "hours",
          fact_value: d.work ? { days: d.work.days, start: d.work.start, end: d.work.end } : null,
        },
        { domain: "health", fact_key: "health_notes", fact_value: d.health_notes },
        { domain: "learning", fact_key: "learning_goal", fact_value: d.learning_goal },
        { domain: "career", fact_key: "professional_goal", fact_value: d.professional_goal },
        { domain: "other", fact_key: "other_notes", fact_value: d.other_notes },
        {
          domain: "identity",
          fact_key: "five_year_vision",
          fact_value:
            d.vision.objectives.length || d.vision.summary
              ? { summary: d.vision.summary, objectives: d.vision.objectives }
              : null,
        },
        {
          domain: "accountability",
          fact_key: "preferences",
          fact_value: { reminders: true, email: false, calls: false },
        },
        ...(fitnessGoal
          ? [
              {
                domain: "training",
                fact_key: "state",
                fact_value: {
                  sessions_per_week: fitnessGoal.sessions_per_week,
                  injuries: d.health_notes ?? "",
                },
              },
            ]
          : []),
      ];
      const rows = facts
        .filter(
          (f, i, all) =>
            f.fact_value !== "" &&
            f.fact_value != null &&
            !hasF.has(f.fact_key) &&
            all.findIndex((x) => x.fact_key === f.fact_key) === i,
        )
        .map((f) => ({
          ...f,
          user_id: userId,
          source: "USER_ASSERTED",
          source_ref: "conversational_intake",
          confidence: 1,
          fact_value: f.fact_value as never,
        }));
      if (rows.length) {
        const { error } = await supabase.from("life_twin_facts").insert(rows);
        if (error) throw error;
      }
      const { error } = await supabase.from("goals").insert(
        goals
          .filter((g) => !hasG.has(g.title))
          .map((g) => ({
            title: g.title,
            domain: g.domain,
            weekly_minutes: g.weekly_minutes,
            session_minutes: g.session_minutes,
            preferred_time: g.preferred_time,
            deadline: g.deadline ?? null,
            why: g.why,
            user_id: userId,
          })),
      );
      if (error) throw error;
      // Prepare each goal's first steps before the week is built, so session one is executable.
      await seedStarters().catch((e) => console.error("starter pathways", e));
      const proposal = await propose({ data: { trigger: "onboarding" } });
      await approve({ data: { proposalId: proposal.id } });
      await qc.invalidateQueries();
      await qc.fetchQuery({
        queryKey: ["profile"],
        queryFn: async () => {
          const fresh = (await supabase.from("profiles").select("*").eq("id", userId).maybeSingle())
            .data;
          writeCache("profile", fresh);
          return fresh;
        },
      });
      navigate({ to: "/app/coach" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const sel = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
  const patch = (p: Partial<IntakeDraft>) => setDraft({ ...d, ...p });

  return (
    <div className="member-onboarding min-h-[100dvh] bg-background px-4 py-6 md:py-10">
      <div className="mx-auto flex max-w-xl flex-col">
        <div className="member-brand mb-6 font-display text-lg font-semibold">
          <img src="/icon-192.png" width={30} height={30} alt="" />
          <span>
            Plex<span className="text-execute">ecute</span>
          </span>
        </div>
        <div className="mb-3 flex gap-1" aria-hidden>
          {STAGES.map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full ${i <= stage ? "bg-primary" : "bg-border"}`}
            />
          ))}
        </div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Step {stage + 1} of {STAGES.length} · {STAGES[stage]}
        </p>

        {stage === 0 && (
          <div className="mt-4 space-y-4 rounded-[20px] border border-border bg-card p-5">
            <h1 className="text-2xl font-semibold">Let's build a plan that fits your real life.</h1>
            <p className="text-sm text-muted-foreground">
              Four quick basics, then a few tap-to-answer questions.
            </p>
            <Field label="What should we call you?">
              <Input
                aria-label="What should we call you?"
                value={id.display_name}
                onChange={(e) => setId({ ...id, display_name: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Country (billing currency)">
                <select
                  aria-label="Billing country"
                  className={sel}
                  value={id.billing_country}
                  onChange={(e) => setId({ ...id, billing_country: e.target.value })}
                >
                  <option value="GB">United Kingdom (£)</option>
                  <option value="US">United States ($)</option>
                </select>
              </Field>
              <Field label="Units">
                <select
                  aria-label="Units"
                  className={sel}
                  value={id.units}
                  onChange={(e) => setId({ ...id, units: e.target.value })}
                >
                  <option value="metric">Metric (kg, cm)</option>
                  <option value="imperial">Imperial (lb, ft)</option>
                </select>
              </Field>
              <div className="col-span-2">
                <Field label="Time zone">
                  <select
                    aria-label="Time zone"
                    className={sel}
                    value={id.timezone}
                    onChange={(e) => setId({ ...id, timezone: e.target.value })}
                  >
                    {[...new Set([id.timezone, ...TIMEZONES])].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
            <Check checked={ack.adult} onChange={(v) => setAck({ ...ack, adult: v })}>
              I confirm I am 18 or older
            </Check>
            <Check checked={ack.terms} onChange={(v) => setAck({ ...ack, terms: v })}>
              I agree to the{" "}
              <a href="/terms" target="_blank" rel="noreferrer" className="underline">
                Terms
              </a>{" "}
              and{" "}
              <a href="/privacy" target="_blank" rel="noreferrer" className="underline">
                Privacy Notice
              </a>
              , and understand Plexecute is not medical advice (
              <a
                href="/legal/health-disclaimer"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                health disclaimer
              </a>
              )
            </Check>
            <Button
              className="w-full rounded-[10px]"
              disabled={!id.display_name.trim() || !ack.adult || !ack.terms}
              onClick={() => {
                setInteractions((n) => n + 1);
                setStage(1);
              }}
            >
              Continue
            </Button>
          </div>
        )}

        {stage === 1 && !msgs.some((m) => m.role === "member") && (
          <OnboardingQuestionnaire
            busy={thinking}
            onSubmit={(text, visionUnsure) => {
              setVisionAsked(true);
              void send(text, [], true, visionUnsure);
            }}
          />
        )}

        {stage === 1 && msgs.some((m) => m.role === "member") && (
          <div className="mt-4 flex flex-col rounded-[20px] border border-border bg-card">
            <div className="max-h-[55dvh] space-y-3 overflow-y-auto p-4" aria-live="polite">
              {msgs.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === "member"
                      ? "ml-8 whitespace-pre-wrap rounded-[14px] bg-primary px-3 py-2 text-sm text-primary-foreground"
                      : "mr-6 whitespace-pre-wrap text-sm"
                  }
                >
                  {m.text}
                </div>
              ))}
              {thinking && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Understanding…
                </p>
              )}
              <div ref={endRef} />
            </div>
            <div className="space-y-2 border-t border-border p-3">
              <Textarea
                aria-label="Tell Plexecute about your life"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={4}
                placeholder="e.g. I work Monday to Friday 7 till 4, uni on Tuesdays and Thursdays, I want to train four times a week…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(input);
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <VoiceInputButton
                  label="Speak instead of typing"
                  onTranscript={(t) => setInput((v) => appendTranscript(v, t))}
                />
                <div className="flex-1" />
                {draft && (
                  <Button variant="ghost" size="sm" onClick={() => setStage(2)}>
                    Review what I've got
                  </Button>
                )}
                <Button
                  className="rounded-[10px]"
                  disabled={!input.trim() || thinking}
                  onClick={() => void send(input)}
                  aria-label="Send"
                >
                  <Send className="h-4 w-4" /> Send
                </Button>
              </div>
              {draft && visionAsked && questions.length === 0 && needsVisionQuestion(draft) && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => {
                    setDraft({
                      ...draft,
                      vision: {
                        _confirmed: true,
                        answered: true,
                        summary: null,
                        objectives: [],
                      } as never,
                    });
                    setStage(2);
                  }}
                >
                  I'm not sure yet — skip this
                </button>
              )}
              {draft && questions.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={() => {
                    setInteractions((n) => n + 1);
                    const next = applyDefaults(draft);
                    setDraft(next);
                    setQuestions([]);
                    if (needsVisionQuestion(next) && !visionAsked) {
                      setVisionAsked(true);
                      setMsgs((m) => [
                        ...m,
                        { role: "plexecute", text: `One more: ${VISION_QUESTION}\n${VISION_HELP}` },
                      ]);
                    } else setStage(2);
                  }}
                >
                  Skip these — use sensible defaults I can change
                </button>
              )}
            </div>
          </div>
        )}

        {stage === 2 && draft && (
          <div className="mt-4 space-y-4 rounded-[20px] border border-border bg-card p-5">
            <h2 className="text-xl font-semibold">Here's what I understood</h2>
            <SummaryEditor draft={draft} onChange={setDraft} />
            <VisionEditor draft={draft} onChange={setDraft} />
            {d.assumed.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Assumed (edit above if wrong): {d.assumed.join(" · ")}
              </p>
            )}
            {liveQuestions.length > 0 && (
              <div className="space-y-1 text-sm text-warning">
                <p>Still needed: {liveQuestions.map((q) => q.text).join(" ")}</p>
                {liveQuestions.some((q) => q.key !== "goals") && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline"
                    onClick={() => setDraft(applyDefaults(draft))}
                  >
                    Use sensible defaults I can change
                  </button>
                )}
              </div>
            )}
            {d.goals.length > 3 && (
              <p className="text-xs text-muted-foreground">
                Your first plan covers the first 3 goals; add the rest from Goals afterwards.
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="flex-1 rounded-[10px]"
                disabled={liveQuestions.length > 0 || goals.length === 0}
                onClick={() => {
                  setInteractions((n) => n + 1);
                  setStage(3);
                }}
              >
                Looks right
              </Button>
              <Button
                variant="outline"
                className="flex-1 rounded-[10px]"
                onClick={() => {
                  setInteractions((n) => n + 1);
                  setMsgs((m) => [
                    ...m,
                    {
                      role: "plexecute",
                      text: liveQuestions.length
                        ? liveQuestions.map((q) => `• ${q.text}`).join("\n")
                        : "What should I change? Just tell me.",
                    },
                  ]);
                  setStage(1);
                }}
              >
                Change something
              </Button>
            </div>
          </div>
        )}

        {stage === 3 && (
          <div className="mt-4 space-y-4 rounded-[20px] border border-border bg-card p-5">
            <h2 className="text-xl font-semibold">Your first week</h2>
            <p
              className={`inline-flex rounded-full px-3 py-1 text-sm ${feas.level === "fits" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
            >
              {feas.label}
            </p>
            <p className="text-sm text-muted-foreground">
              {preview.blocks.length} sessions placed · {Math.round(preview.demandMin / 60)}h needed
              of {Math.round(preview.capacityMin / 60)}h free time this week, around{" "}
              {commits.length} fixed commitment{commits.length === 1 ? "" : "s"}.
            </p>
            <ul className="max-h-[40dvh] space-y-1 overflow-auto text-sm">
              {preview.blocks.map((b, i) => (
                <li
                  key={i}
                  className="flex justify-between gap-2 rounded-[10px] bg-background/60 px-3 py-2"
                >
                  <span>{b.title}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {new Date(b.starts_at).toLocaleString(undefined, {
                      weekday: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: id.timezone,
                    })}{" "}
                    · {b.duration_min} min
                  </span>
                </li>
              ))}
              {preview.blocks.length === 0 && (
                <li className="text-muted-foreground">
                  Nothing left to place this week — your plan starts filling from next week.
                </li>
              )}
            </ul>
            {preview.unplaced.length > 0 && (
              <p className="text-sm text-warning">
                Couldn't fit:{" "}
                {preview.unplaced.map((u) => `${u.title} (${u.minutes} min)`).join(", ")}. Change
                something to shorten sessions or free time.
              </p>
            )}
            <Button
              className="w-full rounded-[10px] bg-execute text-execute-foreground hover:bg-execute/90"
              disabled={saving}
              onClick={() => {
                setInteractions((n) => n + 1);
                void finish();
              }}
            >
              {saving ? "Saving…" : "Accept and start"}
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 rounded-[10px]"
                onClick={() => setStage(2)}
              >
                Edit details
              </Button>
              <Button
                variant="outline"
                className="flex-1 rounded-[10px]"
                onClick={() => {
                  setMsgs((m) => [
                    ...m,
                    { role: "plexecute", text: "What would you like to change about the plan?" },
                  ]);
                  setStage(1);
                }}
              >
                Ask to change
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Training, nutrition, reminders, calls and coaching style can be fine-tuned any time in
              the app.
            </p>
          </div>
        )}
        <span data-testid="interactions" className="sr-only">
          {interactions}
        </span>
      </div>
    </div>
  );
}

function SummaryEditor({
  draft,
  onChange,
}: {
  draft: IntakeDraft;
  onChange: (d: IntakeDraft) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const set = (p: Partial<IntakeDraft>) => onChange({ ...draft, ...p });
  const setC = (i: number, c: Partial<IntakeCommitment>) =>
    set({ commitments: draft.commitments.map((x, j) => (j === i ? { ...x, ...c } : x)) });
  const setG = (i: number, g: Partial<IntakeGoal>) =>
    set({ goals: draft.goals.map((x, j) => (j === i ? { ...x, ...g } : x)) });
  const row = (
    key: string,
    label: string,
    value: string,
    editor: React.ReactNode,
    onRemove?: () => void,
  ) => (
    <li key={key} className="rounded-[12px] border border-border px-3 py-2 text-sm">
      <div className="flex items-start gap-2">
        <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
        <span className="flex-1">{value}</span>
        <button
          type="button"
          aria-label={`Edit ${label}`}
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setOpen(open === key ? null : key)}
        >
          <Pencil className="h-4 w-4" />
        </button>
        {onRemove && (
          <button
            type="button"
            aria-label={`Remove ${label}`}
            className="text-muted-foreground hover:text-foreground"
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {open === key && <div className="mt-2 space-y-2">{editor}</div>}
    </li>
  );
  const days = (v: number[], f: (d: number[]) => void) => (
    <div className="flex flex-wrap gap-1">
      {DAYS.map((n, i) => (
        <button
          key={n}
          type="button"
          onClick={() => f(v.includes(i + 1) ? v.filter((x) => x !== i + 1) : [...v, i + 1].sort())}
          className={`rounded-md border px-2 py-1 text-xs ${v.includes(i + 1) ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
  const time = (label: string, v: string | null, f: (s: string) => void) => (
    <label className="flex-1 text-xs text-muted-foreground">
      {label}
      <Input type="time" value={v ?? ""} onChange={(e) => f(e.target.value)} />
    </label>
  );
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {draft.work
          ? row(
              "work",
              "Work",
              `${dayList(draft.work.days)}, ${draft.work.start ?? "?"}–${draft.work.end ?? "?"}`,
              <>
                {days(draft.work.days, (x) => set({ work: { ...draft.work!, days: x } }))}
                <div className="flex gap-2">
                  {time("Start", draft.work.start, (v) =>
                    set({ work: { ...draft.work!, start: v } }),
                  )}
                  {time("End", draft.work.end, (v) => set({ work: { ...draft.work!, end: v } }))}
                </div>
              </>,
              () => set({ work: null }),
            )
          : null}
        {draft.commitments.map((c, i) =>
          row(
            `c${i}`,
            c.protected ? "Protected" : c.kind === "study" ? "Study" : "Commitment",
            `${c.title}: ${c.on_date ?? dayList(c.days)}${allDay(c) ? ", all day" : c.start_time ? `, ${c.start_time}–${c.end_time ?? "?"}` : " (time?)"}`,
            <>
              <Input
                aria-label="Commitment name"
                value={c.title}
                onChange={(e) => setC(i, { title: e.target.value })}
              />
              <select
                aria-label="Type"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={c.kind}
                onChange={(e) => setC(i, { kind: e.target.value as IntakeCommitment["kind"] })}
              >
                {COMMIT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              {!c.on_date && days(c.days, (x) => setC(i, { days: x }))}
              <div className="flex gap-2">
                {time("From", c.start_time, (v) => setC(i, { start_time: v }))}
                {time("To", c.end_time, (v) => setC(i, { end_time: v }))}
              </div>
            </>,
            () => set({ commitments: draft.commitments.filter((_, j) => j !== i) }),
          ),
        )}
        {draft.goals.map((g, i) =>
          row(
            `g${i}`,
            "Goal",
            `${g.title}${g.sessions_per_week ? ` · ${g.sessions_per_week}×/week` : ""}${g.session_minutes ? ` · ${g.session_minutes} min` : ""}${g.deadline ? ` · by ${g.deadline}` : ""}`,
            <>
              <Input
                aria-label="Goal name"
                value={g.title}
                onChange={(e) => setG(i, { title: e.target.value })}
              />
              <select
                aria-label="Life area"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={g.domain}
                onChange={(e) => setG(i, { domain: e.target.value as IntakeGoal["domain"] })}
              >
                {DOMAINS.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <label className="flex-1 text-xs text-muted-foreground">
                  Times/week
                  <Input
                    type="number"
                    min={1}
                    max={14}
                    value={g.sessions_per_week ?? ""}
                    onChange={(e) =>
                      setG(i, { sessions_per_week: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </label>
                <label className="flex-1 text-xs text-muted-foreground">
                  Minutes
                  <Input
                    type="number"
                    min={10}
                    max={240}
                    value={g.session_minutes ?? ""}
                    onChange={(e) =>
                      setG(i, { session_minutes: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </label>
              </div>
              <select
                aria-label="Preferred time"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={g.preferred_time}
                onChange={(e) =>
                  setG(i, { preferred_time: e.target.value as IntakeGoal["preferred_time"] })
                }
              >
                <option value="any">Any time</option>
                <option value="morning">Morning</option>
                <option value="midday">Midday</option>
                <option value="evening">Evening</option>
              </select>
            </>,
            () => set({ goals: draft.goals.filter((_, j) => j !== i) }),
          ),
        )}
        {row(
          "sleep",
          "Sleep",
          `about ${draft.sleep_time ?? "?"}–${draft.wake_time ?? "?"}`,
          <div className="flex gap-2">
            {time("Bedtime", draft.sleep_time, (v) => set({ sleep_time: v }))}
            {time("Wake up", draft.wake_time, (v) => set({ wake_time: v }))}
          </div>,
        )}
        {draft.health_notes != null &&
          row(
            "health",
            "Health",
            draft.health_notes,
            <Input
              aria-label="Health notes"
              value={draft.health_notes}
              onChange={(e) => set({ health_notes: e.target.value })}
            />,
          )}
        {draft.priorities &&
          row(
            "prio",
            "Matters most",
            draft.priorities,
            <Input
              aria-label="Matters most"
              value={draft.priorities}
              onChange={(e) => set({ priorities: e.target.value })}
            />,
          )}
      </ul>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            set({
              commitments: [
                ...draft.commitments,
                {
                  title: "New commitment",
                  kind: "other",
                  days: [1],
                  on_date: null,
                  start_time: "18:00",
                  end_time: "19:00",
                  protected: false,
                },
              ],
            });
            setOpen(`c${draft.commitments.length}`);
          }}
        >
          <Plus className="h-4 w-4" /> Commitment
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            set({
              goals: [
                ...draft.goals,
                {
                  title: "New goal",
                  domain: "other",
                  sessions_per_week: 3,
                  session_minutes: 30,
                  preferred_time: "any",
                  deadline: null,
                  why: null,
                },
              ],
            });
            setOpen(`g${draft.goals.length}`);
          }}
        >
          <Plus className="h-4 w-4" /> Goal
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
      />
      <span>{children}</span>
    </label>
  );
}

/** 5-year direction on the review screen: long-term objectives the member can edit, remove or add. Never active goals. */
function VisionEditor({
  draft,
  onChange,
}: {
  draft: IntakeDraft;
  onChange: (d: IntakeDraft) => void;
}) {
  const v = draft.vision;
  const [text, setText] = useState("");
  const set = (objectives: IntakeDraft["vision"]["objectives"]) =>
    onChange({ ...draft, vision: { ...v, answered: true, objectives } });
  return (
    <section className="space-y-2 rounded-[14px] border border-border p-3">
      <h3 className="font-medium">Where you want to be in 5 years</h3>
      <p className="text-xs text-muted-foreground">
        Long-term direction. These guide your plan; they don't become goals unless you choose to
        start one.
      </p>
      {v.objectives.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {v.summary
            ? v.summary
            : v.answered
              ? "Not decided yet — that's fine, you can add this later."
              : "Not mentioned."}
        </p>
      )}
      <ul className="space-y-2">
        {v.objectives.map((o, i) => (
          <li key={i} className="flex items-center gap-2">
            <select
              aria-label="Area"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={o.area}
              onChange={(e) =>
                set(
                  v.objectives.map((x, j) =>
                    j === i ? { ...x, area: e.target.value as typeof o.area } : x,
                  ),
                )
              }
            >
              {VISION_AREAS.map((a) => (
                <option key={a} value={a}>
                  {a.replace("_", " ")}
                </option>
              ))}
            </select>
            <Input
              aria-label={`Objective ${i + 1}`}
              value={o.text}
              onChange={(e) =>
                set(v.objectives.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
              }
            />
            <button
              type="button"
              aria-label={`Remove ${o.text}`}
              onClick={() => set(v.objectives.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          aria-label="Add a 5-year objective"
          placeholder="Add one, e.g. Own my own home"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!text.trim()}
          onClick={() => {
            set([...v.objectives, { area: "other", text: text.trim().slice(0, 200) }]);
            setText("");
          }}
        >
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>
    </section>
  );
}
