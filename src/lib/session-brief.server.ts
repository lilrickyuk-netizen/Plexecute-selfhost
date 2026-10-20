// Loads the records already linked to one plan session and builds its execution-ready brief.
// Reads only, through the caller's RLS client (or the Coach's guarded client). No AI calls.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildSessionBrief, type BriefInput } from "./session-brief";
import { EXERCISES } from "./training";
import { MEAL_PREP_POLICY, prepSessions, shoppingList, type PrepPlan } from "./meal-prep";

type Db = SupabaseClient<Database>;
const EX_NAME = new Map(EXERCISES.map((e) => [e.key, e.name]));

export async function loadSessionBrief(db: Db, userId: string, blockId: string) {
  const { data: block } = await db
    .from("plan_blocks")
    .select("id,title,occurrence_kind,domain,status,starts_at,duration_min,goal_id,commitment_id")
    .eq("id", blockId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!block) return null;
  const { data: prof } = await db
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  const input: BriefInput = { block, tz: prof?.timezone ?? null };
  const kind = block.occurrence_kind;

  if (block.goal_id) {
    const [g, m, t, r] = await Promise.all([
      db
        .from("goals")
        .select("id,title,why,success_definition,domain,status")
        .eq("id", block.goal_id)
        .maybeSingle(),
      db
        .from("goal_milestones")
        .select(
          "id,key,title,status,stage,position,depends_on,actions,sources,evidence_type,blocked_reason",
        )
        .eq("goal_id", block.goal_id),
      db
        .from("learning_topics")
        .select("id,title,position,done_at,parent_id")
        .eq("goal_id", block.goal_id),
      db
        .from("learning_resources")
        .select("title,url,kind,content,done_units,total_units")
        .eq("goal_id", block.goal_id)
        .order("created_at"),
    ]);
    // A deleted or archived goal no longer explains the session: show it as a standalone task.
    if (g.data && !["deleted", "archived"].includes(g.data.status)) {
      input.goal = g.data;
      input.milestones = m.data ?? [];
      input.topics = t.data ?? [];
      input.learningResources = r.data ?? [];
    }
  }

  if (kind === "workout") {
    const { data: prog } = await db
      .from("training_programmes")
      .select("id,days_per_week,template_key")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prog) {
      const { data: rx } = await db
        .from("programme_prescriptions")
        .select("day_index,exercise_key,sets,rep_min,rep_max,order_index,revision")
        .eq("programme_id", prog.id)
        .order("day_index")
        .order("order_index");
      const days = [...new Set((rx ?? []).map((x) => x.day_index))].sort((a, b) => a - b);
      if (days.length) {
        // Which programme day: this session's position among this week's workouts.
        const start = new Date(block.starts_at);
        const weekStart = new Date(start);
        weekStart.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
        weekStart.setUTCHours(0, 0, 0, 0);
        const { data: wk } = await db
          .from("plan_blocks")
          .select("id,starts_at")
          .eq("user_id", userId)
          .eq("occurrence_kind", "workout")
          .gte("starts_at", weekStart.toISOString())
          .lte("starts_at", block.starts_at)
          .neq("status", "rescheduled")
          .order("starts_at");
        const ord = Math.max(
          0,
          (wk ?? []).findIndex((x) => x.id === block.id),
        );
        const day = days[ord % days.length]!;
        const latest = new Map<string, NonNullable<typeof rx>[number]>();
        for (const x of (rx ?? []).filter((x) => x.day_index === day)) {
          const k = `${x.order_index}:${x.exercise_key}`;
          const p = latest.get(k);
          if (!p || x.revision > p.revision) latest.set(k, x);
        }
        input.workout = {
          name: block.title,
          day,
          exercises: [...latest.values()]
            .sort((a, b) => a.order_index - b.order_index)
            .map((x) => ({
              name: EX_NAME.get(x.exercise_key) ?? x.exercise_key.replace(/_/g, " "),
              sets: x.sets,
              reps: x.rep_min === x.rep_max ? String(x.rep_min) : `${x.rep_min}–${x.rep_max}`,
            })),
        };
      }
    }
  }

  if (kind === "meal_prep") {
    const { data: plans } = await db
      .from("meal_plans")
      .select("plan,status")
      .eq("user_id", userId)
      .eq("policy_version", MEAL_PREP_POLICY)
      .in("status", ["approved", "proposed"])
      .order("created_at", { ascending: false })
      .limit(5);
    const date = block.starts_at.slice(0, 10);
    const row = (plans ?? []).sort(
      (a, b) => Number(b.status === "approved") - Number(a.status === "approved"),
    )[0];
    if (row) {
      try {
        const plan = row.plan as unknown as PrepPlan;
        const sessions = prepSessions(plan);
        const s = sessions.find((x) => x.date === date) ?? sessions[0];
        if (s) {
          // Food inventory is server-read only (members have no direct read on it); same reader as the Meal prep screen, scoped to this verified member.
          const { listInventory } = await import("./meal-prep.server");
          const { items } = await listInventory({ userId } as never);
          const list = shoppingList(plan, items);
          input.prep = {
            label: s.label,
            cook: s.cook,
            creates: s.creates,
            have: list.have.map((h) => h.name).slice(0, 8),
            shopping: list.buy.map((x) => `${x.name} — ${x.label}`).slice(0, 8),
            minutes: s.minutes,
          };
        }
      } catch (e) {
        console.error("session brief prep", e);
      }
    }
  }

  if (block.commitment_id) {
    const { data: bk } = await db
      .from("appointment_bookings")
      .select("id,service,status,provider_name,kind,checkout_url,checkout_expires_at")
      .eq("user_id", userId)
      .eq("commitment_id", block.commitment_id)
      .not("status", "in", "(cancelled,superseded)")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    input.booking = bk ?? null;
  }
  const { data: jr } = await db
    .from("journeys")
    .select("id,dest_label,leave_at,duration_min,buffer_min,mode,status,appointment_id")
    .eq("user_id", userId)
    .eq("plan_block_id", block.id)
    .neq("status", "cancelled")
    .limit(1)
    .maybeSingle();
  input.journey = jr ?? null;
  if (!jr && input.booking) {
    const { data: j2 } = await db
      .from("journeys")
      .select("id,dest_label,leave_at,duration_min,buffer_min,mode,status")
      .eq("user_id", userId)
      .eq("appointment_id", input.booking.id)
      .neq("status", "cancelled")
      .limit(1)
      .maybeSingle();
    input.journey = j2 ?? null;
  }
  return buildSessionBrief(input);
}
