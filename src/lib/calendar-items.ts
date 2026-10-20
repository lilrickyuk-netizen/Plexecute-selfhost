// Plexecute Calendar: one read-only view built from existing records (commitments,
// plan_blocks, scheduled_calls, goals, milestones). No separate calendar data model.
import { addDaysKey, isoDowOfKey, localDayKey, localHm } from "@/lib/tz";

export type CalKind = "commitment" | "session" | "protected" | "call" | "deadline" | "milestone";

export type CalItem = {
  id: string; // stable source id so an entry can never appear twice
  day: string; // YYYY-MM-DD local
  start: string | null; // HH:MM local, null = all day
  end: string | null;
  title: string;
  kind: CalKind;
  detail?: string;
  status?: string | undefined;
};

type Commitment = {
  id: string;
  title: string;
  kind: string;
  recurrence: string;
  days: number[];
  on_date: string | null;
  start_time: string;
  end_time: string;
  active: boolean;
};
type Block = {
  id: string;
  title: string;
  starts_at: string;
  duration_min: number;
  status: string;
  is_protected: boolean;
  occurrence_kind: string;
  commitment_id: string | null;
  domain: string;
};
type Call = { id: string; call_at: string; purpose: string; status: string };
type Goal = { id: string; title: string; deadline: string | null; status: string };
type Milestone = { id: string; title: string; due_date: string | null; done_at: string | null };

const hm = (t: string) => t.slice(0, 5);

export function buildCalendarItems(
  src: {
    commitments: Commitment[];
    blocks: Block[];
    calls: Call[];
    goals: Goal[];
    milestones: Milestone[];
  },
  fromKey: string,
  toKey: string, // inclusive
  tz: string,
): CalItem[] {
  const out = new Map<string, CalItem>();
  const add = (i: CalItem) => {
    if (i.day >= fromKey && i.day <= toKey) out.set(i.id, i);
  };
  for (const c of src.commitments) {
    if (!c.active) continue;
    const base = {
      title: c.title,
      kind: "commitment" as const,
      start: hm(c.start_time),
      end: hm(c.end_time),
      detail: c.kind,
    };
    if (c.recurrence === "once") {
      if (c.on_date) add({ ...base, id: `c:${c.id}`, day: c.on_date });
    } else {
      for (let k = fromKey; k <= toKey; k = addDaysKey(k, 1)) {
        if (c.days.includes(isoDowOfKey(k))) add({ ...base, id: `c:${c.id}:${k}`, day: k });
      }
    }
  }
  for (const b of src.blocks) {
    // Commitment occurrences are already shown from the commitment itself.
    // Replaced copies ("rescheduled") are plan history, not entries: the live replacement is shown instead.
    if (
      b.commitment_id ||
      b.occurrence_kind === "commitment" ||
      b.status === "cancelled" ||
      b.status === "rescheduled"
    )
      continue;
    const s = new Date(b.starts_at);
    add({
      id: `b:${b.id}`,
      day: localDayKey(s, tz),
      start: localHm(s, tz),
      end: localHm(new Date(s.getTime() + b.duration_min * 60000), tz),
      title: b.title,
      kind: b.is_protected ? "protected" : "session",
      detail: b.domain,
      status: b.status,
    });
  }
  for (const c of src.calls) {
    if (c.status === "cancelled") continue;
    const s = new Date(c.call_at);
    // A reminder call for a commitment shows on that commitment ("· call booked"), not as a second line.
    const what = c.purpose
      .replace(/^Before\s+/i, "")
      .trim()
      .toLowerCase();
    const day = localDayKey(s, tz),
      at = localHm(s, tz);
    const owner = [...out.values()].find(
      (i) =>
        i.kind === "commitment" &&
        i.day === day &&
        i.start === at &&
        i.title.toLowerCase() === what,
    );
    if (owner) {
      owner.status =
        c.status === "placed" || c.status === "completed" ? "call made" : "call booked";
      continue;
    }
    add({
      id: `k:${c.id}`,
      day: localDayKey(s, tz),
      start: localHm(s, tz),
      end: null,
      title: `Call: ${c.purpose}`,
      kind: "call",
      status: c.status,
    });
  }
  for (const g of src.goals) {
    if (g.deadline && g.status === "active")
      add({
        id: `g:${g.id}`,
        day: g.deadline.slice(0, 10),
        start: null,
        end: null,
        title: `Deadline: ${g.title}`,
        kind: "deadline",
      });
  }
  for (const m of src.milestones) {
    if (m.due_date)
      add({
        id: `m:${m.id}`,
        day: m.due_date.slice(0, 10),
        start: null,
        end: null,
        title: m.title,
        kind: "milestone",
        status: m.done_at ? "done" : undefined,
      });
  }
  // Same title at the same time on the same day is one entry, whatever produced it.
  const seen = new Set<string>();
  const unique = [...out.values()].filter((i) => {
    const k = `${i.day}|${i.start ?? ""}|${i.kind === "protected" ? "session" : i.kind}|${i.title.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return unique.sort((a, b) => (a.day + (a.start ?? "")).localeCompare(b.day + (b.start ?? "")));
}
