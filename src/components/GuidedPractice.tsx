import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  focusList,
  focusOf,
  minutesFor,
  MEDITATION_SAFETY,
  YOGA_SAFETY,
  type Activity,
  type VideoChoice,
} from "@/lib/guided-video";
import {
  addPractice,
  findVideos,
  guidedForBlock,
  setGuidedFeedback,
  videoAvailability,
} from "@/lib/guided-video.functions";
import { logWellness } from "@/lib/wellness.functions";

type Sel = { activity: Activity | null; focus: string | null; minutes: number | null };
const card = (on: boolean) =>
  `min-h-12 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${on ? "border-execute bg-execute/15 text-execute" : "border-border bg-background hover:bg-raised"}`;

export function GuidedPractice({
  blockId,
  initial,
  lock,
  focusKeys,
  title,
}: {
  blockId?: string | undefined;
  initial?: {
    activity?: Activity | undefined;
    focus?: string | undefined;
    minutes?: number | undefined;
  };
  /** Keep the activity fixed (the section already chose yoga or meditation). */
  lock?: boolean;
  /** Only offer these focus options (e.g. stretching/recovery). */
  focusKeys?: string[];
  title?: string;
}) {
  const qc = useQueryClient();
  const find = useServerFn(findVideos);
  const availFn = useServerFn(videoAvailability);
  const [avail, setAvail] = useState<Set<string> | null>(null);
  useEffect(() => {
    availFn()
      .then((a) => setAvail(new Set(a)))
      .catch(() => setAvail(new Set()));
  }, [availFn]);
  const has = (a: Activity, f: string, m?: number) =>
    !avail
      ? true
      : m != null
        ? avail.has(`${a}:${f}:${m}`)
        : minutesFor(a).some((x) => avail.has(`${a}:${f}:${x}`));
  const forBlock = useServerFn(guidedForBlock);
  const log = useServerFn(logWellness);
  const feedback = useServerFn(setGuidedFeedback);
  const add = useServerFn(addPractice);
  const [sel, setSel] = useState<Sel>({
    activity: initial?.activity ?? null,
    focus: initial?.focus ?? null,
    minutes: initial?.minutes ?? null,
  });
  const [choices, setChoices] = useState<VideoChoice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<VideoChoice | null>(null);
  const [saved, setSaved] = useState<{ id: string } | null>(null);
  const [rated, setRated] = useState(false);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [regular, setRegular] = useState<{
    perWeek: number;
    time: "morning" | "midday" | "evening" | "any";
  } | null>(null);

  // A planned session opens straight on matching choices.
  useEffect(() => {
    if (!blockId) return;
    forBlock({ data: { blockId } }).then((b) => {
      if (b) setSel({ activity: b.activity, focus: b.focus, minutes: b.minutes });
    });
  }, [blockId, forBlock]);

  useEffect(() => {
    if (!sel.activity || !sel.focus || !sel.minutes) return;
    let live = true;
    setLoading(true);
    setErr(null);
    setChoices(null);
    find({ data: { activity: sel.activity, focus: sel.focus, minutes: sel.minutes } })
      .then((r) => live && setChoices(r.choices))
      .catch((e) => live && setErr((e as Error).message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [sel.activity, sel.focus, sel.minutes, find]);

  function reset() {
    setSel({ activity: lock ? (initial?.activity ?? null) : null, focus: null, minutes: null });
    setChoices(null);
    setPicked(null);
    setSaved(null);
    setRated(false);
    setClientId(crypto.randomUUID());
  }

  async function complete(state: "completed" | "partial") {
    if (!picked || !sel.activity || !sel.minutes) return;
    setBusy(true);
    try {
      const r = await log({
        data: {
          type: sel.activity === "yoga" ? "yoga" : "guided_meditation",
          activity: sel.activity,
          focus: sel.focus,
          video: {
            videoId: picked.videoId,
            url: picked.url,
            title: picked.title,
            creator: picked.creator,
            seconds: picked.seconds,
          },
          clientId,
          plannedMinutes: sel.minutes,
          actualMinutes:
            state === "completed"
              ? Math.max(sel.minutes, Math.round(picked.seconds / 60))
              : Math.round(sel.minutes / 2),
          state,
          calmBefore: null,
          calmAfter: null,
          useful: null,
          note: null,
          blockId: blockId ?? null,
        },
      });
      setSaved({ id: r.id });
      toast.success(state === "completed" ? "Marked complete" : "Saved as partly done");
      qc.invalidateQueries({ queryKey: ["wellness"] });
      qc.invalidateQueries({ queryKey: ["wellness-history"] });
      qc.invalidateQueries({ queryKey: ["blocks"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // A plan block or Coach link asking for a length with no matching video moves to the nearest length that has one.
  useEffect(() => {
    if (
      !avail ||
      !sel.activity ||
      !sel.focus ||
      !sel.minutes ||
      has(sel.activity, sel.focus, sel.minutes)
    )
      return;
    const ok = minutesFor(sel.activity).filter((m) => has(sel.activity!, sel.focus!, m));
    if (ok.length) {
      const near = ok.reduce((b, x) =>
        Math.abs(x - sel.minutes!) < Math.abs(b - sel.minutes!) ? x : b,
      );
      setSel({ ...sel, minutes: near });
    } else setSel({ ...sel, focus: null, minutes: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avail, sel.activity, sel.focus, sel.minutes]);

  const step = !sel.activity ? 1 : !sel.focus ? 2 : !sel.minutes ? 3 : 4;
  const fo = sel.activity && sel.focus ? focusOf(sel.activity, sel.focus) : null;
  const focuses = sel.activity
    ? focusList(sel.activity).filter(
        (x) => (!focusKeys || focusKeys.includes(x.key)) && has(sel.activity!, x.key),
      )
    : [];
  const groups = sel.activity ? [...new Set(focuses.map((x) => x.group))] : [];

  return (
    <section
      className="mt-6 rounded-2xl border border-border bg-surface p-5"
      aria-label="Guided yoga and meditation"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-execute">
            Guided videos{blockId ? " · from your plan" : ""}
          </div>
          <h2 className="mt-1 text-xl font-semibold">
            {title ??
              (sel.activity
                ? sel.activity === "yoga"
                  ? "Yoga"
                  : "Meditation"
                : "Yoga or meditation")}
            {fo ? ` · ${fo.label}` : ""}
            {sel.minutes ? ` · ${sel.minutes} min` : ""}
          </h2>
        </div>
        {step > (lock ? 2 : 1) && !saved && (
          <Button variant="ghost" size="sm" onClick={reset}>
            Start over
          </Button>
        )}
      </div>

      {step === 1 && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {(["meditation", "yoga"] as Activity[]).map((a) => (
            <button
              key={a}
              className={`${card(false)} py-6 text-base`}
              onClick={() => setSel({ activity: a, focus: null, minutes: null })}
            >
              {a === "yoga" ? "Yoga" : "Meditation"}
              <span className="mt-1 block text-xs font-normal text-muted-foreground">
                {a === "yoga"
                  ? "Follow a video for your body and day"
                  : "A guided session for your mind"}
              </span>
            </button>
          ))}
        </div>
      )}

      {step === 2 && sel.activity && (
        <div className="mt-4">
          <p className="font-medium">
            {sel.activity === "yoga" ? "What would you like to work on?" : "What is it for?"}
          </p>
          {groups.map((g) => (
            <div key={g} className="mt-3">
              <div className="text-xs text-muted-foreground">{g}</div>
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {focuses
                  .filter((x) => x.group === g)
                  .map((x) => (
                    <button
                      key={x.key}
                      className={card(false)}
                      onClick={() => setSel({ ...sel, focus: x.key })}
                    >
                      {x.label}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {step === 3 && sel.activity && (
        <div className="mt-4">
          <p className="font-medium">How long have you got?</p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {minutesFor(sel.activity)
              .filter((m) => has(sel.activity!, sel.focus!, m))
              .map((m) => (
                <button
                  key={m}
                  className={card(false)}
                  onClick={() => setSel({ ...sel, minutes: m })}
                >
                  {m} min
                </button>
              ))}
          </div>
        </div>
      )}

      {step === 4 && !picked && (
        <div className="mt-4">
          {loading && <p className="text-sm text-muted-foreground">Finding videos that match…</p>}
          {err && <p className="text-sm text-destructive">{err}</p>}
          {choices && choices.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No checked video matches this exactly right now. Try a nearby length or another focus.
            </p>
          )}
          <div className="grid gap-3">
            {choices?.map((c) => (
              <button
                key={c.videoId}
                className={`${card(false)} flex gap-3`}
                onClick={() => setPicked(c)}
              >
                <img
                  src={`https://i.ytimg.com/vi/${c.videoId}/mqdefault.jpg`}
                  alt=""
                  className="h-16 w-28 shrink-0 rounded-md object-cover"
                  loading="lazy"
                />
                <span>
                  <span className="block">{c.title}</span>
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    {c.creator} · {Math.round(c.seconds / 60)} min · YouTube
                  </span>
                  <span className="mt-0.5 block text-xs font-normal text-execute">{c.why}</span>
                </span>
              </button>
            ))}
          </div>
          {choices && choices.length > 0 && !blockId && (
            <div className="mt-4 rounded-xl border border-border p-3 text-sm">
              {!regular ? (
                <button
                  className="text-execute underline"
                  onClick={() => setRegular({ perWeek: 3, time: "any" })}
                >
                  Make this a regular part of my plan
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Times per week"
                    className="rounded-md border border-border bg-background px-2 py-1.5"
                    value={regular.perWeek}
                    onChange={(e) => setRegular({ ...regular, perWeek: Number(e.target.value) })}
                  >
                    {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <option key={n} value={n}>
                        {n}× a week
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Time of day"
                    className="rounded-md border border-border bg-background px-2 py-1.5"
                    value={regular.time}
                    onChange={(e) => setRegular({ ...regular, time: e.target.value as never })}
                  >
                    {["morning", "midday", "evening", "any"].map((t) => (
                      <option key={t} value={t}>
                        {t === "any" ? "Any time" : t[0]!.toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const r = await add({
                          data: {
                            activity: sel.activity!,
                            focus: sel.focus!,
                            minutes: sel.minutes!,
                            ...regular,
                          },
                        });
                        toast.success(
                          `${r.title} added. Use Replan on your Plan to fit it into your week.`,
                        );
                        setRegular(null);
                      } catch (e) {
                        toast.error((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Add to plan
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {picked && (
        <div className="mt-4">
          {picked.embeddable ? (
            <div className="aspect-video overflow-hidden rounded-xl bg-raised">
              <iframe
                title={picked.title}
                src={`https://www.youtube-nocookie.com/embed/${picked.videoId}?rel=0`}
                className="h-full w-full"
                allow="encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
              />
            </div>
          ) : null}
          <p className="mt-2 font-medium">{picked.title}</p>
          <p className="text-xs text-muted-foreground">
            {picked.creator} · {Math.round(picked.seconds / 60)} min ·{" "}
            <a
              href={picked.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-execute underline"
            >
              Open on YouTube
            </a>
          </p>
          {!saved ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => complete("completed")}>
                Mark complete
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => complete("partial")}>
                Did part of it
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setPicked(null)}>
                Choose another
              </Button>
            </div>
          ) : (
            <div className="mt-4">
              {!rated ? (
                <>
                  <p className="font-medium">How was that?</p>
                  <div className="mt-2 flex gap-2">
                    {(
                      [
                        ["helpful", "Helpful"],
                        ["okay", "Okay"],
                        ["not_for_me", "Not for me"],
                      ] as const
                    ).map(([k, l]) => (
                      <Button
                        key={k}
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          await feedback({ data: { sessionId: saved.id, feedback: k } });
                          setRated(true);
                        }}
                      >
                        {l}
                      </Button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-execute">
                  Thanks. Future suggestions take this into account.
                </p>
              )}
              <Button variant="ghost" size="sm" className="mt-3" onClick={reset}>
                Another session
              </Button>
            </div>
          )}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        {sel.activity === "meditation" ? MEDITATION_SAFETY : YOGA_SAFETY}{" "}
        <Link to="/safety" className="underline">
          Safety
        </Link>
      </p>
    </section>
  );
}
