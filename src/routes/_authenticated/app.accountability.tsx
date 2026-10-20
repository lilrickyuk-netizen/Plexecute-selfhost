import { FeatureHeader } from "@/components/FeatureHeader";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Phone, PhoneOff } from "lucide-react";
import {
  getCallingStatus,
  startPhoneVerification,
  confirmPhoneVerification,
  setCallConsent,
  stopAllCalls,
  resumeCalls,
  callMeNow,
} from "@/lib/calling.functions";
import {
  STATE_LABEL,
  ACK_LABEL,
  REASON_COPY,
  DISCLOSURE,
  type CallState,
  type Ack,
} from "@/lib/calling";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { saveExecuteCallPolicy } from "@/lib/calling.functions";
import { VOICEMAIL_GENERIC, CALL_MINUTES } from "@/lib/calling";
import { getCallAuditHistory, saveCallSettings } from "@/lib/calling.functions";
import { OCCURRENCE_KINDS, KIND_LABELS, type OccurrenceKind } from "@/lib/occurrences";
import { COACHING_STYLES, STYLE_LABEL, type CoachingStyle } from "@/lib/coaching-style";

export const Route = createFileRoute("/_authenticated/app/accountability")({
  head: () => ({
    meta: [
      { title: "Accountability calls | Plexecute" },
      {
        name: "description",
        content: "Set up phone accountability calls, see your monthly allowance and call history.",
      },
      { property: "og:title", content: "Accountability calls | Plexecute" },
      {
        property: "og:description",
        content: "Set up phone accountability calls, see your monthly allowance and call history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Accountability,
});

function Accountability() {
  const qc = useQueryClient();
  const load = useServerFn(getCallingStatus);
  const startV = useServerFn(startPhoneVerification);
  const confirmV = useServerFn(confirmPhoneVerification);
  const consent = useServerFn(setCallConsent);
  const stop = useServerFn(stopAllCalls);
  const resume = useServerFn(resumeCalls);
  const now = useServerFn(callMeNow);
  const { data: s } = useQuery({ queryKey: ["calling"], queryFn: () => load() });
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["calling"] });
  async function run(
    f: () => Promise<{ ok: boolean; error?: string | null; reason?: string | null }>,
    okMsg: string,
  ) {
    setBusy(true);
    try {
      const r = await f();
      if (r.ok) toast.success(okMsg);
      else toast.error(r.error ?? REASON_COPY[r.reason ?? ""] ?? "That didn't work.");
      refresh();
      return r.ok;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!s) return null;
  const isPaid = s.tier !== "free";
  const mins = (sec: number) =>
    `${Math.floor(sec / 60)} min ${sec % 60 ? `${sec % 60} s` : ""}`.trim();

  return (
    <div className="space-y-6">
      <FeatureHeader
        title="Accountability calls"
        icon={Phone}
        description="An automated phone check-in when a session you chose is due. You answer with your keypad: start, snooze, move, skip, or stop calls."
      />

      {!s.config.calls && (
        <p className="rounded-[14px] border border-border bg-card p-4 text-sm text-muted-foreground">
          Calls aren't switched on yet. They start working once the phone service keys are added.
        </p>
      )}
      {s.config.calls && s.config.markets.length === 0 && (
        <p className="rounded-[14px] border border-border bg-card p-4 text-sm text-muted-foreground">
          Calls aren't cleared for any country yet. They'll start once the legal check for your
          country is signed off.
        </p>
      )}

      {s.tier === "free" ? (
        <section className="rounded-[16px] border border-border bg-card p-5 text-sm">
          <p>Phone calls are part of Pro and Execute.</p>
          <Button asChild variant="outline" className="mt-3 rounded-[10px]">
            <Link to="/app/billing" search={{ status: undefined }}>
              Compare plans
            </Link>
          </Button>
        </section>
      ) : (
        <>
          {s.tier === "pro" && (
            <section className="rounded-[16px] border border-border bg-card p-5 text-sm space-y-2">
              <h2 className="font-medium">Pro calling</h2>
              <Button asChild variant="outline" size="sm">
                <Link to="/app/billing" search={{ status: undefined }}>
                  Add 60 call minutes
                </Link>
              </Button>
              <p className="text-xs text-muted-foreground">
                Each check-in tries at most twice: when the session is due, then once more 10
                minutes later if there's no answer, the line is busy or voicemail picks up.
              </p>
              {s.usage.ended && (
                <div className="flex items-center justify-between rounded-[12px] border border-border p-3">
                  <span>
                    Your included Pro call usage has ended. Add call time to keep calling; in-app
                    reminders carry on. Execute includes persistent calling.
                  </span>
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/app/billing" search={{ status: undefined }}>
                      Add minutes or compare plans
                    </Link>
                  </Button>
                </div>
              )}
            </section>
          )}

          {s.execute && <ExecutePanel ex={s.execute} onSaved={refresh} />}

          <section className="rounded-[16px] border border-border bg-card p-5 text-sm space-y-3">
            <h2 className="font-medium">1. Your phone number</h2>
            {s.phone?.verified ? (
              <p>
                Verified: ending {s.phone.last4} ({s.phone.country})
              </p>
            ) : (
              <div className="space-y-2">
                {s.phone && !s.phone.verified && (
                  <p className="text-muted-foreground">Ending {s.phone.last4}: not verified yet.</p>
                )}
                <div className="flex gap-2">
                  <Input
                    placeholder="+447700900123"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                  <Button
                    disabled={busy || !phone}
                    className="rounded-[10px]"
                    onClick={async () => {
                      if (await run(() => startV({ data: { phone } }), "Code sent by text"))
                        setSent(true);
                    }}
                  >
                    Send code
                  </Button>
                </div>
                {(sent || (s.phone && !s.phone.verified)) && (
                  <div className="flex gap-2">
                    <Input
                      inputMode="numeric"
                      placeholder="Code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                    <Button
                      disabled={busy || !code}
                      className="rounded-[10px]"
                      onClick={() => run(() => confirmV({ data: { code } }), "Number verified")}
                    >
                      Verify
                    </Button>
                  </div>
                )}
              </div>
            )}
            {s.phone?.verified && (
              <button className="text-xs text-primary" onClick={() => setPhone(" ")}>
                Change number
              </button>
            )}
            {s.phone?.verified && phone && (
              <div className="flex gap-2">
                <Input
                  placeholder="+447700900123"
                  value={phone.trim()}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <Button
                  disabled={busy}
                  className="rounded-[10px]"
                  onClick={async () => {
                    if (
                      await run(
                        () => startV({ data: { phone: phone.trim() } }),
                        "Code sent by text",
                      )
                    )
                      setSent(true);
                  }}
                >
                  Send code
                </Button>
              </div>
            )}
          </section>

          <section className="rounded-[16px] border border-border bg-card p-5 text-sm space-y-3">
            <h2 className="font-medium">2. How calls work</h2>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Calls are automated. Every call starts: "{DISCLOSURE}"</li>
              <li>
                Nothing about your session is said until you press 1 to confirm it's you. Nothing is
                left on voicemail unless you choose a short general message below, which never
                mentions your session.
              </li>
              {s.tier === "pro" ? (
                <li>Pro: at most 2 tries per check-in, the second 10 minutes after the first.</li>
              ) : (
                <li>
                  Execute: if you don't answer, we try again after 5, 10 and 20 minutes, then every
                  30 minutes while the session is still open, up to your chosen limit (at most 6 per
                  session and 12 in any 24 hours).
                </li>
              )}
              <li>
                No calls in your quiet hours or while a safety note is active. Your phone company
                may charge for incoming calls abroad.
              </li>
              <li>
                {s.config.voice
                  ? "After you press 1 you can talk to the AI coach, and interrupt it at any time. If live voice isn't available, you'll use your keypad instead."
                  : "You answer with your keypad. Talking to the AI coach turns on once the live voice service is added."}
              </li>
              <li>
                Press 9 on any call, or "Stop all calls" here, to stop every call immediately.
              </li>
              <li>
                No call audio or transcript is kept, only what you pressed and how long the call
                lasted.
              </li>
              <li>
                Full details:{" "}
                <Link to="/legal/$doc" params={{ doc: "calling" }} className="underline">
                  Paid calling consent and acceptable use
                </Link>
                .
              </li>
            </ul>
            {s.consented ? (
              <p>
                You agreed on {new Date(s.consentAt!).toLocaleDateString("en-GB")}.{" "}
                <button
                  className="text-primary"
                  onClick={() =>
                    run(() => consent({ data: { agree: false } }), "Consent withdrawn")
                  }
                >
                  Withdraw
                </button>
              </p>
            ) : (
              <Button
                disabled={busy || !s.phone?.verified}
                className="rounded-[10px]"
                onClick={() =>
                  run(
                    () =>
                      consent({ data: { agree: true, device: navigator.userAgent.slice(0, 200) } }),
                    "Calls turned on",
                  )
                }
              >
                I agree, turn calls on
              </Button>
            )}
          </section>

          <CallSettings onSaved={refresh} />

          <section className="rounded-[16px] border border-border bg-card p-5 text-sm space-y-3">
            <h2 className="font-medium">4. Choose sessions</h2>
            <p className="text-muted-foreground">
              On Today or your Plan, tap "Call me" on any session (training, study, work, anything)
              to get a call when it's due.
            </p>
            <div className="flex flex-wrap gap-2">
              {isPaid && (
                <Button
                  disabled={busy}
                  className="rounded-[10px]"
                  onClick={() =>
                    run(() => now({ data: { origin: window.location.origin } }), "Calling you now")
                  }
                >
                  <Phone className="h-4 w-4" /> Call me now
                </Button>
              )}
              {s.stopped ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  className="rounded-[10px]"
                  onClick={() => run(resume, "Calls can start again")}
                >
                  Allow calls again
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  disabled={busy}
                  className="rounded-[10px]"
                  onClick={() => run(stop, "All calls stopped")}
                >
                  <PhoneOff className="h-4 w-4" /> Stop all calls
                </Button>
              )}
            </div>
          </section>
        </>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium">Call history</h2>
        {s.campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No calls yet.</p>
        ) : (
          <ul className="space-y-2">
            {s.campaigns.map((c) => (
              <li key={c.id} className="rounded-[14px] border border-border bg-card p-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span>{c.title}</span>
                  <span className="text-muted-foreground">
                    {c.acknowledgement
                      ? ACK_LABEL[c.acknowledgement as Ack]
                      : STATE_LABEL[c.state as CallState]}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(c.created_at).toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}{" "}
                  · {c.attempts} of {c.max_attempts} tries
                  {c.connected_seconds ? ` · ${mins(c.connected_seconds)} connected` : ""}
                  {c.stop_reason && REASON_COPY[c.stop_reason]
                    ? ` · ${REASON_COPY[c.stop_reason]}`
                    : ""}
                </div>
                {(c.call_logs ?? []).map((l, i) =>
                  l.summary ? (
                    <div key={i} className="text-xs text-muted-foreground">
                      {l.summary}
                    </div>
                  ) : null,
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type Ex = NonNullable<Awaited<ReturnType<typeof getCallingStatus>>["execute"]>;
function ExecutePanel({ ex, onSaved }: { ex: Ex; onSaved: () => void }) {
  const save = useServerFn(saveExecuteCallPolicy);
  const pr = ex.prefs ?? {
    call_morning_enabled: false,
    call_morning_time: "08:00",
    call_due_enabled: true,
    call_missed_enabled: false,
    call_evening_enabled: false,
    call_evening_time: "20:00",
    call_max_attempts: 6,
  };
  const [f, setF] = useState({
    ...pr,
    call_morning_time: pr.call_morning_time.slice(0, 5),
    call_evening_time: pr.call_evening_time.slice(0, 5),
  });
  const row = (
    label: string,
    detail: string,
    key:
      "call_morning_enabled" | "call_due_enabled" | "call_missed_enabled" | "call_evening_enabled",
    time?: "call_morning_time" | "call_evening_time",
  ) => (
    <div className="flex items-center justify-between gap-3 border-t border-border py-3">
      <div>
        <div>{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
      <div className="flex items-center gap-2">
        {time && (
          <Input
            type="time"
            className="w-28"
            value={f[time]}
            onChange={(e) => setF({ ...f, [time]: e.target.value })}
          />
        )}
        <Switch
          aria-label={label}
          checked={f[key]}
          onCheckedChange={(v) => setF({ ...f, [key]: v })}
        />
      </div>
    </div>
  );
  return (
    <section className="rounded-[16px] border border-border bg-card p-5 text-sm space-y-3">
      <h2 className="font-medium">Execute calling</h2>
      {ex.ended && (
        <p className="text-muted-foreground">
          This month's call usage has ended. Reminders in the app carry on. Extra minutes are only
          ever added if you buy them.
        </p>
      )}
      {ex.hold && (
        <p className="text-warning">
          Calls are paused for now because most recent calls went unanswered. Reminders in the app
          carry on.
        </p>
      )}
      <div>
        {row(
          "Morning call",
          "A run-through of today's plan.",
          "call_morning_enabled",
          "call_morning_time",
        )}
        {row(
          "When a session is due",
          'For your goal sessions and any session you marked "Call me".',
          "call_due_enabled",
        )}
        {row(
          "When a session is missed",
          "A call to pick a new time or skip it.",
          "call_missed_enabled",
        )}
        {row(
          "Evening call",
          "What you completed today.",
          "call_evening_enabled",
          "call_evening_time",
        )}
        <div className="flex items-center justify-between gap-3 border-t border-border py-3">
          <div>
            <div>Most tries per session</div>
            <div className="text-xs text-muted-foreground">
              Never more than 6, and never more than 12 calls in 24 hours.
            </div>
          </div>
          <select
            aria-label="Most tries per session"
            value={f.call_max_attempts}
            onChange={(e) => setF({ ...f, call_max_attempts: Number(e.target.value) })}
            className="h-9 rounded-md border border-input bg-background px-2"
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>
      <Button
        className="rounded-[10px]"
        onClick={async () => {
          const r = await save({ data: f });
          if (r.ok) {
            toast.success("Call settings saved");
            onSaved();
          } else toast.error(r.error ?? "Couldn't save.");
        }}
      >
        Save call settings
      </Button>
    </section>
  );
}

function CallSettings({ onSaved }: { onSaved: () => void }) {
  const load = useServerFn(getCallAuditHistory);
  const save = useServerFn(saveCallSettings);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["call-audit"], queryFn: () => load() });
  if (!data) return null;
  return (
    <CallSettingsForm
      key={JSON.stringify(data.settings)}
      data={data}
      onSave={async (v) => {
        const r = await save({ data: v });
        if (r.ok) {
          toast.success("Call settings saved");
          qc.invalidateQueries({ queryKey: ["call-audit"] });
          onSaved();
        } else toast.error(r.error ?? "Couldn't save.");
      }}
    />
  );
}

type Audit = Awaited<ReturnType<typeof getCallAuditHistory>>;
function CallSettingsForm({
  data,
  onSave,
}: {
  data: Audit;
  onSave: (v: {
    call_allowed_kinds: OccurrenceKind[] | null;
    call_max_minutes: number;
    call_voicemail_policy: "none" | "generic";
    call_style: CoachingStyle | null;
  }) => Promise<void>;
}) {
  const st = data.settings;
  const [kinds, setKinds] = useState<OccurrenceKind[]>(
    (st?.call_allowed_kinds as OccurrenceKind[] | null) ?? [...OCCURRENCE_KINDS],
  );
  const [minutes, setMinutes] = useState(st?.call_max_minutes ?? CALL_MINUTES.default);
  const [vm, setVm] = useState<"none" | "generic">(
    (st?.call_voicemail_policy as "none" | "generic") ?? "none",
  );
  const [style, setStyle] = useState<CoachingStyle | "">(
    (st?.call_style as CoachingStyle | null) ?? "",
  );
  const [busy, setBusy] = useState(false);
  const sel = "h-9 rounded-md border border-input bg-background px-2";
  return (
    <section className="rounded-[16px] border border-border bg-card p-5 text-sm space-y-4">
      <h2 className="font-medium">3. Your call settings</h2>
      <div>
        <div className="mb-2">Which sessions may call you</div>
        <div className="flex flex-wrap gap-2">
          {OCCURRENCE_KINDS.map((k) => {
            const on = kinds.includes(k);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => setKinds(on ? kinds.filter((x) => x !== k) : [...kinds, k])}
                className={`rounded-full border px-3 py-1 text-xs ${on ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted-foreground"}`}
              >
                {KIND_LABELS[k]}
              </button>
            );
          })}
        </div>
        {kinds.length === 0 && (
          <p className="mt-2 text-xs text-warning">
            No session types are selected, so no session calls will be made.
          </p>
        )}
      </div>
      <label className="flex items-center justify-between gap-3">
        <span>
          Longest call
          <span className="block text-xs text-muted-foreground">
            The call ends after this, even mid-menu.
          </span>
        </span>
        <select
          aria-label="Longest call"
          className={sel}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
        >
          {Array.from({ length: CALL_MINUTES.max }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n} min
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-3">
        <span>
          If voicemail answers
          <span className="block text-xs text-muted-foreground">
            {vm === "generic"
              ? `We'll say: "${VOICEMAIL_GENERIC}"`
              : "We hang up without leaving a message."}
          </span>
        </span>
        <select
          aria-label="If voicemail answers"
          className={sel}
          value={vm}
          onChange={(e) => setVm(e.target.value as "none" | "generic")}
        >
          <option value="none">Leave nothing</option>
          <option value="generic">Short general message</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-3">
        <span>
          Call tone
          <span className="block text-xs text-muted-foreground">
            Changes the wording only, never what's allowed.
          </span>
        </span>
        <select
          aria-label="Call tone"
          className={sel}
          value={style}
          onChange={(e) => setStyle(e.target.value as CoachingStyle | "")}
        >
          <option value="">
            Same as my coach
            {data.settings?.coaching_style
              ? ` (${STYLE_LABEL[data.settings.coaching_style as CoachingStyle] ?? data.settings.coaching_style})`
              : ""}
          </option>
          {COACHING_STYLES.map((c) => (
            <option key={c} value={c}>
              {STYLE_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        How often we retry is set by your plan (and on Execute, by "Most tries per session" above).
        Quiet hours are in Settings.
      </p>
      <Button
        disabled={busy}
        className="rounded-[10px]"
        onClick={async () => {
          setBusy(true);
          try {
            await onSave({
              call_allowed_kinds: kinds.length === OCCURRENCE_KINDS.length ? null : kinds,
              call_max_minutes: minutes,
              call_voicemail_policy: vm,
              call_style: style || null,
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        Save call settings
      </Button>
      <div className="border-t border-border pt-3">
        <h3 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
          Settings history
        </h3>
        {data.events.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {data.events.map((e, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{e.what}</span>
                <span className="text-muted-foreground">
                  {new Date(e.at).toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
