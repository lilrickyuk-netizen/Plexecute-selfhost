import { FeatureHeader } from "@/components/FeatureHeader";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { rows } from "@/lib/rows";
import { useProfile } from "@/lib/data";
import { addDaysKey, isoDowOfKey, localDayKey, validZone, zonedInstant } from "@/lib/tz";
import { buildCalendarItems, type CalItem, type CalKind } from "@/lib/calendar-items";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/app/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar | Plexecute" },
      {
        name: "description",
        content: "Your appointments, sessions, calls and deadlines by day, week or month.",
      },
      { property: "og:title", content: "Calendar | Plexecute" },
      { property: "og:description", content: "Your whole Plexecute schedule in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CalendarPage,
});

type View = "day" | "week" | "month";
const LABEL: Record<CalKind, string> = {
  commitment: "Commitment",
  session: "Session",
  protected: "Protected time",
  call: "Call",
  deadline: "Deadline",
  milestone: "Milestone",
};
const DOT: Record<CalKind, string> = {
  commitment: "bg-foreground",
  session: "bg-execute",
  protected: "bg-execute/60",
  call: "bg-primary",
  deadline: "bg-destructive",
  milestone: "bg-muted-foreground",
};

function range(view: View, anchor: string): [string, string] {
  if (view === "day") return [anchor, anchor];
  if (view === "week") {
    const s = addDaysKey(anchor, -(isoDowOfKey(anchor) - 1));
    return [s, addDaysKey(s, 6)];
  }
  const first = anchor.slice(0, 8) + "01";
  const s = addDaysKey(first, -(isoDowOfKey(first) - 1));
  return [s, addDaysKey(s, 41)];
}
const fmt = (k: string, o: Intl.DateTimeFormatOptions) =>
  new Date(k + "T12:00:00Z").toLocaleDateString(undefined, { ...o, timeZone: "UTC" });

function CalendarPage() {
  const { data: profile } = useProfile();
  const tz = validZone(profile?.timezone);
  const today = localDayKey(new Date(), tz);
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState<string | null>(null);
  const a = anchor ?? today;
  const [from, to] = range(view, a);

  const { data: src } = useQuery({
    queryKey: ["calendar", from, to, tz],
    queryFn: async () => {
      const lo = zonedInstant(from, 0, tz).toISOString();
      const hi = zonedInstant(addDaysKey(to, 1), 0, tz).toISOString();
      const [commitments, blocks, calls, goals, milestones] = await Promise.all([
        supabase
          .from("commitments")
          .select("id,title,kind,recurrence,days,on_date,start_time,end_time,active"),
        supabase
          .from("plan_blocks")
          .select(
            "id,title,starts_at,duration_min,status,is_protected,occurrence_kind,commitment_id,domain",
          )
          .gte("starts_at", lo)
          .lt("starts_at", hi),
        supabase
          .from("scheduled_calls")
          .select("id,call_at,purpose,status")
          .gte("call_at", lo)
          .lt("call_at", hi),
        supabase.from("goals").select("id,title,deadline,status").not("deadline", "is", null),
        supabase
          .from("goal_milestones")
          .select("id,title,due_date,done_at")
          .not("due_date", "is", null),
      ]);
      return {
        commitments: rows(commitments),
        blocks: rows(blocks),
        calls: rows(calls),
        goals: rows(goals),
        milestones: rows(milestones),
      };
    },
  });
  const items = useMemo(
    () => (src ? buildCalendarItems(src, from, to, tz) : []),
    [src, from, to, tz],
  );
  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    for (const i of items) m.set(i.day, [...(m.get(i.day) ?? []), i]);
    return m;
  }, [items]);

  const step = (n: number) => {
    if (view === "day") setAnchor(addDaysKey(a, n));
    else if (view === "week") setAnchor(addDaysKey(a, 7 * n));
    else {
      const [y, mo] = a.split("-").map(Number);
      const d = new Date(Date.UTC(y!, mo! - 1 + n, 1));
      setAnchor(d.toISOString().slice(0, 10));
    }
  };
  const title =
    view === "day"
      ? fmt(a, { weekday: "long", day: "numeric", month: "long" })
      : view === "week"
        ? `${fmt(from, { day: "numeric", month: "short" })} – ${fmt(to, { day: "numeric", month: "short" })}`
        : fmt(a, { month: "long", year: "numeric" });

  return (
    <div>
      <FeatureHeader
        title="Calendar"
        icon={CalendarDays}
        description="Everything in your Plexecute plan. Anything you or the Coach add appears here."
      />

      <div className="member-calendar-toolbar">
        <div className="member-segments" role="tablist" aria-label="Calendar view">
          {(["day", "week", "month"] as View[]).map((v) => (
            <Button
              key={v}
              role="tab"
              aria-selected={view === v}
              variant="ghost"
              size="sm"
              className="rounded-[10px] capitalize"
              onClick={() => setView(v)}
            >
              {v}
            </Button>
          ))}
        </div>
        <div>
          <Button variant="ghost" size="icon" aria-label="Previous" onClick={() => step(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-[10px]"
            onClick={() => setAnchor(null)}
          >
            Today
          </Button>
          <Button variant="ghost" size="icon" aria-label="Next" onClick={() => step(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <h2 className="mt-4 text-lg font-semibold">{title}</h2>

      {view === "month" ? (
        <div className="mt-3 grid grid-cols-7 gap-1 text-xs">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="pb-1 text-center text-muted-foreground">
              {d}
            </div>
          ))}
          {Array.from({ length: 42 }, (_, i) => addDaysKey(from, i)).map((k) => {
            const list = byDay.get(k) ?? [];
            const inMonth = k.slice(0, 7) === a.slice(0, 7);
            return (
              <Button
                variant="ghost"
                key={k}
                data-day={k}
                onClick={() => {
                  setAnchor(k);
                  setView("day");
                }}
                className={`min-h-20 flex-col items-start justify-start gap-0 border border-border p-2 text-left ${inMonth ? "bg-card" : "opacity-50"} ${k === today ? "ring-2 ring-execute" : ""}`}
              >
                <div className="font-medium">{Number(k.slice(8))}</div>
                <div className="mt-1 flex flex-wrap gap-0.5">
                  {list.slice(0, 6).map((i) => (
                    <span
                      key={i.id}
                      title={i.title}
                      className={`h-1.5 w-1.5 rounded-full ${DOT[i.kind]}`}
                    />
                  ))}
                </div>
                {list.length > 0 && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{list.length}</div>
                )}
              </Button>
            );
          })}
        </div>
      ) : (
        <div className={view === "week" ? "member-calendar-days" : "mt-5"}>
          {Array.from({ length: view === "day" ? 1 : 7 }, (_, i) => addDaysKey(from, i)).map(
            (k) => (
              <DayList
                key={k}
                day={k}
                items={byDay.get(k) ?? []}
                today={k === today}
                showHeading={view === "week"}
              />
            ),
          )}
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Add or change fixed times on{" "}
        <Link to="/app/commitments" className="underline">
          Commitments
        </Link>
        , or just tell the Coach.
      </p>
    </div>
  );
}

function DayList({
  day,
  items,
  today,
  showHeading,
}: {
  day: string;
  items: CalItem[];
  today: boolean;
  showHeading: boolean;
}) {
  return (
    <section
      data-day={day}
      aria-label={fmt(day, { weekday: "long", day: "numeric", month: "long" })}
    >
      {showHeading && (
        <h3 className={`text-sm font-medium ${today ? "text-execute" : "text-muted-foreground"}`}>
          {fmt(day, { weekday: "long", day: "numeric", month: "short" })}
        </h3>
      )}
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Nothing scheduled.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border overflow-hidden rounded-[16px] border border-border bg-card">
          {items.map((i) => (
            <li key={i.id} data-entry={i.id} className="flex items-start gap-3 p-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[i.kind]}`} />
              <div className="w-24 shrink-0 text-sm tabular-nums text-muted-foreground">
                {i.start ? `${i.start}${i.end ? `–${i.end}` : ""}` : "All day"}
              </div>
              <div className="min-w-0">
                <div
                  className={`text-sm font-medium ${i.status === "done" ? "line-through opacity-60" : ""}`}
                >
                  {i.title}
                </div>
                <div className="text-xs text-muted-foreground">
                  {LABEL[i.kind]}
                  {i.status && i.status !== "planned" && i.status !== "scheduled"
                    ? ` · ${i.status.replace(/_/g, " ")}`
                    : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
