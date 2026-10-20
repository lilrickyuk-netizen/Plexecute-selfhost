import { describe, it, expect } from "vitest";
import {
  bodyTrendOutcomes,
  experimentOutcomes,
  learningOutcomes,
  milestoneOutcomes,
  progressionOutcomes,
  routineOutcomes,
  weakest,
  weeklyOutcomes,
  wellnessOutcomes,
  type BlockObs,
} from "../src/lib/outcomes";

const now = new Date("2026-10-28T12:00:00Z"); // Wednesday; current week starts 2026-10-26
const blk = (id: string, day: string, status: string, extra: Partial<BlockObs> = {}): BlockObs => ({
  id,
  status,
  starts_at: `${day}T08:00:00Z`,
  evidence: status === "done" ? "self_reported" : "unknown",
  goal_id: "g1",
  is_protected: false,
  interruption_count: 0,
  domain: "fitness",
  ...extra,
});
const week = (mon: string, done: number, total: number, extra: Partial<BlockObs> = {}) =>
  Array.from({ length: total }, (_, i) =>
    blk(
      `${mon}-${i}`,
      mon.slice(0, 8) + String(Number(mon.slice(8)) + (i % 5)).padStart(2, "0"),
      i < done ? "done" : "skipped",
      extra,
    ),
  );

describe("life outcome ledger", () => {
  it("records milestones once with traceable source", () => {
    const d = milestoneOutcomes([
      { id: "m1", goal_id: "g1", title: "Run 5k", done_at: "2026-10-01T10:00:00Z" },
      { id: "m2", goal_id: "g1", title: "x", done_at: null },
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      outcome_type: "goal_milestone",
      goal_id: "g1",
      source_ref: "m1",
      dedupe_key: "milestone:m1",
      evidence_class: "self_reported",
    });
    expect(d[0]!.observation_refs).toEqual([{ table: "goal_milestones", id: "m1" }]);
  });
  it("training progression links the sessions behind it, ignores holds and unapplied suggestions", () => {
    const d = progressionOutcomes([
      {
        id: "p1",
        rule: "double_progression_load",
        created_at: "2026-10-01T00:00:00Z",
        prior: { load_kg: 40 },
        next: { load_kg: 42.5 },
        evidence: { sessions: ["s1", "s2"] },
        exercise: "squat",
      },
      {
        id: "p2",
        rule: "hold",
        created_at: "2026-10-01T00:00:00Z",
        prior: {},
        next: {},
        evidence: {},
      },
      {
        id: "p3",
        rule: "double_progression_load",
        created_at: "2026-10-01T00:00:00Z",
        prior: { load_kg: 40 },
        next: { load_kg: 42.5 },
        evidence: { applied: false },
      },
    ]);
    expect(d.map((x) => x.source_ref)).toEqual(["p1"]);
    expect(d[0]!.observation_refs.map((r) => r.id)).toEqual(["p1", "s1", "s2"]);
  });
  it("consistency change needs 5 sessions in both finished weeks and a 15-point change", () => {
    const blocks = [
      ...week("2026-10-12", 2, 5),
      ...week("2026-10-19", 5, 5),
      ...week("2026-10-26", 0, 5),
    ];
    const d = weeklyOutcomes(blocks, "UTC", now).filter(
      (x) => x.outcome_type === "adherence_change",
    );
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ value: 100, dedupe_key: "adherence_change:2026-10-19" });
    expect(d[0]!.observation_refs).toHaveLength(5);
    expect(
      weeklyOutcomes([...week("2026-10-12", 2, 4), ...week("2026-10-19", 4, 4)], "UTC", now),
    ).toHaveLength(0);
  });
  it("schedule realism records only improvements", () => {
    const worse = [
      ...week("2026-10-12", 5, 5),
      ...week("2026-10-19", 5, 5, { interruption_count: 1 }),
    ];
    expect(
      weeklyOutcomes(worse, "UTC", now).filter((x) => x.outcome_type === "schedule_realism"),
    ).toHaveLength(0);
    const better = [
      ...week("2026-10-12", 5, 5, { interruption_count: 1 }),
      ...week("2026-10-19", 5, 5),
    ];
    expect(
      weeklyOutcomes(better, "UTC", now).filter((x) => x.outcome_type === "schedule_realism"),
    ).toHaveLength(1);
  });
  it("protected routine established after 4 finished weeks in a row", () => {
    const b = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"].map((d, i) =>
      blk(`r${i}`, d, "done", { is_protected: true }),
    );
    const d = routineOutcomes(b, "UTC", now, { g1: "Morning run" });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({
      outcome_type: "routine_established",
      text_value: "Morning run",
      dedupe_key: "routine:g1",
    });
    expect(routineOutcomes(b.slice(1), "UTC", now, {})).toHaveLength(0);
  });
  it("wellness routine only when enabled", () => {
    const s = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"].map((d, i) => ({
      id: `w${i}`,
      created_at: `${d}T08:00:00Z`,
      completion_state: "completed",
    }));
    expect(wellnessOutcomes(true, 1, s, "UTC", now)).toHaveLength(1);
    expect(wellnessOutcomes(false, 1, s, "UTC", now)).toHaveLength(0);
  });
  it("body trend needs 10 weigh-ins and is off when paused", () => {
    const w = Array.from({ length: 14 }, (_, i) => ({
      id: `d${i}`,
      log_date: `2026-10-${String(i + 1).padStart(2, "0")}`,
      value: 80 - i * 0.3,
    }));
    const d = bodyTrendOutcomes(w, true);
    expect(d.length).toBeGreaterThan(0);
    expect(d[0]!.observation_refs).toHaveLength(7);
    expect(bodyTrendOutcomes(w, false)).toHaveLength(0);
    expect(bodyTrendOutcomes(w.slice(0, 9), true)).toHaveLength(0);
  });
  it("learning and experiment results", () => {
    expect(
      learningOutcomes(
        [
          {
            id: "t",
            goal_id: "g",
            title: "Algebra",
            done_at: "2026-10-01T00:00:00Z",
            parent_id: null,
          },
        ],
        [
          {
            id: "a",
            goal_id: "g",
            title: "Mock",
            kind: "mock",
            score: 72,
            taken_at: "2026-10-02T00:00:00Z",
            evidence: null,
          },
        ],
      ),
    ).toHaveLength(2);
    const e = experimentOutcomes([
      {
        id: "x",
        title: "Morning study",
        status: "completed",
        created_at: "2026-09-01T00:00:00Z",
        end_date: "2026-09-28",
        entry_ids: ["e1"],
        result: { difference: 4, enough: true, confidence: "low", a: { n: 5 }, b: { n: 5 } },
      },
    ]);
    expect(e[0]).toMatchObject({ value: 4, dedupe_key: "experiment:x" });
    expect(e[0]!.observation_refs).toContainEqual({ table: "experiment_entries", id: "e1" });
  });
  it("evidence is the weakest of its observations", () => {
    expect(weakest(["verified_external", "self_reported"])).toBe("self_reported");
    expect(weakest([])).toBe("unknown");
  });
});
