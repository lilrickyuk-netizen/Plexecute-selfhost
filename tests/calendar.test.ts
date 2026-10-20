import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildCalendarItems } from "../src/lib/calendar-items";

const tz = "Europe/London";
const src = {
  commitments: [
    {
      id: "a",
      title: "Dentist",
      kind: "appointment",
      recurrence: "once",
      days: [],
      on_date: "2026-10-13",
      start_time: "14:00:00",
      end_time: "15:00:00",
      active: true,
    },
    {
      id: "w",
      title: "Shift",
      kind: "shift",
      recurrence: "weekly",
      days: [1, 3],
      on_date: null,
      start_time: "09:00:00",
      end_time: "17:00:00",
      active: true,
    },
  ],
  blocks: [
    {
      id: "b1",
      title: "Run",
      starts_at: "2026-10-13T06:00:00Z",
      duration_min: 30,
      status: "planned",
      is_protected: false,
      occurrence_kind: "session",
      commitment_id: null,
      domain: "cardio",
    },
    {
      id: "b2",
      title: "Dentist",
      starts_at: "2026-10-13T13:00:00Z",
      duration_min: 60,
      status: "planned",
      is_protected: true,
      occurrence_kind: "commitment",
      commitment_id: "a",
      domain: "life",
    },
  ],
  calls: [{ id: "k", call_at: "2026-10-13T12:30:00Z", purpose: "Dentist", status: "scheduled" }],
  goals: [],
  milestones: [],
};

describe("Plexecute Calendar", () => {
  it("shows commitments, sessions and calls once, in local time", () => {
    const items = buildCalendarItems(src, "2026-10-12", "2026-10-18", tz);
    expect(items.filter((i) => i.title === "Dentist")).toHaveLength(1);
    expect(items.find((i) => i.kind === "call")?.start).toBe("13:30");
    expect(items.find((i) => i.title === "Run")?.start).toBe("07:00");
    expect(items.filter((i) => i.title === "Shift").map((i) => i.day)).toEqual([
      "2026-10-12",
      "2026-10-14",
    ]);
  });
  it("day, week and month views agree", () => {
    const day = buildCalendarItems(src, "2026-10-13", "2026-10-13", tz).map((i) => i.id);
    const week = buildCalendarItems(src, "2026-10-12", "2026-10-18", tz)
      .filter((i) => i.day === "2026-10-13")
      .map((i) => i.id);
    const month = buildCalendarItems(src, "2026-09-28", "2026-11-08", tz)
      .filter((i) => i.day === "2026-10-13")
      .map((i) => i.id);
    expect(week).toEqual(day);
    expect(month).toEqual(day);
  });
  it("external calendar connections are gone from the member screens", () => {
    for (const f of ["app.settings.tsx", "app.integrations.tsx", "app.commitments.tsx"]) {
      const s = readFileSync(`src/routes/_authenticated/${f}`, "utf8");
      expect(s).not.toMatch(/CalendarConnections|Google Calendar|Outlook/);
    }
  });
});

import { buildCalendarItems as build2 } from "../src/lib/calendar-items";
describe("calendar shows each entry once", () => {
  const blk = (id: string, status: string, at = "2026-10-16T05:30:00Z") => ({
    id,
    title: "Wake for work",
    starts_at: at,
    duration_min: 10,
    status,
    is_protected: false,
    occurrence_kind: "wake_for_work",
    commitment_id: null,
    domain: "admin",
  });
  const empty = { commitments: [], calls: [], goals: [], milestones: [] };
  it("hides replaced copies and keeps the live one", () => {
    const items = build2(
      { ...empty, blocks: [blk("a", "rescheduled"), blk("b", "rescheduled"), blk("c", "planned")] },
      "2026-10-16",
      "2026-10-16",
      "Europe/London",
    );
    expect(items.length).toBe(1);
  });
  it("puts a commitment's reminder call on the commitment instead of a second line", () => {
    const items = build2(
      {
        ...empty,
        blocks: [],
        commitments: [
          {
            id: "x",
            title: "Check the oven",
            kind: "other",
            recurrence: "once",
            days: [],
            on_date: "2026-10-16",
            start_time: "19:30:00",
            end_time: "19:35:00",
            active: true,
          },
        ],
        calls: [
          {
            id: "k",
            call_at: "2026-10-16T18:30:00Z",
            purpose: "Before Check the oven",
            status: "placed",
          },
        ],
      },
      "2026-10-16",
      "2026-10-16",
      "Europe/London",
    );
    expect(items.length).toBe(1);
    expect(items[0]!.status).toBe("call made");
  });
});
