// "Too easy" / "too hard" after a workout changes the next session for real: the active programme's
// prescriptions are revised (with progression_events), else the next planned workout on the plan is rewritten.
import { adaptForEffort, EX, type Effort } from "./training";

type Db = any;

export async function applyEffortFeedback(
  userId: string,
  effort: Effort,
  sourceBlockId: string | null,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as Db;
  const { data: prog } = await db
    .from("training_programmes")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("version", { ascending: false })
    .limit(1);
  const programmeId = prog?.[0]?.id as string | undefined;
  if (programmeId) {
    // Which programme day comes next: the one after the last completed workout session, else day 0.
    const { data: last } = await db
      .from("workout_sessions")
      .select("day_index")
      .eq("user_id", userId)
      .eq("programme_id", programmeId)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1);
    const { data: all } = await db
      .from("programme_prescriptions")
      .select("*")
      .eq("programme_id", programmeId)
      .eq("user_id", userId)
      .order("day_index")
      .order("order_index");
    const rows = (all ?? []) as any[];
    if (rows.length) {
      const days = [...new Set(rows.map((r) => r.day_index))].sort((a, b) => a - b);
      const lastDay = last?.[0]?.day_index;
      const nextDay =
        lastDay == null ? days[0] : (days[(days.indexOf(lastDay) + 1) % days.length] ?? days[0]);
      const changes: { exercise: string; from: string; to: string; why: string }[] = [];
      // Effort is about the whole programme's level, so every day moves one step; the next session is the first to use it.
      for (const rx of rows) {
        const n = adaptForEffort(rx, effort);
        const { error } = await db
          .from("programme_prescriptions")
          .update({
            sets: n.sets,
            rep_min: n.rep_min,
            rep_max: n.rep_max,
            load_kg: n.load_kg,
            revision: rx.revision + 1,
          })
          .eq("id", rx.id)
          .eq("user_id", userId);
        if (error) return { status: "FAILED", error: error.message };
        await db.from("progression_events").insert({
          user_id: userId,
          prescription_id: rx.id,
          rule: effort === "too_easy" ? "effort_increase" : "effort_decrease",
          prior: {
            sets: rx.sets,
            rep_min: rx.rep_min,
            rep_max: rx.rep_max,
            load_kg: rx.load_kg,
            revision: rx.revision,
          },
          next: { sets: n.sets, rep_min: n.rep_min, rep_max: n.rep_max, load_kg: n.load_kg },
          evidence: { member_feedback: effort, source_block: sourceBlockId },
        });
        const fmt = (s: number, a: number, b: number, l: number | null) =>
          `${s}×${a}-${b}${l ? ` @ ${l} kg` : ""}`;
        if (rx.day_index === nextDay)
          changes.push({
            exercise: EX[rx.exercise_key]?.name ?? rx.exercise_key,
            from: fmt(rx.sets, rx.rep_min, rx.rep_max, rx.load_kg),
            to: fmt(n.sets, n.rep_min, n.rep_max, n.load_kg),
            why: n.why,
          });
      }
      return { status: "PROGRAMME_ADAPTED", programme_day: nextDay, changes };
    }
  }
  // No programme: rewrite the next planned workout on the plan so it is genuinely harder/easier.
  const { data: next } = await db
    .from("plan_blocks")
    .select("id,title,note,evidence_detail,starts_at,duration_min")
    .eq("user_id", userId)
    .eq("occurrence_kind", "workout")
    .in("status", ["planned", "scheduled", "upcoming"])
    .gt("starts_at", new Date().toISOString())
    .neq("id", sourceBlockId ?? "00000000-0000-0000-0000-000000000000")
    .order("starts_at")
    .limit(1);
  const b = next?.[0];
  if (!b)
    return {
      status: "NO_NEXT_WORKOUT",
      hint: "Feedback saved. No later workout is on the plan yet: build the next one now (build_workout) with every exercise harder than this one, then schedule it.",
    };
  const up = effort === "too_easy";
  const rule = up
    ? "Progression (you said it was too easy): +2 reps on every exercise and one extra round; rest 15 s shorter."
    : "Adjusted (you said it was too hard): -2 reps on every exercise and one round fewer; rest 15 s longer.";
  const prior = (b.evidence_detail ?? {}) as Record<string, unknown>;
  const level = Number((prior["progression"] as any)?.level ?? 0) + (up ? 1 : -1);
  const note =
    `${rule}\n${String(b.note ?? "").replace(/^(Progression|Adjusted) \(you said[^\n]*\n?/, "")}`.slice(
      0,
      1500,
    );
  const { error } = await db
    .from("plan_blocks")
    .update({
      note,
      duration_min: Math.max(10, Math.min(240, b.duration_min + (up ? 5 : -5))),
      evidence_detail: {
        ...prior,
        progression: { level, effort, rule, source_block: sourceBlockId },
      },
    })
    .eq("id", b.id)
    .eq("user_id", userId);
  if (error) return { status: "FAILED", error: error.message };
  return {
    status: "NEXT_WORKOUT_ADAPTED",
    workout: { id: b.id, title: b.title, starts_at: b.starts_at },
    change: rule,
  };
}
