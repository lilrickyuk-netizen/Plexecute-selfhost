import { addDaysKey, diffDaysKey, weekKeyOf, zonedInstant, zonedParts } from "./tz";
// Deterministic weekly planner. Same inputs always produce the same plan.
// Places goal sessions into free windows (wake→sleep minus work), with buffers.

export type Domain =
  | "training"
  | "cardio"
  | "mobility"
  | "nutrition"
  | "sleep"
  | "learning"
  | "career"
  | "wellness"
  | "work_prep"
  | "meal_prep"
  | "admin"
  | "other";

export const DOMAINS: { value: Domain; label: string }[] = [
  { value: "training", label: "Strength training" },
  { value: "cardio", label: "Cardio" },
  { value: "mobility", label: "Yoga / mobility" },
  { value: "nutrition", label: "Nutrition" },
  { value: "sleep", label: "Sleep / recovery" },
  { value: "learning", label: "Learning" },
  { value: "career", label: "Career / projects" },
  { value: "wellness", label: "Wellness / meditation" },
  { value: "work_prep", label: "Work & meeting preparation" },
  { value: "meal_prep", label: "Meal planning & prep" },
  { value: "admin", label: "Household & personal admin" },
  { value: "other", label: "Other" },
];

export type ScheduleProfile = {
  wake_time: string;
  sleep_time: string;
  work_start: string | null;
  work_end: string | null;
  work_days: number[]; // 1=Mon ... 7=Sun
  commitments?: ScheduleCommitment[];
  timezone?: string | null; // IANA zone; all day/time maths uses it
};

/** Fixed life commitments (shifts, meetings, appointments, family, study, travel) the planner must never overlap. */
export type ScheduleCommitment = {
  recurrence: string; // weekly | once
  days: number[]; // ISO 1..7 for weekly
  on_date: string | null; // YYYY-MM-DD for once
  start_time: string;
  end_time: string;
  active?: boolean;
};

const COMMIT_BUFFER = 15;

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Busy intervals (minutes from midnight, buffered) for a given day. */
export function commitmentBusy(
  cs: ScheduleCommitment[] | undefined,
  isoDow: number,
  day: Date | string,
): [number, number][] {
  const key = typeof day === "string" ? day : dateKey(day);
  return (cs ?? [])
    .filter(
      (c) =>
        c.active !== false &&
        (c.recurrence === "weekly" ? c.days.includes(isoDow) : c.on_date === key),
    )
    .map(
      (c) =>
        [(toMin(c.start_time) ?? 0) - COMMIT_BUFFER, (toMin(c.end_time) ?? 0) + COMMIT_BUFFER] as [
          number,
          number,
        ],
    );
}

function subtract(ws: [number, number][], busy: [number, number][]): [number, number][] {
  let out = ws;
  for (const [ba, bb] of busy) {
    out = out.flatMap(([a, b]) => {
      if (bb <= a || ba >= b) return [[a, b] as [number, number]];
      const r: [number, number][] = [];
      if (ba - a >= 10) r.push([a, ba]);
      if (b - bb >= 10) r.push([bb, b]);
      return r;
    });
  }
  return out;
}

export type ScheduleGoal = {
  id: string;
  title: string;
  domain: string;
  weekly_minutes: number;
  session_minutes: number;
  preferred_time: string; // morning | midday | evening | any
  priority?: number;
  deadline?: string | null;
  minimum_weekly_minutes?: number;
  is_protected?: boolean | null;
  /** ISO weekdays (1=Mon..7=Sun) the member asked for, e.g. Monday to Friday. Sessions go only on these days. */
  preferred_days?: number[] | null;
  /** Exact start time asked for ("HH:MM"), e.g. 07:00. Slots away from it cost more. */
  preferred_start?: string | null;
};

export type PlannedBlock = {
  goal_id: string;
  title: string;
  domain: string;
  starts_at: string;
  duration_min: number;
};

export type PlanResult = {
  blocks: PlannedBlock[];
  unplaced: { goal_id: string; title: string; minutes: number }[];
  capacityMin: number;
  demandMin: number;
};

const BUFFER = 15;
const SLOT_MINUTES = 5;
const RESILIENCE_RATIO = 0.1;

export function toMin(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m || 0);
}

/** Local Monday 00:00 (in `tz`) of the week containing `d`. */
export function startOfWeek(d: Date, tz?: string | null): Date {
  return zonedInstant(weekKeyOf(d, tz), 0, tz);
}

type Window = [number, number];

function freeWindows(
  p: ScheduleProfile,
  isoDow: number,
  day?: Date | string,
  wakeLead = 30,
): Window[] {
  const base = baseWindows(p, isoDow, wakeLead);
  return day ? subtract(base, commitmentBusy(p.commitments, isoDow, day)) : base;
}

function baseWindows(p: ScheduleProfile, isoDow: number, wakeLead = 30): Window[] {
  const wake = (toMin(p.wake_time) ?? 420) + wakeLead;
  let sleep = (toMin(p.sleep_time) ?? 1380) - 60;
  if (sleep <= wake) sleep = 1439;
  const ws = toMin(p.work_start);
  const we = toMin(p.work_end);
  if (p.work_days.includes(isoDow) && ws != null && we != null && we > ws) {
    const out: Window[] = [];
    if (ws - 30 > wake) out.push([wake, ws - 30]);
    if (sleep > we + 45) out.push([we + 45, sleep]);
    return out;
  }
  return [[wake, sleep]];
}

function prefRange(pref: string): Window {
  if (pref === "morning") return [0, 720];
  if (pref === "midday") return [660, 900];
  if (pref === "evening") return [1020, 1440];
  return [0, 1440];
}

/** Inputs for the soft objectives and extra hard constraints of the optimiser. All optional. */
export type PlanOptions = {
  /** Blocks that must stay where they are (protected, completed or accepted and not being replaced). */
  fixed?: { starts_at: string; duration_min: number; domain?: string; goal_id?: string | null }[];
  /** Previously accepted placements; the optimiser prefers to keep sessions close to these (stability). */
  previous?: { goal_id: string | null; starts_at: string }[];
  /** Historical completion rate by domain and hour of day (0..1), from past sessions. */
  adherence?: Record<string, Record<number, { done: number; total: number }>>;
  /** When the person has most energy; demanding work is placed there when possible. */
  energyPeak?: "morning" | "midday" | "evening" | null;
  /** Only place sessions from this moment on (plus a 30-minute lead); earlier days and today's past hours count as no free time. */
  notBefore?: Date | string;
};

type Placement = { gi: number; d: number; t: number; dur: number };

const DEMANDING = new Set(["training", "cardio", "learning", "career", "work_prep"]);
const INTENSE = new Set(["training", "cardio"]);
const INTENSE_SLEEP_GAP = 30; // extra minutes before the sleep wind-down for hard exercise (safety)
const MAX_PASSES = 4;

function hourRange(peak: string): Window {
  return peak === "morning" ? [0, 720] : peak === "midday" ? [660, 1020] : [1020, 1440];
}

/**
 * Deterministic constraint optimiser (V3 step 10).
 * Hard: free windows only (sleep, work, commitments, routines removed), fixed blocks kept, no overlap with
 * transition buffers, resilience reserve, deadline days, one session per goal per day, 48h between strength
 * sessions of the same goal (when spacing is possible), no hard exercise right before sleep.
 * Soft (weighted cost): placement stability, preferred time, historical adherence, energy fit, deadline
 * earliness, fragmentation and context switching. Construction in priority order, then repair of unplaced
 * sessions by relocating lower-priority ones, then local-improvement passes. Same inputs give the same plan.
 */
export function buildWeekPlan(
  p: ScheduleProfile,
  goals: ScheduleGoal[],
  weekStart: Date,
  opts: PlanOptions = {},
): PlanResult {
  const tz = p.timezone;
  const wk = zonedParts(weekStart, tz).key;
  const days: Window[][] = [];
  // Exact times the member chose (e.g. "train at 7am") may start right at wake time and use the
  // resilience reserve; work, commitments, sleep and notBefore still apply.
  const pinnedWindows: Window[][] = [];
  let capacityMin = 0;
  const nb = opts.notBefore ? zonedParts(opts.notBefore, tz) : null;
  const nbIdx = nb ? diffDaysKey(nb.key, wk) : -1;
  const clip = (w: Window[], i: number): Window[] =>
    nb && i < nbIdx
      ? []
      : nb && i === nbIdx
        ? w.map(([a, b]) => [Math.max(a, nb.minutes + 30), b] as Window).filter(([a, b]) => b > a)
        : w;
  for (let i = 0; i < 7; i++) {
    const w = clip(freeWindows(p, i + 1, addDaysKey(wk, i)), i);
    pinnedWindows.push(clip(freeWindows(p, i + 1, addDaysKey(wk, i), 0), i));
    days.push(w);
    capacityMin += Math.floor(w.reduce((s, [a, b]) => s + (b - a), 0) * (1 - RESILIENCE_RATIO));
  }
  // Each free window loses its resilience share at the end.
  const usable: Window[][] = days.map((ws) =>
    ws
      .map(([a, b]) => [a, b - Math.floor((b - a) * RESILIENCE_RATIO)] as Window)
      .filter(([a, b]) => b > a),
  );
  // Bedtimes at or after midnight wrap to the end of the day, matching baseWindows.
  const sleepRawPlan = toMin(p.sleep_time) ?? 1380;
  const sleepEnd = sleepRawPlan <= (toMin(p.wake_time) ?? 420) ? 1439 : sleepRawPlan - 60;

  const fixedUsed: Window[][] = days.map(() => []);
  const fixedDomains: string[][] = days.map(() => []);
  // Days already holding a kept or finished session of each goal (one per goal per day, strength spacing).
  const fixedGoalDays = new Map<string, number[]>();
  for (const f of opts.fixed ?? []) {
    const zp = zonedParts(f.starts_at, tz);
    const d = diffDaysKey(zp.key, wk);
    if (d < 0 || d > 6) continue;
    const m = zp.minutes;
    fixedUsed[d]!.push([m - BUFFER, m + f.duration_min + BUFFER]);
    if (f.domain) fixedDomains[d]!.push(f.domain);
    if (f.goal_id) fixedGoalDays.set(f.goal_id, [...(fixedGoalDays.get(f.goal_id) ?? []), d]);
  }
  const prevByGoal = new Map<string, { d: number; t: number }[]>();
  for (const pv of opts.previous ?? []) {
    if (!pv.goal_id) continue;
    const zp = zonedParts(pv.starts_at, tz);
    const d = zp.isoDow - 1;
    const arr = prevByGoal.get(pv.goal_id) ?? [];
    arr.push({ d, t: zp.minutes });
    prevByGoal.set(pv.goal_id, arr);
  }

  // An exact time the member asked for is placed first, then weekday-only requests, then flexible goals.
  const pinTier = (g: ScheduleGoal) => (g.preferred_start ? 2 : g.preferred_days?.length ? 1 : 0);
  const sorted = [...goals].sort(
    (a, b) =>
      Number(!!b.is_protected) - Number(!!a.is_protected) ||
      pinTier(b) - pinTier(a) ||
      (b.priority ?? 3) - (a.priority ?? 3) ||
      // Exact times are placed in chronological order, so "train at 7, then business" keeps 7:00 for training
      // and the later request moves later rather than taking an earlier member-chosen slot.
      (toMin(a.preferred_start ?? null) ?? 0) - (toMin(b.preferred_start ?? null) ?? 0) ||
      (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") ||
      b.session_minutes - a.session_minutes ||
      a.id.localeCompare(b.id),
  );
  // Session count uses the real session length (short wellness sessions count fully); capped at two a day.
  const sessionsOf = (g: ScheduleGoal) =>
    Math.min(14, Math.max(1, Math.ceil(g.weekly_minutes / Math.max(1, g.session_minutes))));
  const deadlineDay = (g: ScheduleGoal) => {
    if (!g.deadline) return 6;
    return Math.min(6, diffDaysKey(g.deadline.slice(0, 10), wk));
  };

  const placed: Placement[] = [];
  // Per-day caches of occupied intervals and domain sets; rebuilt lazily after any change.
  const occCache: (Window[] | null)[] = days.map(() => null);
  const domCache: (Set<string> | null)[] = days.map(() => null);
  // Per-goal caches of that goal's placed days; rebuilt lazily.
  const mineCache = new Map<number, Placement[] | null>();
  const touch = (d: number, gi?: number) => {
    occCache[d] = null;
    domCache[d] = null;
    if (gi != null) mineCache.set(gi, null);
  };
  const occupied = (d: number, skip?: Placement): Window[] => {
    if (!skip && occCache[d]) return occCache[d]!;
    const out: Window[] = [
      ...fixedUsed[d]!,
      ...placed
        .filter((x) => x.d === d && x !== skip)
        .map((x) => [x.t - BUFFER, x.t + x.dur + BUFFER] as Window),
    ];
    if (!skip) occCache[d] = out;
    return out;
  };
  const mineOf = (gi: number, skip?: Placement): Placement[] => {
    let m = mineCache.get(gi);
    if (m == null) {
      m = placed.filter((x) => x.gi === gi);
      mineCache.set(gi, m);
    }
    return skip ? m.filter((x) => x !== skip) : m;
  };
  const dayDomains = (d: number, skip?: Placement): Set<string> => {
    if (!skip && domCache[d]) return domCache[d]!;
    const s = new Set([
      ...fixedDomains[d]!,
      ...placed.filter((x) => x.d === d && x !== skip).map((x) => sorted[x.gi]!.domain),
    ]);
    if (!skip) domCache[d] = s;
    return s;
  };

  function cost(gi: number, d: number, t: number, dur: number, skip?: Placement): number {
    const g = sorted[gi]!;
    let c = 0;
    const [pa, pb] = prefRange(g.preferred_time);
    if (t < pa || t + dur > pb) c += 30;
    // "Morning" means early (e.g. straight after waking, before breakfast): later morning slots cost a little more.
    if (g.preferred_time === "morning") c += (Math.max(0, t - 420) / 60) * 5;
    const ps = toMin(g.preferred_start ?? null);
    if (ps != null) c += Math.abs(t - ps); // an exact time the member asked for dominates soft preferences
    const prev = prevByGoal.get(g.id);
    if (prev?.length)
      c += Math.min(
        40,
        Math.min(...prev.map((v) => Math.abs(v.d - d) * 10 + Math.abs(v.t - t) / 15)),
      );
    const rec = opts.adherence?.[g.domain]?.[Math.floor(t / 60)];
    if (rec && rec.total >= 2) c += (1 - rec.done / rec.total) * 20;
    if (opts.energyPeak && DEMANDING.has(g.domain)) {
      const [ea, eb] = hourRange(opts.energyPeak);
      if (t < ea || t >= eb) c += 8;
    }
    if (g.deadline && deadlineDay(g) < 6) c += d * 2;
    // Spread a goal's sessions; strength needs recovery between sessions.
    const mine = mineOf(gi, skip);
    if (mine.some((x) => Math.abs(x.d - d) === 1)) c += INTENSE.has(g.domain) ? 10 : 4;
    // Fragmentation: avoid leaving unusable gaps (<30 min) next to the session.
    const occ = occupied(d, skip);
    const win = usable[d]!.find(([a, b]) => t >= a && t + dur <= b) ??
      pinnedWindows[d]!.find(([a, b]) => t >= a && t + dur <= b) ?? [t, t + dur];
    let before = t - win[0];
    let after = win[1] - (t + dur);
    for (const [a, b] of occ) {
      if (b <= t) before = Math.min(before, t - b);
      if (a >= t + dur) after = Math.min(after, a - (t + dur));
    }
    if (before > 0 && before < 30) c += 6;
    if (after > 0 && after < 30) c += 6;
    // Context switching: each different life area already on that day costs a little.
    const doms = dayDomains(d, skip);
    c += (doms.has(g.domain) ? doms.size - 1 : doms.size) * 3;
    return c + d * 0.01 + t / 100000; // deterministic tie-break: earlier first
  }

  function best(
    gi: number,
    dur: number,
    skip?: Placement,
  ): { d: number; t: number; c: number } | null {
    const g = sorted[gi]!;
    const ddl = deadlineDay(g);
    const kept = fixedGoalDays.get(g.id) ?? [];
    const mine = mineOf(gi, skip);
    const mineDays = new Set(mine.map((x) => x.d));
    const allowed = g.preferred_days?.length ? new Set(g.preferred_days) : null;
    const spacing =
      !allowed && g.domain === "training" && sessionsOf(g) <= 4
        ? new Set([...mine.map((x) => x.d), ...kept])
        : null;
    const intense = INTENSE.has(g.domain);
    const ps = toMin(g.preferred_start ?? null);
    let out: { d: number; t: number; c: number } | null = null;
    for (let d = 0; d < 7; d++) {
      // Day-level rules checked once per day instead of per slot.
      if (d > ddl || mineDays.has(d) || kept.includes(d)) continue;
      if (allowed && !allowed.has(d + 1)) continue;
      if (spacing && (spacing.has(d - 1) || spacing.has(d + 1))) continue;
      // Free sub-intervals: usable windows minus occupied intervals.
      let free = usable[d]!;
      const occ = occupied(d, skip);
      // An exact time the member chose is kept exactly when it is free that day; only a real conflict
      // (work, commitment, another session, sleep) lets the session move, so no 17:55-style drift.
      if (ps != null && !(intense && ps + dur > sleepEnd - INTENSE_SLEEP_GAP)) {
        const pinFree0 = occ.length ? subtract(pinnedWindows[d]!, occ) : pinnedWindows[d]!;
        if (pinFree0.some(([a, b]) => ps >= a && ps + dur <= b)) {
          const c = cost(gi, d, ps, dur, skip);
          if (!out || c < out.c) out = { d, t: ps, c };
          continue;
        }
      }
      if (occ.length) free = subtract(free, occ);
      for (const [a, b] of free) {
        for (let t = Math.ceil(a / SLOT_MINUTES) * SLOT_MINUTES; t + dur <= b; t += SLOT_MINUTES) {
          if (intense && t + dur > sleepEnd - INTENSE_SLEEP_GAP) continue;
          const c = cost(gi, d, t, dur, skip);
          if (!out || c < out.c) out = { d, t, c };
        }
      }
      // The exact time the member asked for, even when it sits in the wake-up or reserve margin.
      if (ps != null && !(intense && ps + dur > sleepEnd - INTENSE_SLEEP_GAP)) {
        const pinFree = occ.length ? subtract(pinnedWindows[d]!, occ) : pinnedWindows[d]!;
        if (pinFree.some(([a, b]) => ps >= a && ps + dur <= b)) {
          const c = cost(gi, d, ps, dur, skip);
          if (!out || c < out.c) out = { d, t: ps, c };
        }
      }
    }
    return out;
  }

  // 1) Construction in priority order.
  const missing: { gi: number; dur: number }[] = [];
  let demandMin = 0;
  sorted.forEach((g, gi) => {
    const n = sessionsOf(g);
    demandMin += n * g.session_minutes;
    for (let s = 0; s < n; s++) {
      const b = best(gi, g.session_minutes);
      if (b) {
        placed.push({ gi, d: b.d, t: b.t, dur: g.session_minutes });
        touch(b.d, gi);
      } else missing.push({ gi, dur: g.session_minutes });
    }
  });

  // 2) Repair: free space for a higher-priority session by relocating one lower-priority session.
  for (let i = 0; i < missing.length; i++) {
    const m = missing[i]!;
    for (const victim of [...placed]
      .filter((x) => x.gi > m.gi && !sorted[x.gi]!.is_protected)
      .reverse()) {
      const idx = placed.indexOf(victim);
      placed.splice(idx, 1);
      touch(victim.d, victim.gi);
      const spot = best(m.gi, m.dur);
      if (spot) {
        const mine: Placement = { gi: m.gi, d: spot.d, t: spot.t, dur: m.dur };
        placed.push(mine);
        touch(spot.d, m.gi);
        const re = best(victim.gi, victim.dur);
        if (re) {
          placed.push({ ...victim, d: re.d, t: re.t });
          touch(re.d, victim.gi);
          missing.splice(i--, 1);
          break;
        }
        placed.splice(placed.indexOf(mine), 1);
        touch(mine.d, m.gi);
      }
      placed.splice(idx, 0, victim);
      touch(victim.d, victim.gi);
    }
  }

  // 3) Local improvement: move single sessions while total cost falls.
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let moved = false;
    for (const x of placed) {
      const now = cost(x.gi, x.d, x.t, x.dur, x);
      const b = best(x.gi, x.dur, x);
      if (b && b.c < now - 0.5) {
        touch(x.d, x.gi);
        x.d = b.d;
        x.t = b.t;
        touch(x.d, x.gi);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const blocks: PlannedBlock[] = placed.map((x) => {
    const g = sorted[x.gi]!;
    const dt = zonedInstant(addDaysKey(wk, x.d), x.t, tz);
    return {
      goal_id: g.id,
      title: g.title,
      domain: g.domain,
      starts_at: dt.toISOString(),
      duration_min: x.dur,
    };
  });
  const unplaced: PlanResult["unplaced"] = [];
  for (const m of missing) {
    const g = sorted[m.gi]!;
    const ex = unplaced.find((u) => u.goal_id === g.id);
    if (ex) ex.minutes += m.dur;
    else unplaced.push({ goal_id: g.id, title: g.title, minutes: m.dur });
  }
  blocks.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return { blocks, unplaced, capacityMin, demandMin };
}

function findSlot(free: Window[], used: Window[], dur: number, pref: Window): number | null {
  const tryRange = (range: Window): number | null => {
    for (const [a, b] of free) {
      const lo = Math.max(a, range[0]);
      const hi = Math.min(b, range[1]);
      const resilientHi = hi - Math.floor((hi - lo) * RESILIENCE_RATIO);
      for (
        let t = Math.ceil(lo / SLOT_MINUTES) * SLOT_MINUTES;
        t + dur <= resilientHi;
        t += SLOT_MINUTES
      ) {
        if (!used.some(([ua, ub]) => t < ub && t + dur > ua)) return t;
      }
    }
    return null;
  };
  return tryRange(pref) ?? tryRange([0, 1440]);
}

export function feasibility(r: PlanResult) {
  if (r.unplaced.length === 0) return { level: "fits" as const, label: "Fits your week" };
  const ratio = r.demandMin / Math.max(1, r.capacityMin);
  if (ratio > 0.6) return { level: "over" as const, label: "Overcommitted" };
  return { level: "tight" as const, label: "Tight — some sessions don't fit" };
}

export function fmtTime(iso: string, tz?: string | null) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(tz ? { timeZone: tz } : {}),
  });
}

/** Deterministic make-up placement for missed sessions (same week only, after `now`, one make-up per goal per day,
 *  respecting buffers, free windows and the resilience reserve). Never moves existing sessions. */
export function placeMakeups(
  p: ScheduleProfile,
  weekStart: Date,
  now: Date,
  existing: { starts_at: string; duration_min: number }[],
  missed: {
    goal_id: string;
    title: string;
    domain: string;
    duration_min: number;
    preferred_time?: string | undefined;
    source_id?: string;
  }[],
): { placed: (PlannedBlock & { note?: string })[]; unplaced: typeof missed } {
  const tz = p.timezone;
  const wk = zonedParts(weekStart, tz).key;
  const used: Window[][] = Array.from({ length: 7 }, () => []);
  const goalDays = new Set<string>();
  for (const b of existing) {
    const zp = zonedParts(b.starts_at, tz);
    const idx = diffDaysKey(zp.key, wk);
    if (idx < 0 || idx > 6) continue;
    const m = zp.minutes;
    used[idx]!.push([m - BUFFER, m + b.duration_min + BUFFER]);
  }
  const placed: (PlannedBlock & { note?: string })[] = [];
  const unplaced: typeof missed = [];
  const nz = zonedParts(now, tz);
  const todayIdx = Math.max(0, diffDaysKey(nz.key, wk));
  const nowMin = nz.minutes + 30;
  for (const s of missed) {
    let ok = false;
    for (let d = todayIdx; d < 7 && !ok; d++) {
      if (goalDays.has(`${s.goal_id}:${d}`)) continue;
      let free = freeWindows(p, d + 1, addDaysKey(wk, d));
      if (d === todayIdx)
        free = free.map(([a, b]) => [Math.max(a, nowMin), b] as Window).filter(([a, b]) => b > a);
      const slot = findSlot(free, used[d]!, s.duration_min, prefRange(s.preferred_time ?? "any"));
      if (slot == null) continue;
      used[d]!.push([slot - BUFFER, slot + s.duration_min + BUFFER]);
      goalDays.add(`${s.goal_id}:${d}`);
      const dt = zonedInstant(addDaysKey(wk, d), slot, tz);
      placed.push({
        goal_id: s.goal_id,
        title: s.title,
        domain: s.domain,
        starts_at: dt.toISOString(),
        duration_min: s.duration_min,
        ...(s.source_id ? { note: `makeup:${s.source_id}` } : {}),
      });
      ok = true;
    }
    if (!ok) unplaced.push(s);
  }
  return { placed, unplaced };
}

// ---------- Feasibility engine (V3 step 9) ----------
export type GoalFeasibility = {
  goal_id: string;
  title: string;
  preferred_min: number;
  minimum_min: number;
  placed_min: number;
  shortfall_vs_minimum: number;
  shortfall_vs_preferred: number;
  status: "preferred" | "minimum" | "below_minimum";
};

export type FeasibilityReport = {
  level: "feasible" | "partial" | "infeasible";
  capacity: {
    awake_min: number;
    work_min: number;
    commitments_min: number;
    routine_buffers_min: number;
    resilience_min: number;
    usable_min: number;
  };
  demand_preferred_min: number;
  demand_minimum_min: number;
  goals: GoalFeasibility[];
  shortfall_min: number;
  explanation: string;
};

function sum(ws: Window[]) {
  return ws.reduce((s, [a, b]) => s + Math.max(0, b - a), 0);
}

/** Deterministic, truthful feasibility. Never invents time: reports what actually fits and the real shortfall. */
export function feasibilityReport(
  p: ScheduleProfile,
  goals: ScheduleGoal[],
  weekStart: Date,
  notBefore?: Date | string,
): FeasibilityReport {
  let awake = 0,
    work = 0,
    commit = 0,
    routine = 0,
    resilience = 0,
    usable = 0;
  for (let i = 0; i < 7; i++) {
    const iso = i + 1;
    const day = addDaysKey(zonedParts(weekStart, p.timezone).key, i);
    const wakeRaw = toMin(p.wake_time) ?? 420;
    let sleepRaw = toMin(p.sleep_time) ?? 1380;
    if (sleepRaw <= wakeRaw) sleepRaw = 1440;
    const dayAwake = sleepRaw - wakeRaw;
    const base = baseWindows(p, iso);
    const free = freeWindows(p, iso, day);
    const ws = toMin(p.work_start),
      we = toMin(p.work_end);
    const dayWork = p.work_days.includes(iso) && ws != null && we != null && we > ws ? we - ws : 0;
    const baseMin = sum(base),
      freeMin = sum(free);
    awake += dayAwake;
    work += dayWork;
    commit += baseMin - freeMin;
    routine += dayAwake - dayWork - baseMin; // morning/evening routines + commute buffers around work
    const r = Math.ceil(freeMin * RESILIENCE_RATIO);
    resilience += r;
    usable += freeMin - r;
  }
  // The verdict comes from what the planner can really still place (from notBefore on when given).
  const plan = buildWeekPlan(p, goals, weekStart, notBefore ? { notBefore } : {});
  const placedBy = new Map<string, number>();
  for (const b of plan.blocks)
    placedBy.set(b.goal_id, (placedBy.get(b.goal_id) ?? 0) + b.duration_min);
  const rows: GoalFeasibility[] = goals.map((g) => {
    const placed = placedBy.get(g.id) ?? 0;
    const min = Math.min(g.minimum_weekly_minutes ?? 0, g.weekly_minutes);
    return {
      goal_id: g.id,
      title: g.title,
      preferred_min: g.weekly_minutes,
      minimum_min: min,
      placed_min: placed,
      shortfall_vs_minimum: Math.max(0, min - placed),
      shortfall_vs_preferred: Math.max(0, g.weekly_minutes - placed),
      status:
        placed >= g.weekly_minutes ? "preferred" : placed >= min ? "minimum" : "below_minimum",
    };
  });
  const demandPref = goals.reduce((s, g) => s + g.weekly_minutes, 0);
  const demandMin = rows.reduce((s, r) => s + r.minimum_min, 0);
  const below = rows.filter((r) => r.status === "below_minimum");
  const shortfall = below.reduce((s, r) => s + r.shortfall_vs_minimum, 0);
  const level = below.length
    ? "infeasible"
    : rows.some((r) => r.status === "minimum")
      ? "partial"
      : "feasible";
  const h = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
  const explanation =
    level === "feasible"
      ? `All goals fit at your preferred time: ${h(demandPref)} needed, ${h(usable)} usable.`
      : level === "partial"
        ? `Every goal gets at least its minimum, but not all get your preferred time. ${h(Math.max(0, demandPref - usable))} short of preferred.`
        : `Your goals don't fit this week. ${below.length} goal${below.length > 1 ? "s are" : " is"} ${h(shortfall)} short of the minimum. Lower a goal, pause one, or free up time.`;
  return {
    level,
    capacity: {
      awake_min: awake,
      work_min: work,
      commitments_min: commit,
      routine_buffers_min: routine,
      resilience_min: resilience,
      usable_min: usable,
    },
    demand_preferred_min: demandPref,
    demand_minimum_min: demandMin,
    goals: rows,
    shortfall_min: shortfall,
    explanation,
  };
}

/** Completion rate by domain and start hour from past sessions (for the adherence objective). */
export function adherenceByHour(
  rows: { domain: string; starts_at: string; status: string }[],
  tz?: string | null,
): NonNullable<PlanOptions["adherence"]> {
  const out: NonNullable<PlanOptions["adherence"]> = {};
  for (const r of rows) {
    if (r.status === "replaced" || r.status === "planned") continue;
    const h = zonedParts(r.starts_at, tz).h;
    const dom = (out[r.domain] ??= {});
    const cell = (dom[h] ??= { done: 0, total: 0 });
    cell.total += 1;
    if (r.status === "done") cell.done += 1;
  }
  return out;
}

/** Reads a stated energy pattern ("I'm sharpest in the morning") into an energy peak. */
export function energyPeakFrom(v: unknown): PlanOptions["energyPeak"] {
  const s = (typeof v === "string" ? v : JSON.stringify(v ?? "")).toLowerCase();
  if (/morning|early/.test(s)) return "morning";
  if (/evening|night|late/.test(s)) return "evening";
  if (/midday|afternoon|lunch/.test(s)) return "midday";
  return null;
}
