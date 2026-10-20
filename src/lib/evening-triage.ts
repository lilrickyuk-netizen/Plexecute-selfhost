// Pure evening triage: rank tonight's open items and fit them into the real free minutes. Deterministic.
export type TriageItem = {
  id: string;
  title: string;
  start: number; // minutes from local midnight
  minutes: number;
  isProtected: boolean;
  goalPriority: number | null; // 1–5, higher = more important (goals.ts ordering)
  deadlineDays: number | null;
  onMission: boolean;
  kind: string;
};

export type TriageResult = {
  freeMinutes: number;
  plannedMinutes: number;
  keep: (TriageItem & { newStart: number; reason: string })[];
  move: (TriageItem & { reason: string })[];
};

const BREAK = 5;

function freeSlots(start: number, end: number, busy: [number, number][]): [number, number][] {
  let out: [number, number][] = [[start, end]];
  for (const [ba, bb] of busy)
    out = out.flatMap(([a, b]) => {
      if (bb <= a || ba >= b) return [[a, b] as [number, number]];
      const r: [number, number][] = [];
      if (ba - a >= 10) r.push([a, ba]);
      if (b - bb >= 10) r.push([bb, b]);
      return r;
    });
  return out;
}

export function rankScore(i: TriageItem): number {
  let s = 0;
  if (i.isProtected) s += 1000;
  if (i.deadlineDays != null) s += Math.max(0, 300 - i.deadlineDays * 20);
  if (i.goalPriority != null) s += i.goalPriority * 20;
  if (i.onMission) s += 50;
  return s;
}

function reasonFor(i: TriageItem): string {
  if (i.isProtected) return "protected entry";
  if (i.deadlineDays != null && i.deadlineDays <= 3) return `deadline in ${i.deadlineDays} day(s)`;
  if (i.onMission) return "part of your active goal mission";
  if (i.goalPriority != null && i.goalPriority >= 4) return "high-priority goal";
  return "fits after higher priorities";
}

export function triageEvening(
  items: TriageItem[],
  w: { startMin: number; endMin: number; busy: [number, number][] },
): TriageResult {
  const slots = freeSlots(w.startMin, w.endMin, w.busy);
  const freeMinutes = slots.reduce((n, [a, b]) => n + (b - a), 0);
  const ranked = [...items].sort((a, b) => rankScore(b) - rankScore(a) || a.start - b.start);
  const keepIds = new Set<string>();
  let used = 0;
  for (const i of ranked) {
    if (used + i.minutes + (keepIds.size ? BREAK : 0) <= freeMinutes) {
      keepIds.add(i.id);
      used += i.minutes + (keepIds.size > 1 ? BREAK : 0);
    }
  }
  // Place kept items in original order inside free slots, never before now or over commitments.
  const keptInOrder = items.filter((i) => keepIds.has(i.id)).sort((a, b) => a.start - b.start);
  const keep: TriageResult["keep"] = [];
  const move: TriageResult["move"] = [];
  const free = slots.map(([a, b]) => [a, b] as [number, number]);
  for (const i of keptInOrder) {
    const want = Math.max(i.start, w.startMin);
    let placed: number | null = null;
    for (const s of free) {
      const st = Math.max(s[0], want <= s[1] - i.minutes ? want : s[0]);
      if (st + i.minutes <= s[1]) {
        placed = st;
        s[0] = st + i.minutes + BREAK;
        break;
      }
    }
    if (placed == null) move.push({ ...i, reason: "no free gap left tonight" });
    else keep.push({ ...i, newStart: placed, reason: reasonFor(i) });
  }
  for (const i of items)
    if (!keepIds.has(i.id)) move.push({ ...i, reason: "lower priority than what fits tonight" });
  keep.sort((a, b) => a.newStart - b.newStart);
  return {
    freeMinutes,
    plannedMinutes: items.reduce((n, i) => n + i.minutes, 0),
    keep,
    move,
  };
}
