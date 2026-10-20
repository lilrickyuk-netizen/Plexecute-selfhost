// Deterministic recovery & experiment logic (no AI).

export function readiness(sleep: number, soreness: number, stress: number, energy: number) {
  const raw = sleep + (6 - soreness) + (6 - stress) + energy; // 4..20
  return Math.round(((raw - 4) / 16) * 100);
}

export function readinessAdvice(score: number) {
  if (score >= 70) return { band: "Ready", text: "Run the plan as written. Push key sessions." };
  if (score >= 45)
    return {
      band: "Moderate",
      text: "Keep the plan, cap intensity. Swap one hard session for an easy one if needed.",
    };
  return {
    band: "Low",
    text: "Recovery day. Shorten or move demanding sessions, protect sleep tonight.",
  };
}

export type Entry = { entry_date: string; value: number };

export function experimentResult(
  start: string,
  baselineDays: number,
  testDays: number,
  entries: Entry[],
) {
  const s = new Date(start + "T00:00:00Z").getTime();
  const split = s + baselineDays * 864e5;
  const end = split + testDays * 864e5;
  const base: number[] = [],
    test: number[] = [];
  for (const e of entries) {
    const t = new Date(e.entry_date + "T00:00:00Z").getTime();
    if (t >= s && t < split) base.push(Number(e.value));
    else if (t >= split && t < end) test.push(Number(e.value));
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const b = mean(base),
    tt = mean(test);
  const change = b !== null && tt !== null && b !== 0 ? ((tt - b) / Math.abs(b)) * 100 : null;
  const enough = base.length >= Math.min(3, baselineDays) && test.length >= Math.min(3, testDays);
  const phase = Date.now() < split ? "baseline" : Date.now() < end ? "test" : "finished";
  return {
    baselineMean: b,
    testMean: tt,
    change,
    baseN: base.length,
    testN: test.length,
    enough,
    phase,
    endsOn: new Date(end).toISOString().slice(0, 10),
  };
}
