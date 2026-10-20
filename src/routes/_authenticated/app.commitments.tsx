import { FeatureHeader } from "@/components/FeatureHeader";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { uid } from "@/lib/data";
import { proposeWeekPlan } from "@/lib/planning.functions";
import { Button } from "@/components/ui/button";
import { ScheduledCalls } from "@/components/ScheduledCalls";
import { scheduleCommitmentCall, cancelCommitmentCalls } from "@/lib/commitment-calls.functions";
import { Phone, CalendarClock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/commitments")({
  validateSearch: (search: Record<string, unknown>): { item?: string } => ({
    ...(typeof search["item"] === "string" ? { item: search["item"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Commitments | Plexecute" },
      {
        name: "description",
        content: "Shifts, meetings, appointments and family time your plan works around.",
      },
      { property: "og:title", content: "Commitments | Plexecute" },
      {
        property: "og:description",
        content: "Shifts, meetings, appointments and family time your plan works around.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Commitments,
});

const KINDS = [
  ["shift", "Work shift"],
  ["meeting", "Meeting"],
  ["appointment", "Appointment"],
  ["family", "Family / care"],
  ["study", "Class / study"],
  ["travel", "Travel / commute"],
  ["other", "Other"],
] as const;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Draft = {
  title: string;
  kind: string;
  recurrence: "weekly" | "once";
  days: number[];
  on_date: string;
  start_time: string;
  end_time: string;
  note: string;
  call: boolean;
  lead: number;
};
const blank: Draft = {
  title: "",
  kind: "meeting",
  recurrence: "weekly",
  days: [1],
  on_date: "",
  start_time: "09:00",
  end_time: "10:00",
  note: "",
  call: false,
  lead: 30,
};
const LEADS = [10, 15, 30, 60, 120];
const leadLabel = (m: number) =>
  m >= 60 ? `${m / 60} hour${m > 60 ? "s" : ""} before` : `${m} min before`;

function Commitments() {
  const { item } = Route.useSearch();
  const qc = useQueryClient();
  const propose = useServerFn(proposeWeekPlan);
  const bookCall = useServerFn(scheduleCommitmentCall);
  const cancelCalls = useServerFn(cancelCommitmentCalls);
  const [callFor, setCallFor] = useState<{ id: string; lead: number } | null>(null);
  const [d, setD] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: rows = [] } = useQuery({
    queryKey: ["commitments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("commitments").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
  });

  async function after(msg: string) {
    qc.invalidateQueries({ queryKey: ["commitments"] });
    try {
      await propose({ data: { trigger: "calendar_change" } });
      qc.invalidateQueries({ queryKey: ["plan-proposal"] });
      toast.success(`${msg} A new plan is waiting for your approval on Plan.`);
    } catch {
      toast.success(msg);
    }
  }

  async function save() {
    if (!d) return;
    if (!d.title.trim()) {
      toast.error("Give it a name.");
      return;
    }
    if (d.end_time <= d.start_time) {
      toast.error("End time must be after the start time.");
      return;
    }
    if (d.recurrence === "weekly" && !d.days.length) {
      toast.error("Pick at least one day.");
      return;
    }
    if (d.recurrence === "once" && !d.on_date) {
      toast.error("Pick a date.");
      return;
    }
    setBusy(true);
    const { data: saved, error } = await supabase
      .from("commitments")
      .insert({
        user_id: await uid(),
        title: d.title.trim().slice(0, 120),
        kind: d.kind,
        recurrence: d.recurrence,
        days: d.recurrence === "weekly" ? d.days : [],
        on_date: d.recurrence === "once" ? d.on_date : null,
        start_time: d.start_time,
        end_time: d.end_time,
        note: d.note.trim().slice(0, 300) || null,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (d.call && saved) await call(saved.id, d.lead);
    setD(null);
    after("Commitment saved.");
  }

  async function call(id: string, lead: number) {
    try {
      const r = await bookCall({ data: { commitment_id: id, lead_minutes: lead } });
      qc.invalidateQueries({ queryKey: ["scheduled-calls"] });
      const ready = r.calls_will_ring;
      toast.success(
        `Accountability call booked${r.calls > 1 ? ` for the next ${r.calls}` : ""}.` +
          (ready ? "" : " Verify your phone and allow calls in Reminders so it can ring."),
      );
      setCallFor(null);
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      toast.error(
        /capab|plan|upgrade|forbid/i.test(m)
          ? "Accountability calls come with Pro and Execute."
          : m || "Couldn't book the call.",
      );
    }
  }
  async function noCall(id: string) {
    await cancelCalls({ data: { commitment_id: id } });
    qc.invalidateQueries({ queryKey: ["scheduled-calls"] });
    toast.success("Calls for this commitment cancelled.");
  }

  async function toggle(id: string, active: boolean) {
    const { error } = await supabase.from("commitments").update({ active }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    after(active ? "Commitment back on." : "Commitment paused.");
  }
  async function remove(id: string) {
    const { error } = await supabase.from("commitments").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    after("Commitment removed.");
  }

  const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
  const displayed = item ? rows.filter((c) => c.id === item) : rows;
  return (
    <div className="space-y-6">
      <header>
        <FeatureHeader
          title="Commitments"
          icon={CalendarClock}
          description="Shifts, meetings, appointments, family time and anything else fixed. Your plan never puts a session on top of these, and leaves 15 minutes either side."
        />
      </header>
      {!item && <ScheduledCalls />}
      {item && (
        <Link to="/app/commitments" search={{}} className="text-sm text-execute">
          All commitments
        </Link>
      )}

      {!d && !item && <Button onClick={() => setD(blank)}>Add a commitment</Button>}
      {d && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <input
            className={input}
            placeholder="e.g. Team stand-up, School run"
            value={d.title}
            maxLength={120}
            onChange={(e) => setD({ ...d, title: e.target.value })}
          />
          <select
            className={input}
            value={d.kind}
            onChange={(e) => setD({ ...d, kind: e.target.value })}
          >
            {KINDS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            {(["weekly", "once"] as const).map((r) => (
              <Button
                key={r}
                type="button"
                size="sm"
                variant={d.recurrence === r ? "default" : "outline"}
                onClick={() => setD({ ...d, recurrence: r })}
              >
                {r === "weekly" ? "Every week" : "One date"}
              </Button>
            ))}
          </div>
          {d.recurrence === "weekly" ? (
            <div className="flex flex-wrap gap-1">
              {DAYS.map((n, i) => {
                const v = i + 1;
                const on = d.days.includes(v);
                return (
                  <Button
                    key={n}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    onClick={() =>
                      setD({
                        ...d,
                        days: on ? d.days.filter((x) => x !== v) : [...d.days, v].sort(),
                      })
                    }
                  >
                    {n}
                  </Button>
                );
              })}
            </div>
          ) : (
            <input
              type="date"
              className={input}
              value={d.on_date}
              onChange={(e) => setD({ ...d, on_date: e.target.value })}
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">
              Starts
              <input
                type="time"
                className={input}
                value={d.start_time}
                onChange={(e) => setD({ ...d, start_time: e.target.value })}
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Ends
              <input
                type="time"
                className={input}
                value={d.end_time}
                onChange={(e) => setD({ ...d, end_time: e.target.value })}
              />
            </label>
          </div>
          <div className="rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={d.call}
                onChange={(e) => setD({ ...d, call: e.target.checked })}
              />
              <Phone className="h-3.5 w-3.5 text-execute" /> Plexecute calls me before this
            </label>
            {d.call && (
              <select
                aria-label="When to call"
                className={`${input} mt-2`}
                value={d.lead}
                onChange={(e) => setD({ ...d, lead: Number(e.target.value) })}
              >
                {LEADS.map((m) => (
                  <option key={m} value={m}>
                    {leadLabel(m)}
                  </option>
                ))}
              </select>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Pro and Execute. Weekly commitments get a call before each one for the next 4 weeks.
            </p>
          </div>
          <input
            className={input}
            placeholder="Note (optional)"
            maxLength={300}
            value={d.note}
            onChange={(e) => setD({ ...d, note: e.target.value })}
          />
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="ghost" onClick={() => setD(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <ul className="space-y-2">
        {displayed.length === 0 && (
          <li className="text-sm text-muted-foreground">
            {item
              ? "This item is no longer available."
              : "No commitments yet. Your working hours from Settings are already respected."}
          </li>
        )}
        {displayed.map((c) => (
          <li
            key={c.id}
            className={`min-w-0 rounded-lg border border-border bg-card p-4 ${c.active ? "" : "opacity-60"}`}
          >
            <div className="grid min-w-0 gap-4">
              <div className="min-w-0">
                <p className="break-words font-medium">{c.title}</p>
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {KINDS.find(([v]) => v === c.kind)?.[1]} ·{" "}
                  {c.recurrence === "weekly"
                    ? c.days.map((x: number) => DAYS[x - 1]).join(", ")
                    : c.on_date}{" "}
                  · {c.start_time.slice(0, 5)}–{c.end_time.slice(0, 5)}
                </p>
                {c.note && (
                  <p className="mt-1 break-words text-xs text-muted-foreground">{c.note}</p>
                )}
              </div>
              <div className="grid grid-cols-3 items-center gap-2 border-t border-border pt-3">
                {c.active && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCallFor(callFor?.id === c.id ? null : { id: c.id, lead: 30 })}
                  >
                    <Phone className="h-3.5 w-3.5 shrink-0" /> Call me
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => toggle(c.id, !c.active)}>
                  {c.active ? "Pause" : "Resume"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(c.id)}>
                  Remove
                </Button>
              </div>
            </div>
            {callFor?.id === c.id && (
              <div className="mt-3 grid grid-cols-2 items-center gap-2 border-t border-border pt-3">
                <select
                  aria-label="When to call"
                  className="col-span-2 min-w-0 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={callFor.lead}
                  onChange={(e) => setCallFor({ id: c.id, lead: Number(e.target.value) })}
                >
                  {LEADS.map((m) => (
                    <option key={m} value={m}>
                      {leadLabel(m)}
                    </option>
                  ))}
                </select>
                <Button size="sm" onClick={() => call(c.id, callFor.lead)}>
                  Book call
                </Button>
                <Button size="sm" variant="ghost" onClick={() => noCall(c.id)}>
                  Cancel its calls
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        See everything together on your{" "}
        <Link to="/app/calendar" className="underline">
          Calendar
        </Link>
        .
      </p>
    </div>
  );
}
