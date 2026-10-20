// Deterministic qualitative recovery state (V3): GREEN / AMBER / RED / UNKNOWN.
// Never a medical judgement and never a sleep-disorder diagnosis. Missing data is UNKNOWN, never assumed GREEN.

export type RecoveryState = "GREEN" | "AMBER" | "RED" | "UNKNOWN";

export const RECOVERY_RULES_VERSION = "recovery_state_v2";

export type RecoveryInput = {
  checkin: {
    sleep_quality: number;
    energy: number;
    soreness: number;
    stress: number;
    ill_or_injured?: boolean | null;
  } | null;
  sleepTargetHours?: number | null; // V3 §50 default 8 h, user-editable
  sleepHistory?: number[]; // recent nightly hours, newest first (consistency)
  bedtimeShiftMin?: number | null; // last sleep start vs planned bedtime, minutes (timing)
  executionMissed48h?: number; // missed/skipped plan occurrences in the last 48h
  sleepHours?: number | null; // sourced wearable/manual observation, last night
  recentHardSessions?: number; // completed training/cardio sessions in the last 48h
  restingHrDelta?: number | null; // wearable: today's resting HR minus 7-day average (bpm)
  hrvDropPct?: number | null; // wearable: % drop of today's HRV vs 7-day average
};

export type RecoveryAssessment = {
  state: RecoveryState;
  reasons: string[];
  guidance: string;
  planAdaptation: "as_planned" | "cap_intensity" | "recovery_only" | "check_in_first";
  notes: string[]; // signals recorded and shown, not used to change the state
  version: string;
};

export function assessRecovery(i: RecoveryInput): RecoveryAssessment {
  if (!i.checkin) {
    return {
      state: "UNKNOWN",
      reasons: ["No check-in today"],
      guidance: "Do today's check-in so the plan can adapt safely.",
      planAdaptation: "check_in_first",
      notes: [],
      version: RECOVERY_RULES_VERSION,
    };
  }
  const notes: string[] = [];
  const c = i.checkin;
  const red: string[] = [];
  const amber: string[] = [];
  if (c.soreness >= 5) red.push("Very high soreness");
  else if (c.soreness >= 4) amber.push("High soreness");
  if (c.sleep_quality <= 1) red.push("Very poor sleep");
  else if (c.sleep_quality <= 2) amber.push("Poor sleep");
  if (c.energy <= 1) red.push("Very low energy");
  else if (c.energy <= 2) amber.push("Low energy");
  if (c.stress >= 5) red.push("Very high stress");
  else if (c.stress >= 4) amber.push("High stress");
  if (c.ill_or_injured) red.push("You said you're ill or injured");
  const target = i.sleepTargetHours ?? 8;
  if (i.sleepHours != null && i.sleepHours < target)
    amber.push(`${i.sleepHours.toFixed(1)} h sleep, below your ${target} h target`);
  // Wearable values are source-labelled and can never be the sole readiness truth: they add AMBER reasons only.
  if (i.restingHrDelta != null && i.restingHrDelta >= 7)
    amber.push(`Wearable: resting heart rate ${Math.round(i.restingHrDelta)} bpm above your usual`);
  if (i.hrvDropPct != null && i.hrvDropPct >= 20)
    amber.push(`Wearable: heart rate variability ${Math.round(i.hrvDropPct)}% below your usual`);
  const h = i.sleepHistory ?? [];
  if (h.length >= 3)
    notes.push(
      `Sleep over the last ${h.length} nights ranged ${Math.min(...h).toFixed(1)}–${Math.max(...h).toFixed(1)} h`,
    );
  if (i.bedtimeShiftMin != null && i.bedtimeShiftMin !== 0)
    notes.push(
      `Went to sleep ${Math.abs(Math.round(i.bedtimeShiftMin))} min ${i.bedtimeShiftMin > 0 ? "later" : "earlier"} than planned`,
    );
  if (i.recentHardSessions)
    notes.push(`${i.recentHardSessions} training/cardio session(s) done in the last 48 h`);
  if (i.executionMissed48h)
    notes.push(`${i.executionMissed48h} planned session(s) missed in the last 48 h`);
  const base = { notes, version: RECOVERY_RULES_VERSION };
  if (red.length || amber.length >= 3) {
    return {
      state: "RED",
      reasons: [...red, ...amber],
      guidance:
        "Recovery day. Replace hard sessions with easy movement or rest and protect sleep tonight. If you feel unwell, stop and seek medical advice.",
      planAdaptation: "recovery_only",
      ...base,
    };
  }
  if (amber.length) {
    return {
      state: "AMBER",
      reasons: amber,
      guidance:
        "Keep the plan but cap intensity. Swap one hard session for an easier version if needed.",
      planAdaptation: "cap_intensity",
      ...base,
    };
  }
  return {
    state: "GREEN",
    reasons: ["Check-in within normal ranges"],
    guidance: "Run the plan as written.",
    planAdaptation: "as_planned",
    ...base,
  };
}

export const STATE_STYLE: Record<RecoveryState, string> = {
  GREEN: "text-success border-success",
  AMBER: "text-warning border-warning",
  RED: "text-destructive border-destructive",
  UNKNOWN: "text-muted-foreground border-border",
};

// Recovery Mode plan adaptation (V3 §19, §50A). Pure: never touches protected sessions.
export const RECOVERY_ADAPT_VERSION = "recovery_adapt_v1";
const PHYSICAL = new Set(["training", "cardio"]);
export type AdaptBlock = {
  id: string;
  goal_id: string;
  title: string;
  domain: string;
  starts_at: string;
  duration_min: number;
  is_protected: boolean;
};
export function adaptForRecovery(state: RecoveryState, today: AdaptBlock[]) {
  const changes: { id: string; from: string; to: string; minutes: number }[] = [];
  const out = today.map((b) => {
    if (b.is_protected || !(state === "RED" || state === "AMBER")) return b;
    if (PHYSICAL.has(b.domain)) {
      if (state === "RED") {
        const m = Math.min(20, b.duration_min);
        changes.push({
          id: b.id,
          from: b.title,
          to: "Recovery: easy walk or gentle mobility",
          minutes: m,
        });
        return {
          ...b,
          title: "Recovery: easy walk or gentle mobility",
          domain: "mobility",
          duration_min: m,
        };
      }
      const m = Math.max(10, Math.round((b.duration_min * 0.75) / 5) * 5);
      const t = b.title.endsWith("(easier)") ? b.title : `${b.title} (easier)`;
      changes.push({ id: b.id, from: b.title, to: t, minutes: m });
      return { ...b, title: t, duration_min: m };
    }
    if (state === "RED" && b.domain !== "wellness" && b.domain !== "sleep" && b.duration_min > 30) {
      const m = Math.max(15, Math.round((b.duration_min * 0.6) / 5) * 5);
      changes.push({ id: b.id, from: b.title, to: b.title, minutes: m });
      return { ...b, duration_min: m };
    }
    return b;
  });
  return { blocks: out, changes };
}
