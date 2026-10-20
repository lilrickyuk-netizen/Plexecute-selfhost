import type React from "react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { uid, useProfile } from "@/lib/data";
import { syllabusProgress, REVIEW_INTERVALS } from "@/lib/learning";
import { addRetrievalItem, reviewItem, generateQuestions } from "@/lib/learning.functions";
import { localDayKey } from "@/lib/tz";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const card = "rounded-[14px] border border-border bg-card p-4";

export function LearningPlan({ goalId, deadline }: { goalId: string; deadline: string | null }) {
  const qc = useQueryClient();
  const { data: prof } = useProfile();
  const today = localDayKey(new Date(), prof?.timezone);
  const add = useServerFn(addRetrievalItem),
    review = useServerFn(reviewItem),
    gen = useServerFn(generateQuestions);
  const k = ["learning", goalId];
  const { data } = useQuery({
    queryKey: k,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      const [t, r, i, a, m, rv] = await Promise.all([
        supabase.from("learning_topics").select("*").eq("goal_id", goalId).order("position"),
        supabase.from("learning_resources").select("*").eq("goal_id", goalId).order("created_at"),
        supabase.from("retrieval_items").select("*").eq("goal_id", goalId).order("due_on"),
        supabase
          .from("learning_assessments")
          .select("*")
          .eq("goal_id", goalId)
          .order("due_on", { nullsFirst: false }),
        supabase
          .from("plan_blocks")
          .select("id,starts_at,status")
          .eq("goal_id", goalId)
          .in("status", ["missed", "skipped"])
          .order("starts_at", { ascending: false })
          .limit(5),
        supabase
          .from("retrieval_reviews")
          .select("item_id,correct")
          .gte("reviewed_at", since)
          .limit(2000),
      ]);
      const ids = new Set((i.data ?? []).map((x) => x.id));
      const reviews = (rv.data ?? []).filter((x) => ids.has(x.item_id));
      return {
        topics: t.data ?? [],
        resources: r.data ?? [],
        items: i.data ?? [],
        assessments: a.data ?? [],
        missed: m.data ?? [],
        reviews,
      };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: k });
  const [topic, setTopic] = useState({ title: "", parent_id: "" });
  const [res, setRes] = useState({ title: "", kind: "book", total_units: "", content: "" });
  const [q, setQ] = useState({ prompt: "", answer: "", topic: "" });
  const [as, setAs] = useState({ title: "", kind: "self_test", due_on: "" });
  const [reveal, setReveal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const prog = syllabusProgress(data.topics);
  const due = data.items.filter((x) => x.due_on <= today);

  async function ins(
    table: "learning_topics" | "learning_resources" | "learning_assessments",
    row: Record<string, unknown>,
  ) {
    const { error } = await supabase
      .from(table)
      .insert({ ...row, user_id: await uid(), goal_id: goalId } as never);
    if (error) {
      toast.error("That could not be saved.");
      return false;
    }
    refresh();
    return true;
  }
  async function upd(
    table: "learning_topics" | "learning_resources" | "learning_assessments",
    id: string,
    row: Record<string, unknown>,
  ) {
    const { error } = await supabase
      .from(table)
      .update(row as never)
      .eq("id", id);
    if (error) toast.error("That could not be saved.");
    else refresh();
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Learning plan</h2>

      <div className={card}>
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Review due today</h3>
          <span className="text-xs text-muted-foreground">
            {due.length} due · schedule {REVIEW_INTERVALS.join(" → ")} days
          </span>
        </div>
        {due.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">Nothing to review today.</p>
        )}
        <ul className="mt-2 space-y-2">
          {due.slice(0, 10).map((x) => (
            <li key={x.id} className="rounded-md border border-border p-3 text-sm">
              <p>
                {x.prompt}
                {x.generated && (
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    (AI-written from your notes)
                  </span>
                )}
              </p>
              {reveal === x.id ? (
                <div className="mt-2">
                  <p className="text-muted-foreground">{x.answer}</p>
                  <div className="mt-2 flex gap-2">
                    {[true, false].map((c) => (
                      <Button
                        key={String(c)}
                        size="sm"
                        variant={c ? "default" : "outline"}
                        onClick={async () => {
                          try {
                            const r = await review({ data: { itemId: x.id, correct: c } });
                            toast.success(`Next review in ${r.days} day${r.days > 1 ? "s" : ""}`);
                            setReveal(null);
                            refresh();
                          } catch (e) {
                            toast.error((e as Error).message);
                          }
                        }}
                      >
                        {c ? "I got it" : "I missed it"}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => setReveal(x.id)}
                >
                  Try to recall, then show answer
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className={card}>
        <h3 className="font-medium">Syllabus / skills</h3>
        <p className="text-xs text-muted-foreground">
          {prog.done}/{prog.total} topics done ({prog.pct}%)
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          {data.topics.map((t) => (
            <li key={t.id} className={t.parent_id ? "ml-5" : ""}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!t.done_at}
                  onChange={(e) =>
                    upd("learning_topics", t.id, {
                      done_at: e.target.checked ? new Date().toISOString() : null,
                    })
                  }
                />
                {t.title}
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <F l="Topic or skill">
            <Input
              className="max-w-xs"
              value={topic.title}
              onChange={(e) => setTopic({ ...topic, title: e.target.value })}
            />
          </F>
          <select
            aria-label="Parent topic"
            className={sel}
            value={topic.parent_id}
            onChange={(e) => setTopic({ ...topic, parent_id: e.target.value })}
          >
            <option value="">Top level</option>
            {data.topics
              .filter((t) => !t.parent_id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  Under: {t.title}
                </option>
              ))}
          </select>
          <Button
            size="sm"
            disabled={!topic.title.trim()}
            onClick={async () => {
              if (
                await ins("learning_topics", {
                  title: topic.title.trim(),
                  parent_id: topic.parent_id || null,
                  position: data.topics.length,
                })
              )
                setTopic({ title: "", parent_id: "" });
            }}
          >
            Add
          </Button>
        </div>
      </div>

      <div className={card}>
        <h3 className="font-medium">Resources and reading plan</h3>
        <ul className="mt-2 space-y-2 text-sm">
          {data.resources.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.title}</span>
              <span className="text-xs text-muted-foreground">{r.kind.replace("_", " ")}</span>
              {r.total_units && (
                <span className="text-xs">
                  {r.done_units}/{r.total_units}{" "}
                  <button
                    className="text-execute"
                    onClick={() =>
                      upd("learning_resources", r.id, {
                        done_units: Math.min(r.total_units!, r.done_units + 1),
                      })
                    }
                  >
                    +1
                  </button>
                </span>
              )}
              {r.content && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const x = await gen({ data: { resourceId: r.id } });
                      toast.success(
                        x.added
                          ? `${x.added} questions added from your notes`
                          : "No questions could be written from these notes.",
                      );
                      refresh();
                    } catch (e) {
                      toast.error((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Write questions from my notes
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <F l="Resource name">
            <Input value={res.title} onChange={(e) => setRes({ ...res, title: e.target.value })} />
          </F>
          <select
            aria-label="Resource type"
            className={sel}
            value={res.kind}
            onChange={(e) => setRes({ ...res, kind: e.target.value })}
          >
            {["book", "course", "video", "article", "notes", "past_paper", "other"].map((x) => (
              <option key={x} value={x}>
                {x.replace("_", " ")}
              </option>
            ))}
          </select>
          <F l="Chapters or units (optional)">
            <Input
              type="number"
              min={1}
              value={res.total_units}
              onChange={(e) => setRes({ ...res, total_units: e.target.value })}
            />
          </F>
          <F l="Your study notes (optional, used to write questions)" c="md:col-span-3">
            <Textarea
              maxLength={20000}
              value={res.content}
              onChange={(e) => setRes({ ...res, content: e.target.value })}
            />
          </F>
        </div>
        <Button
          size="sm"
          className="mt-2"
          disabled={!res.title.trim()}
          onClick={async () => {
            if (
              await ins("learning_resources", {
                title: res.title.trim(),
                kind: res.kind,
                total_units: res.total_units ? Number(res.total_units) : null,
                content: res.content.trim() || null,
              })
            )
              setRes({ title: "", kind: "book", total_units: "", content: "" });
          }}
        >
          Add resource
        </Button>
      </div>

      <div className={card}>
        <h3 className="font-medium">Add a recall question</h3>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <F l="Question">
            <Input value={q.prompt} onChange={(e) => setQ({ ...q, prompt: e.target.value })} />
          </F>
          <F l="Answer">
            <Input value={q.answer} onChange={(e) => setQ({ ...q, answer: e.target.value })} />
          </F>
          <select
            aria-label="Topic"
            className={sel}
            value={q.topic}
            onChange={(e) => setQ({ ...q, topic: e.target.value })}
          >
            <option value="">No topic</option>
            {data.topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          className="mt-2"
          disabled={!q.prompt.trim() || !q.answer.trim()}
          onClick={async () => {
            try {
              const r = await add({
                data: { goalId, topicId: q.topic || null, prompt: q.prompt, answer: q.answer },
              });
              toast.success(`First review on ${r.due}`);
              setQ({ prompt: "", answer: "", topic: "" });
              refresh();
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        >
          Add question
        </Button>
        <p className="mt-1 text-xs text-muted-foreground">
          {data.items.length} questions in total.
          {data.reviews.length > 0
            ? ` Last 30 days: ${Math.round((100 * data.reviews.filter((x) => x.correct).length) / data.reviews.length)}% recalled correctly over ${data.reviews.length} reviews.`
            : ""}
        </p>
      </div>

      <div className={card}>
        <h3 className="font-medium">Self-tests and assessments</h3>
        <ul className="mt-2 space-y-2 text-sm">
          {data.assessments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{a.title}</span>
              <span className="text-xs text-muted-foreground">
                {a.kind.replace("_", " ")}
                {a.due_on ? ` · ${a.due_on}` : ""}
              </span>
              {a.score != null ? (
                <span className="text-xs">
                  Score {a.score}%{a.evidence ? ` · ${a.evidence}` : ""}
                </span>
              ) : (
                <AssessResult
                  onSave={(score, evidence) =>
                    upd("learning_assessments", a.id, {
                      score,
                      evidence: evidence || null,
                      taken_at: new Date().toISOString(),
                    })
                  }
                />
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <F l="Assessment name">
            <Input
              className="max-w-xs"
              value={as.title}
              onChange={(e) => setAs({ ...as, title: e.target.value })}
            />
          </F>
          <select
            aria-label="Assessment type"
            className={sel}
            value={as.kind}
            onChange={(e) => setAs({ ...as, kind: e.target.value })}
          >
            <option value="self_test">Self-test</option>
            <option value="mock">Mock</option>
            <option value="exam">Exam</option>
            <option value="assignment">Assignment</option>
          </select>
          <Input
            type="date"
            className="w-auto"
            value={as.due_on}
            onChange={(e) => setAs({ ...as, due_on: e.target.value })}
          />
          <Button
            size="sm"
            disabled={!as.title.trim()}
            onClick={async () => {
              if (
                await ins("learning_assessments", {
                  title: as.title.trim(),
                  kind: as.kind,
                  due_on: as.due_on || null,
                })
              )
                setAs({ title: "", kind: "self_test", due_on: "" });
            }}
          >
            Add
          </Button>
        </div>
      </div>

      <div className={card}>
        <h3 className="font-medium">Study sessions</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Study blocks are planned from this goal's weekly time
          {deadline ? ` towards your ${deadline} deadline` : ""}. Missed sessions go back to
          planning: use Catch up on the Plan page to place them again.
        </p>
        {data.missed.length > 0 && (
          <p className="mt-2 text-sm">
            {data.missed.length} missed study session{data.missed.length > 1 ? "s" : ""} waiting to
            be re-planned.
          </p>
        )}
        <Button size="sm" variant="outline" className="mt-2" asChild>
          <Link to="/app/plan">Open Plan</Link>
        </Button>
      </div>
    </section>
  );
}

function AssessResult({ onSave }: { onSave: (score: number, evidence: string) => void }) {
  const [s, setS] = useState("");
  const [e, setE] = useState("");
  return (
    <span className="flex gap-1">
      <Input
        type="number"
        min={0}
        max={100}
        className="h-8 w-20"
        aria-label="Score (%)"
        value={s}
        onChange={(x) => setS(x.target.value)}
      />
      <Input
        aria-label="Evidence (optional)"
        className="h-8 w-40"
        value={e}
        onChange={(x) => setE(x.target.value)}
      />
      <Button
        size="sm"
        disabled={s === "" || Number(s) < 0 || Number(s) > 100}
        onClick={() => onSave(Number(s), e.trim())}
      >
        Save
      </Button>
    </span>
  );
}

function F({ l, c, children }: { l: string; c?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-muted-foreground ${c ?? ""}`}>
      <span>{l}</span>
      {children}
    </label>
  );
}
