import { addDaysKey, localDayKey, weekKeyOf, diffDaysKey } from "./tz";

/** Progress views (spec §22). Pure maths over stored records only; wording elsewhere must never claim causes. */

export type ProgressBlock = {
  id: string;
  status: string;
  starts_at: string;
  duration_min: number;
  domain: string;
  goal_id: string | null;
  evidence: string;
};

const DONE = new Set(["done"]);

/** Occurrences that were due, plus ones already finished early (moved or cancelled ones don't count as planned). */
export function dueBlocks(blocks: ProgressBlock[], now: Date): ProgressBlock[] {
  return blocks.filter(
    (b) =>
      (new Date(b.starts_at) <= now || ["done", "partial"].includes(b.status)) &&
      !["rescheduled", "cancelled"].includes(b.status),
  );
}

export type WeekAdherence = {
  week: string;
  planned: number;
  done: number;
  partial: number;
  skipped: number;
  unknown: number;
  pct: number | null;
};

/** Adherence per local week (Monday start, user timezone). Unknown stays unknown; pct is null when nothing was due. */
export function weeklyAdherence(
  blocks: ProgressBlock[],
  tz: string | null,
  now: Date,
  weeks = 8,
): WeekAdherence[] {
  const current = weekKeyOf(now, tz);
  const keys = Array.from({ length: weeks }, (_, i) => addDaysKey(current, -7 * (weeks - 1 - i)));
  const due = dueBlocks(blocks, now);
  return keys.map((week) => {
    const inW = due.filter((b) => weekKeyOf(b.starts_at, tz) === week);
    const done = inW.filter((b) => DONE.has(b.status)).length;
    const partial = inW.filter((b) => b.status === "partial").length;
    const skipped = inW.filter((b) => b.status === "skipped").length;
    return {
      week,
      planned: inW.length,
      done,
      partial,
      skipped,
      unknown: inW.length - done - partial - skipped,
      pct: inW.length ? Math.round((done / inW.length) * 100) : null,
    };
  });
}

export type DomainPlanActual = {
  domain: string;
  plannedMin: number;
  doneMin: number;
  plannedCount: number;
  doneCount: number;
};

/** Plan vs actual minutes by life area. Partial sessions count as unknown minutes (not credited). */
export function planVsActual(blocks: ProgressBlock[], now: Date): DomainPlanActual[] {
  const m = new Map<string, DomainPlanActual>();
  for (const b of dueBlocks(blocks, now)) {
    const r = m.get(b.domain) ?? {
      domain: b.domain,
      plannedMin: 0,
      doneMin: 0,
      plannedCount: 0,
      doneCount: 0,
    };
    r.plannedMin += b.duration_min;
    r.plannedCount++;
    if (DONE.has(b.status)) {
      r.doneMin += b.duration_min;
      r.doneCount++;
    }
    m.set(b.domain, r);
  }
  return [...m.values()].sort((a, b) => b.plannedMin - a.plannedMin);
}

export type TrajectoryGoal = {
  id: string;
  title: string;
  baseline_value: number | null;
  target_value: number | null;
  current_value: number | null;
  target_unit: string | null;
  deadline: string | null;
  created_at: string;
};
export type Trajectory = {
  points: { day: string; value: number }[];
  latest: number | null;
  pctToTarget: number | null;
  expectedNow: number | null;
  position: "ahead" | "on_line" | "behind" | null;
  enough: boolean;
};

/**
 * Goal trajectory: recorded values against the straight line from baseline to target by the deadline.
 * Needs at least 2 readings; "position" only compares to that line and says nothing about why.
 */
export function goalTrajectory(
  g: TrajectoryGoal,
  entries: { value: number; recorded_at: string }[],
  tz: string | null,
  now: Date,
): Trajectory {
  const points = [...entries]
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
    .map((e) => ({ day: localDayKey(e.recorded_at, tz), value: Number(e.value) }));
  const latest = points.length ? points[points.length - 1]!.value : g.current_value;
  const base = g.baseline_value ?? points[0]?.value ?? null;
  const tgt = g.target_value;
  const pctToTarget =
    base != null && tgt != null && latest != null && tgt !== base
      ? Math.max(0, Math.min(100, Math.round(((latest - base) / (tgt - base)) * 100)))
      : null;
  let expectedNow: number | null = null,
    position: Trajectory["position"] = null;
  if (base != null && tgt != null && g.deadline && latest != null) {
    const start = localDayKey(g.created_at, tz),
      end = g.deadline.slice(0, 10),
      today = localDayKey(now, tz);
    const span = diffDaysKey(end, start);
    if (span > 0) {
      const f = Math.max(0, Math.min(1, diffDaysKey(today, start) / span));
      expectedNow = base + (tgt - base) * f;
      const dir = Math.sign(tgt - base),
        gap = (latest - expectedNow) * dir,
        tol = Math.abs(tgt - base) * 0.05;
      position = gap > tol ? "ahead" : gap < -tol ? "behind" : "on_line";
    }
  }
  return {
    points,
    latest: latest ?? null,
    pctToTarget,
    expectedNow,
    position: points.length >= 2 ? position : null,
    enough: points.length >= 2,
  };
}

/** Trailing 7-reading average for weight (same smoothing the nutrition engine shows). */
export function smoothed(values: { day: string; value: number }[], n = 7) {
  return values.map((v, i) => {
    const w = values.slice(Math.max(0, i - n + 1), i + 1);
    return { day: v.day, value: v.value, avg: w.reduce((s, x) => s + x.value, 0) / w.length };
  });
}

export type Checkin = {
  check_date: string;
  readiness: number;
  sleep_quality: number;
  energy: number;
  ill_or_injured: boolean;
};
/** Recovery pattern over the window: averages and how many days were logged. Never a medical score. */
export function recoveryPattern(rows: Checkin[], days: number, now: Date, tz: string | null) {
  const from = addDaysKey(localDayKey(now, tz), -(days - 1));
  const r = rows.filter((x) => x.check_date >= from);
  const avg = (k: "readiness" | "sleep_quality" | "energy") =>
    r.length ? Math.round((r.reduce((s, x) => s + Number(x[k]), 0) / r.length) * 10) / 10 : null;
  return {
    logged: r.length,
    days,
    readiness: avg("readiness"),
    sleep: avg("sleep_quality"),
    energy: avg("energy"),
    illDays: r.filter((x) => x.ill_or_injured).length,
    series: r.sort((a, b) => a.check_date.localeCompare(b.check_date)),
  };
}
