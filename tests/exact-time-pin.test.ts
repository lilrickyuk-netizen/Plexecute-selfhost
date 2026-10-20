import { buildWeekPlan } from "../src/lib/scheduler";
import { test, expect } from "vitest";
test("exact 18:00 kept", () => {
  const p: any = {
    wake_time: "06:30",
    sleep_time: "23:00",
    work_start: "09:00",
    work_end: "17:00",
    work_days: [1, 2, 3, 4, 5],
    timezone: "Europe/London",
    commitments: [],
  };
  const g: any = [
    {
      id: "g",
      title: "Training",
      domain: "training",
      weekly_minutes: 90,
      session_minutes: 30,
      preferred_time: "evening",
      preferred_days: [1, 3, 5],
      preferred_start: "18:00",
      priority: 3,
    },
    {
      id: "h",
      title: "Study",
      domain: "learning",
      weekly_minutes: 120,
      session_minutes: 40,
      preferred_time: "evening",
      priority: 3,
    },
  ];
  const r = buildWeekPlan(p, g, new Date("2026-10-19T00:00:00Z"), {
    previous: [{ goal_id: "g", starts_at: "2026-10-12T16:55:00Z" }],
  });
  const t = r.blocks
    .filter((b) => b.goal_id === "g")
    .map((b) =>
      new Date(b.starts_at).toLocaleTimeString("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  console.log(t);
  expect(t).toEqual(["18:00", "18:00", "18:00"]);
});
