// Recovery Mode (V3 §21): deterministic repair of a disrupted day. Pure maths on minutes-from-local-midnight.
// Steps: freeze → capture event → remaining time → must-do → scale/move optional → protect sleep → solve → diff.
export const RECOVERY_MODE_VERSION = "recovery-mode-v1";

export const DISRUPTION_REASONS = {
  ill: "Feeling unwell",
  overran: "Work or a meeting overran",
  family: "Family or care need",
  travel: "Travel delay",
  low_energy: "Low energy or poor sleep",
  emergency: "Something urgent came up",
  other: "Something else",
} as const;
export type DisruptionReason = keyof typeof DISRUPTION_REASONS;

export type DayBlock = {
  id: string;
  goal_id: string | null;
  title: string;
  domain: string;
  start: number;
  duration: number;
  status: string;
  is_protected: boolean;
  source_type: string;
};
export type DayGoal = {
  id: string;
  priority: number;
  is_protected: boolean;
  deadline: string | null;
};
export type RepairInput = {
  nowMin: number;
  blockedUntilMin: number;
  sleepMin: number;
  wakeMin: number;
  busy: [number, number][]; // commitments (already buffered)
  blocks: DayBlock[];
  goals: DayGoal[];
  todayKey: string;
  reason: DisruptionReason;
};
export type RepairAction = "frozen" | "kept" | "moved" | "shortened" | "deferred";
export type RepairItem = {
  id: string;
  goal_id: string | null;
  title: string;
  domain: string;
  action: RepairAction;
  mustDo: boolean;
  fromStart: number;
  fromDuration: number;
  toStart: number | null;
  toDuration: number | null;
  why: string;
};

const OPEN = ["planned", "scheduled", "upcoming", "due", "contacting", "acknowledged", "snoozed"];
const FROZEN = ["done", "partial", "started", "in_progress", "safety_stopped"];
const BUFFER = 10;
const SLEEP_GUARD = 60; // keep the last hour before bed free
const HARD_GUARD = 180; // no hard exercise within 3h of bed
const MIN_SCALED = 15;
const HARD = new Set(["training", "cardio"]);

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
}

export function isMustDo(b: DayBlock, g: DayGoal | undefined, todayKey: string): boolean {
  if (b.is_protected || g?.is_protected) return true;
  if (g?.deadline && daysBetween(todayKey, g.deadline) <= 7) return true;
  return (g?.priority ?? 9) <= 1;
}

export function repairDay(inp: RepairInput): { items: RepairItem[]; availableMin: number } {
  const goals = new Map(inp.goals.map((g) => [g.id, g]));
  const earliest = Math.max(inp.nowMin + 5, inp.blockedUntilMin);
  const dayEnd = (inp.sleepMin <= inp.wakeMin ? inp.sleepMin + 1440 : inp.sleepMin) - SLEEP_GUARD;
  const items: RepairItem[] = [];
  const used: [number, number][] = inp.busy.map(([a, b]) => [a, b]);
  const movable: DayBlock[] = [];
  for (const b of inp.blocks) {
    const base = {
      id: b.id,
      goal_id: b.goal_id,
      title: b.title,
      domain: b.domain,
      fromStart: b.start,
      fromDuration: b.duration,
      mustDo: isMustDo(b, goals.get(b.goal_id ?? ""), inp.todayKey),
    };
    const isOpen = OPEN.includes(b.status);
    // 1. Freeze finished/started work, protected sessions, commitments, routines and anything already in the past.
    if (
      FROZEN.includes(b.status) ||
      b.is_protected ||
      !b.goal_id ||
      !["goal", "makeup", "recovery", "manual"].includes(b.source_type) ||
      (isOpen && b.start < inp.nowMin && b.start + b.duration <= inp.nowMin)
    ) {
      if (isOpen || FROZEN.includes(b.status))
        items.push({
          ...base,
          action: "frozen",
          toStart: b.start,
          toDuration: b.duration,
          why: FROZEN.includes(b.status)
            ? "Already started or finished"
            : b.is_protected
              ? "Protected session"
              : !b.goal_id
                ? "Fixed commitment or routine, never changed"
                : "Already past",
        });
      if (isOpen && b.start + b.duration > inp.nowMin)
        used.push([b.start - BUFFER, b.start + b.duration + BUFFER]);
      continue;
    }
    if (!isOpen) continue;
    movable.push(b);
  }
  // 4. Must-do first, then goal priority, then original order.
  movable.sort((a, b) => {
    const ma = isMustDo(a, goals.get(a.goal_id!), inp.todayKey) ? 0 : 1,
      mb = isMustDo(b, goals.get(b.goal_id!), inp.todayKey) ? 0 : 1;
    return (
      ma - mb ||
      (goals.get(a.goal_id!)?.priority ?? 9) - (goals.get(b.goal_id!)?.priority ?? 9) ||
      a.start - b.start
    );
  });
  const free = () => {
    let ws: [number, number][] = [[earliest, dayEnd]];
    for (const [ba, bb] of used)
      ws = ws.flatMap(
        ([a, b]) =>
          (bb <= a || ba >= b
            ? [[a, b]]
            : [...(ba - a >= 5 ? [[a, ba]] : []), ...(b - bb >= 5 ? [[bb, b]] : [])]) as [
            number,
            number,
          ][],
      );
    return ws.filter(([a, b]) => b > a);
  };
  const availableMin = free().reduce((s, [a, b]) => s + (b - a), 0);
  for (const b of movable) {
    const must = isMustDo(b, goals.get(b.goal_id!), inp.todayKey);
    const base = {
      id: b.id,
      goal_id: b.goal_id,
      title: b.title,
      domain: b.domain,
      fromStart: b.start,
      fromDuration: b.duration,
      mustDo: must,
    };
    const limit = HARD.has(b.domain) ? dayEnd + SLEEP_GUARD - HARD_GUARD : dayEnd; // 6. protect sleep
    const ws = free()
      .map(([a, e]) => [a, Math.min(e, limit)] as [number, number])
      .filter(([a, e]) => e - a >= MIN_SCALED);
    const fits = (dur: number) => {
      if (b.start >= earliest && ws.some(([a, e]) => b.start >= a && b.start + dur <= e))
        return b.start; // keep time when still free
      return ws.find(([a, e]) => e - a >= dur)?.[0] ?? null;
    };
    let dur = b.duration;
    // Low energy / illness scales optional work to ~60% before trying to move it.
    if (!must && (inp.reason === "ill" || inp.reason === "low_energy"))
      dur = Math.max(MIN_SCALED, Math.round((b.duration * 0.6) / 5) * 5);
    let at = fits(dur);
    if (at == null) {
      const biggest = Math.max(0, ...ws.map(([a, e]) => e - a));
      const scaled = Math.floor(biggest / 5) * 5;
      if (scaled >= Math.max(MIN_SCALED, Math.ceil(b.duration * 0.5))) {
        dur = scaled;
        at = fits(dur);
      }
    }
    if (at == null) {
      items.push({
        ...base,
        action: "deferred",
        toStart: null,
        toDuration: null,
        why: must
          ? "Must-do, but no time left today; moved to the next free slot this week"
          : "No time left today; moved to the next free slot this week",
      });
      continue;
    }
    used.push([at - BUFFER, at + dur + BUFFER]);
    const action: RepairAction = dur < b.duration ? "shortened" : at !== b.start ? "moved" : "kept";
    items.push({
      ...base,
      action,
      toStart: at,
      toDuration: dur,
      why:
        action === "kept"
          ? "Still fits"
          : action === "moved"
            ? "Moved into remaining free time"
            : `Shortened from ${b.duration} to ${dur} min to fit`,
    });
  }
  items.sort((a, b) => (a.toStart ?? 9999) - (b.toStart ?? 9999) || a.fromStart - b.fromStart);
  return { items, availableMin };
}
