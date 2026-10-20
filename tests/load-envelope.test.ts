import { describe, expect, it } from "vitest";
import { buildWeekPlan, feasibilityReport, startOfWeek } from "@/lib/scheduler";

// Step 86: optimiser SLOs (spec §86) measured on realistic and heavy inputs.
const DOMAINS = [
  "training",
  "cardio",
  "learning",
  "career",
  "wellness",
  "nutrition",
  "work_prep",
  "sleep",
];
const TIMES = ["morning", "midday", "evening", "any"];

function rng(seed: number) {
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function member(seed: number, goalCount: number) {
  const r = rng(seed);
  const profile = {
    timezone: ["Europe/London", "America/New_York", "Asia/Kolkata", "Australia/Sydney"][seed % 4],
    wake_time: "0" + (6 + Math.floor(r() * 3)) + ":00",
    sleep_time: "2" + (2 + Math.floor(r() * 2)) + ":30",
    work_start: "09:00",
    work_end: r() > 0.5 ? "17:30" : "18:00",
    work_days: [1, 2, 3, 4, 5],
    commitments: Array.from({ length: 4 }, (_, i) => ({
      days_of_week: [1 + (i % 5)],
      start_time: "19:00",
      end_time: "20:00",
    })),
  } as never;
  const goals = Array.from({ length: goalCount }, (_, i) => ({
    id: `g${i}`,
    title: `Goal ${i}`,
    domain: DOMAINS[i % DOMAINS.length],
    weekly_minutes: 60 + Math.floor(r() * 180),
    session_minutes: [20, 30, 45, 60][i % 4],
    preferred_time: TIMES[i % 4],
    priority: (i % 3) + 1,
  })) as never[];
  return { profile, goals };
}

function p95(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)];
}

describe("launch load envelope — optimiser", () => {
  const ws = startOfWeek(new Date("2026-10-05T12:00:00Z"), "Europe/London");

  it("interactive optimiser (feasibility on change) p95 < 3 s", () => {
    const t: number[] = [];
    for (let i = 0; i < 200; i++) {
      const { profile, goals } = member(i + 1, 6);
      const a = performance.now();
      feasibilityReport(profile, goals, ws, new Date("2026-10-07T10:00:00Z"));
      t.push(performance.now() - a);
    }
    console.log(`interactive p95 ${p95(t).toFixed(1)} ms over ${t.length} runs`);
    expect(p95(t)).toBeLessThan(3000);
  }, 60000);

  it("weekly optimiser on heavy members (20 goals, kept blocks, history) p95 < 20 s", () => {
    const t: number[] = [];
    for (let i = 0; i < 100; i++) {
      const { profile, goals } = member(1000 + i, 20);
      const fixed = [
        { starts_at: "2026-10-06T07:30:00Z", duration_min: 45, domain: "training", goal_id: "g0" },
      ];
      const previous = goals
        .slice(0, 10)
        .map((g: any, k) => ({ goal_id: g.id, starts_at: `2026-09-${29 + (k % 2)}T18:00:00Z` }));
      const a = performance.now();
      buildWeekPlan(profile, goals, ws, { fixed, previous, energyPeak: "morning" });
      t.push(performance.now() - a);
    }
    console.log(`weekly heavy p95 ${p95(t).toFixed(1)} ms over ${t.length} runs`);
    expect(p95(t)).toBeLessThan(20000);
  }, 60000);

  it("one worker can plan 5,000 due members within a minute (CPU share of 5,000 events/min)", () => {
    const a = performance.now();
    for (let i = 0; i < 5000; i++) {
      const { profile, goals } = member(i + 7, 4);
      buildWeekPlan(profile, goals, ws);
    }
    const ms = performance.now() - a;
    console.log(`5,000 plans in ${(ms / 1000).toFixed(1)} s`);
    expect(ms).toBeLessThan(60000);
  }, 120000);
});
