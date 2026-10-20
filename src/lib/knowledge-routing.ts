// Specialists drive knowledge routing: each hidden specialist (mission.ts EXPERTS) reads from the
// Plexecute knowledge domains (knowledge.ts Domain) it owns. Pure and deterministic.
import type { Domain } from "./knowledge";
import type { Expert } from "./mission";
import type { RootCause } from "./mission";

export const EXPERT_DOMAINS: Record<Expert, Domain[]> = {
  career: ["career", "goals"],
  learning: ["learning"],
  business: ["business", "goals", "productivity", "decisions"],
  finance: ["finance"],
  property: ["finance", "decisions"],
  time: ["productivity"],
  habits: ["habits", "behaviour"],
  accountability: ["motivation", "behaviour"],
  fitness: ["resistance_training", "activity"],
  nutrition: ["nutrition", "weight"],
  sleep: ["sleep"],
  wellbeing: ["wellbeing", "mindfulness"],
  relationships: ["relationships"],
  decision: ["decisions"],
  transition: ["transitions", "decisions"],
  research: [],
  logistics: ["productivity"],
  risk: ["decisions"],
};

/** Knowledge domains for one turn: the message's own areas first, then each specialist's areas. Safety is always added by groundBundle. */
export function knowledgeDomains(routeDomains: Domain[], experts: Expert[]): Domain[] {
  const out: Domain[] = [];
  for (const d of routeDomains) if (!out.includes(d)) out.push(d);
  for (const e of experts)
    for (const d of EXPERT_DOMAINS[e] ?? []) if (!out.includes(d)) out.push(d);
  return out.slice(0, 8);
}

/** Knowledge domains that explain a repeated-miss cause; the fix is backed by these passages. */
export const CAUSE_DOMAINS: Record<RootCause, Domain[]> = {
  time_conflict: ["productivity", "habits"],
  too_long: ["behaviour", "habits"],
  unclear_action: ["productivity", "behaviour"],
  missing_prerequisite: ["goals", "productivity"],
  fatigue: ["sleep", "behaviour"],
  cost: ["finance"],
  low_priority: ["goals", "motivation"],
  motivation: ["motivation", "behaviour"],
  unsuitable_pathway: ["goals", "decisions"],
  none: [],
};

export const CAUSE_QUERY: Record<RootCause, string> = {
  time_conflict:
    "sessions keep clashing with other commitments, move to a time that has been kept, implementation intention",
  too_long:
    "sessions too long so they get skipped, start smaller, shorter sessions, minimum viable habit",
  unclear_action: "unclear next action causes procrastination, define the exact first step",
  missing_prerequisite: "blocked by a missing prerequisite, do the prerequisite first",
  fatigue: "too tired so sessions are missed, protect sleep, lighter earlier sessions",
  cost: "cost barrier, lower cost route",
  low_priority: "goal no longer a priority, review commitment, reduce the goal",
  motivation: "low motivation, small wins, accountability",
  unsuitable_pathway: "repeated failure despite changes, review the approach",
  none: "",
};

/** Deterministic plan change for a cause; null when the fix needs the member, not the planner. */
export function causeChange(
  cause: RootCause,
  goal: { session_minutes: number; weekly_minutes: number; preferred_time: string | null },
  keptHour: number | null,
): {
  session_minutes?: number;
  weekly_minutes?: number;
  preferred_time?: string;
  summary: string;
} | null {
  if (cause === "too_long") {
    const s = Math.max(15, Math.round((goal.session_minutes * 0.5) / 5) * 5);
    if (s >= goal.session_minutes) return null;
    return {
      session_minutes: s,
      summary: `sessions shortened from ${goal.session_minutes} to ${s} minutes (same weekly total, split across more short sessions)`,
    };
  }
  if (cause === "fatigue") {
    const s = Math.max(15, Math.round((goal.session_minutes * 0.75) / 5) * 5);
    const pref =
      goal.preferred_time === "evening" || !goal.preferred_time ? "morning" : goal.preferred_time;
    return {
      session_minutes: s,
      weekly_minutes: Math.max(s, Math.round((goal.weekly_minutes * 0.75) / 5) * 5),
      preferred_time: pref,
      summary: `lighter week: ${s}-minute sessions, ${pref} instead of late in the day`,
    };
  }
  if (cause === "time_conflict") {
    const pref =
      keptHour == null
        ? goal.preferred_time === "evening"
          ? "morning"
          : "evening"
        : keptHour < 12
          ? "morning"
          : keptHour < 17
            ? "midday"
            : "evening";
    if (pref === goal.preferred_time) return null;
    return { preferred_time: pref, summary: `moved to the ${pref}, away from the clashing time` };
  }
  return null;
}

import { CHUNKS, sourceOf } from "./knowledge";
/** Core passages for routed domains that keyword/semantic matching missed, so every routed area is represented.
 *  Highest-trust passage first; marked score 1 so they rank below real matches. */
export function domainAnchors(domains: Domain[], have: Set<string>, perDomain = 1) {
  const out: { chunk_id: string; domain: Domain }[] = [];
  for (const d of domains) {
    if ([...have].some((id) => CHUNKS.find((c) => c.chunk_id === id)?.domain === d)) continue;
    const pool = CHUNKS.filter((c) => c.domain === d && !have.has(c.chunk_id)).sort((a, b) =>
      sourceOf(a.source_id).trust_tier.localeCompare(sourceOf(b.source_id).trust_tier),
    );
    for (const c of pool.slice(0, perDomain)) out.push({ chunk_id: c.chunk_id, domain: d });
  }
  return out;
}
