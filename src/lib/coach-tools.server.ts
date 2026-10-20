// Server execution of the V3 §59 Coach tool registry. Reads run through the user's RLS client;
// mutating tools never change state directly: they return actions the user must confirm.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  gateTool,
  FREE_ALLOWANCE,
  coachMayAccess,
  type ToolName,
  type CoachAction,
} from "./coach-tools";
import { localDayKey, localHm, startOfLocalDay } from "./tz";
import { assessRecovery } from "./recovery-state";
import {
  COACH_ACTION_DEFS,
  COACH_ACTION_TOOLS,
  execActionTool,
  type CoachActionTool,
} from "./coach-actions.server";

type Db = SupabaseClient<Database>;

/** Wraps a client so the Coach can never touch payment, security, secret or admin tables (COACH_DENIED_TABLES). */
export function guardCoachDb<T extends object>(db: T): T {
  return new Proxy(db, {
    get(target, prop, recv) {
      if (prop === "from")
        return (table: string) => {
          if (!coachMayAccess(table)) throw new Error(`COACH_ACCESS_DENIED:${table}`);
          return (Reflect.get(target, "from") as (t: string) => unknown).call(target, table);
        };
      if (prop === "rpc" || prop === "storage" || prop === "auth" || prop === "schema")
        throw new Error(`COACH_ACCESS_DENIED:${String(prop)}`);
      return Reflect.get(target, prop, recv);
    },
  });
}
async function adminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return guardCoachDb(supabaseAdmin);
}
const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });

export const TOOL_DEFS: { name: ToolName; description: string; parameters: unknown }[] = [
  {
    name: "get_life_twin",
    description:
      'Current Life Twin facts with source and confidence. Includes five_year_vision (the member\'s confirmed 5-year life direction as long-term objectives): use it for "what should I focus on this year?", to prioritise and to suggest future goals (via draft_goal_pathway when they choose to act), but it is not a list of active goals and never overrides their explicit choices.',
    parameters: obj(),
  },
  {
    name: "get_goals",
    description: "Active goals with priority, targets, deadlines and weekly time.",
    parameters: obj(),
  },
  {
    name: "get_plan",
    description: "Sessions planned for the next 7 days and the latest plan proposal.",
    parameters: obj(),
  },
  {
    name: "get_today",
    description: "Today's sessions, statuses and the next action.",
    parameters: obj(),
  },
  {
    name: "get_execution_history",
    description: "Last 14 days of session outcomes and reasons.",
    parameters: obj(),
  },
  {
    name: "request_replan",
    description:
      "Rebuild the plan with the deterministic planner (fits every active goal around commitments, meals, preferred times, exact weekdays and start times). It builds this week and, from Thursday onwards or when include_next_week is true, next week too, so 'Monday to Friday' requests are fully placed. When the member asked for accountability calls for sessions, pass call_for_sessions and every placed session in the next 14 days gets a call. When the member asked for the change it is applied at once; otherwise it offers a proposal.",
    parameters: obj(
      {
        reason: str("Why a new plan is needed"),
        include_next_week: { type: "boolean", description: "Also build next week" },
        call_for_sessions: {
          type: "string",
          enum: ["keep", "none", "training", "all"],
          description:
            "Book an accountability call for each placed session of this kind. 'keep' (default) keeps whatever the member already asked for; 'none' only when they asked to stop session calls",
        },
        call_lead_minutes: {
          type: "number",
          description:
            "Minutes before the session start to ring (0 = at the start time). Default 0.",
        },
        keep_going: {
          type: "boolean",
          description:
            "Plexecute keeps planning every following week (and booking the session calls) automatically until the goal is reached. Default true when the member asked for an ongoing plan.",
        },
        goal_id: {
          type: ["string", "null"],
          description: "Goal the ongoing plan serves; continuation stops when it is completed.",
        },
      },
      ["reason"],
    ),
  },
  {
    name: "propose_goal_change",
    description:
      "Suggest a change to an existing goal (an id returned by get_goals). The user edits and confirms it on the goal page. Prefer update_goal for concrete changes.",
    parameters: obj(
      { goal_id: str("Goal id"), change: str("Plain description of the suggested change") },
      ["goal_id", "change"],
    ),
  },
  {
    name: "propose_new_goal",
    description:
      "Create a brand-new goal. When the member asked for it in their own words it is active at once (then call request_replan to schedule it); otherwise it is saved as a proposal.",
    parameters: obj(
      {
        title: str("Short goal title"),
        domain: {
          type: "string",
          enum: ["training", "nutrition", "recovery", "learning", "career", "wellness", "other"],
        },
        why: str("Why the user wants this, in their words"),
        weekly_minutes: { type: "number", description: "Weekly time budget in minutes" },
        session_minutes: { type: "number", description: "Typical session length in minutes" },
        preferred_time: {
          type: "string",
          enum: ["morning", "midday", "evening", "any"],
          description:
            "When sessions should happen, e.g. morning for 'every morning when I wake up'",
        },
      },
      ["title", "domain"],
    ),
  },
  {
    name: "estimate_energy_needs",
    description:
      "Plexecute's nutrition engine estimate of daily maintenance calories, a target for gain/loss/maintenance, protein, fat and carbs, and expected weekly change. Uses the member's saved height, age, sex and activity; pass weight_kg (and anything else) the member just told you. Use before any diet plan, calorie or weight-gain/loss answer so you give real numbers.",
    parameters: obj(
      {
        weight_kg: { type: ["number", "null"], description: "Current weight in kg if known" },
        goal: { type: "string", enum: ["gain", "lose", "maintain"] },
        height_cm: { type: ["number", "null"], description: "Only if the member said it" },
        age: { type: ["number", "null"], description: "Only if the member said it" },
        sex: { type: ["string", "null"], description: "male | female, only if the member said it" },
        activity: {
          type: ["string", "null"],
          description: "low | light | moderate | high, only if known",
        },
        strength_training: {
          type: "boolean",
          description: "True if they train for muscle/strength",
        },
      },
      ["goal"],
    ),
  },
  {
    name: "get_training_context",
    description: "Active training programme and recent sets.",
    parameters: obj(),
  },
  {
    name: "get_nutrition_context",
    description: "Current nutrition targets and today's intake.",
    parameters: obj(),
  },
  {
    name: "get_recovery_context",
    description: "Today's recovery state from the recovery engine with reasons.",
    parameters: obj(),
  },
  {
    name: "get_learning_context",
    description: "Retrieval reviews due and learning progress.",
    parameters: obj(),
  },
  {
    name: "get_behaviour_patterns",
    description: "Completion rate by hour and domain over 28 days.",
    parameters: obj(),
  },
  {
    name: "get_experiments",
    description: "Personal experiments and their status.",
    parameters: obj(),
  },
  {
    name: "get_outcomes",
    description:
      "Life Outcome Ledger: meaningful progress recorded from the user's own data, with evidence class and source.",
    parameters: obj(),
  },
  {
    name: "start_experiment_proposal",
    description: "Suggest a personal experiment for the user to set up.",
    parameters: obj({ hypothesis: str("Hypothesis"), metric: str("What to measure") }, [
      "hypothesis",
      "metric",
    ]),
  },
  {
    name: "log_user_statement",
    description:
      "Record a fact the user stated about their average sleep, energy pattern, daily steps, weight or main blocker.",
    parameters: obj(
      {
        fact_key: {
          type: "string",
          enum: ["avg_sleep_hours", "energy_pattern", "daily_steps", "weight_kg", "main_blocker"],
        },
        value: str("Value as stated"),
      },
      ["fact_key", "value"],
    ),
  },
  {
    name: "search_food",
    description: "Search the user's saved foods.",
    parameters: obj({ query: str("Food name") }, ["query"]),
  },
  {
    name: "propose_food_log",
    description: "Suggest logging a saved food. The user confirms it on the nutrition page.",
    parameters: obj({ food_name: str("Food name"), grams: { type: "number" } }, [
      "food_name",
      "grams",
    ]),
  },
  {
    name: "request_calendar_change",
    description:
      "Only for vague plan wishes. For concrete moves/removals/clearing a day use edit_plan.",
    parameters: obj({ change: str("Suggested change") }, ["change"]),
  },
  {
    name: "request_call_setting_change",
    description: "Suggest a change to accountability call settings.",
    parameters: obj({ change: str("Suggested change") }, ["change"]),
  },
  {
    name: "get_knowledge_evidence",
    description: "Sourced guidance from the knowledge library for a question.",
    parameters: obj({ query: str("Question") }, ["query"]),
  },
  {
    name: "get_schedule_context",
    description:
      "The user's fixed commitments (appointments, meetings, shifts, exams, deadlines), scheduled accountability calls and their outcomes.",
    parameters: obj(),
  },
  {
    name: "get_journal_context",
    description:
      "Recent daily check-ins, recovery check-ins, goal reflections, progress entries and wellness sessions.",
    parameters: obj(),
  },
  {
    name: "schedule_commitment",
    description:
      "Save an appointment, meeting, exam, deadline or other dated commitment the user tells you about, and optionally an accountability phone call before it. Use it whenever the user mentions a dated event or asks to be called or rung. Repeating it never creates duplicates.",
    parameters: obj(
      {
        title: str("Short name, e.g. Doctor's appointment"),
        kind: str("appointment | meeting | study | shift | family | travel | other"),
        day: str(
          "The day as the user said it: today, tomorrow, a weekday (friday, next monday) or YYYY-MM-DD",
        ),
        time: str(
          'Start time as 24h HH:MM. Read plain hours sensibly ("at 2" for a dentist is 14:00)',
        ),
        duration_minutes: { type: "number", description: "Length in minutes; 60 if unknown" },
        call_lead_minutes: {
          type: ["number", "null"],
          description:
            "Call this many minutes before the start (e.g. 30). Null if no call or call_time is given.",
        },
        call_time: {
          type: ["string", "null"],
          description: "Exact call time HH:MM on that day if the user named one, else null",
        },
        note: { type: ["string", "null"], description: "Optional note" },
        in_minutes: {
          type: ["number", "null"],
          description:
            'For relative requests ("call me in 10 minutes", "remind me in an hour"): minutes from now. The server works out the exact local day and time, and day/time/call fields are ignored. Null otherwise.',
        },
      },
      [
        "title",
        "kind",
        "day",
        "time",
        "duration_minutes",
        "call_lead_minutes",
        "call_time",
        "note",
        "in_minutes",
      ],
    ),
  },
  {
    name: "schedule_meals",
    description:
      "Put meals onto the member's daily plan at set times, for one or more days, each optionally with a reminder phone call. Use whenever the member wants their diet/meal plan, meal times or eating reminders on their daily plan or calendar. With a meal plan, pass from_meal_plan true and slot_times: each day then shows that day's exact meal with calories and protein (meals is ignored) and earlier generic meal entries for those days are replaced. If the member gave no times, use sensible defaults (breakfast 07:30, lunch 12:30, snack 16:00, dinner 19:00) and say so. Saves for real; repeating never duplicates; times already passed today are skipped.",
    parameters: obj(
      {
        meals: {
          type: "array",
          items: obj({ name: str("e.g. Breakfast: overnight oats"), time: str("HH:MM 24h") }, [
            "name",
            "time",
          ]),
        },
        start_day: str("First day: today, tomorrow, a weekday or YYYY-MM-DD"),
        days: {
          type: "number",
          description: "How many consecutive days (1-14); 7 for a weekly plan",
        },
        call_reminders: {
          type: "boolean",
          description: "Ring the member at each meal time to remind them to eat",
        },
        from_meal_plan: {
          type: "boolean",
          description: "Use each day's real meals from the member's meal plan",
        },
        slot_times: {
          type: "object",
          description: "HH:MM per meal slot when from_meal_plan is true",
          properties: {
            breakfast: { type: "string" },
            lunch: { type: "string" },
            snack: { type: "string" },
            dinner: { type: "string" },
          },
        },
        until_goal: {
          type: "boolean",
          description:
            "Keep the meals (and their calls) going every week until the goal is reached, rotating the weekly menu. True whenever the member wants the diet to continue ('until I reach my goal', 'every day', 'ongoing').",
        },
        goal_id: {
          type: ["string", "null"],
          description:
            "The goal this diet serves (id from get_goals); the meals stop when it is completed.",
        },
        target_weight_kg: {
          type: ["number", "null"],
          description: "Target body weight; the meals stop once a logged weight reaches it.",
        },
      },
      ["start_day", "days", "call_reminders"],
    ),
  },
  {
    name: "cancel_scheduled_call",
    description: "Cancel a scheduled accountability call (id from get_schedule_context).",
    parameters: obj({ call_id: str("Scheduled call id") }, ["call_id"]),
  },
  {
    name: "set_notification_preferences",
    description:
      "Change how Coach prompts the member with notifications for their plan (the same settings as Settings → Notifications): e.g. 'remind me 15 minutes before workouts' (lead_minutes 15), 'stop meal notifications' (mute ['meal']), 'don't notify me after 10pm' (quiet_start '22:00', quiet_end their wake time or '07:00'), 'turn notifications off'. Kinds: wake, bedtime, meal, workout, learning, task, appointment, journey, call, family, routine, deadline, prep. Only send fields the member asked to change.",
    parameters: obj({
      enabled: { type: "boolean", description: "All Coach prompts on/off" },
      lead_minutes: { type: "number", description: "Warning before sessions, 5-120" },
      motivating: { type: "boolean", description: "Motivating tone on/off" },
      quiet_start: str("HH:MM quiet hours start"),
      quiet_end: str("HH:MM quiet hours end"),
      mute: { type: "array", items: { type: "string" }, description: "Kinds to stop" },
      unmute: { type: "array", items: { type: "string" }, description: "Kinds to allow again" },
    }),
  },
  {
    name: "get_call_readiness",
    description:
      "Whether the member's scheduled calls will actually ring, and exactly what is blocking them (phone not verified, consent not given, calling country not switched on by Plexecute, scheduler not running). Call before promising a call.",
    parameters: obj({}),
  },
  {
    name: "start_phone_verification",
    description:
      "Text a verification code to the member's own mobile so Plexecute can call them. Use only with a number the member typed in this chat, in international format (+44..., +1...). Never repeat the number back in full.",
    parameters: obj({ phone: str("Member's mobile in international format") }, ["phone"]),
  },
  {
    name: "confirm_phone_code",
    description: "Check the code the member received by text and mark their phone verified.",
    parameters: obj({ code: str("The digits from the text") }, ["code"]),
  },
  {
    name: "give_call_consent",
    description:
      "Record the member's consent to automated AI accountability calls. Only call this after you have told them: 'Plexecute will place automated AI calls to your verified number at the times you set. You can say STOP or stop all calls at any time.' and they replied yes in this chat.",
    parameters: obj(
      { agreed: { type: "boolean", description: "True only if they explicitly said yes" } },
      ["agreed"],
    ),
  },
  {
    name: "get_life_intelligence",
    description:
      "Cross-goal reasoning from real records: exact goal status (active/proposed/paused), prerequisites still open, money/time conflicts between goals, projected finish vs deadline, 2-4 metrics per goal, repeated-miss patterns with evidence-backed causes, which 5-year objectives have nothing active, unknowns and a confidence level. Use for 'am I on track?', 'what should I focus on?', 'what am I ignoring?', competing goals, repeated misses, and before building a multi-area plan. Pass monthly_budget only if the member stated it in this conversation.",
    parameters: obj({
      monthly_budget: {
        type: "number",
        description: "Money available per month for goals, only if the member said it",
      },
    }),
  },
  {
    name: "explain_plan_item",
    description:
      "Why a plan item exists: the real chain from the session to its milestone, goal, any goal it is needed for and any linked 5-year objective. Pass block_id from get_plan/get_today, or a title fragment.",
    parameters: obj({
      block_id: str("Plan block id if known"),
      title: str("Part of the item's title"),
    }),
  },
  {
    name: "get_session_brief",
    description:
      "The execution-ready brief for one scheduled session: exact objective, first step, ordered steps, the real workout/meal prep/booking/journey details, attached resources (real links only, or 'still needs confirming'), what counts as done, what comes next, and the why chain (milestone, goal). Use for 'what do I do first?', 'what is this session?', 'I don't understand this resource' and 'when am I finished?'. Pass block_id from get_plan/get_today.",
    parameters: obj({ block_id: str("Plan block id") }, ["block_id"]),
  },
  {
    name: "brief_my_day",
    description:
      "Today's briefing from Plexecute data only: sessions, commitments, confirmed bookings, journeys, scheduled calls, deadlines in the next 14 days, real risks and one priority. Use for 'brief me on my day' / 'what's on today'. No weather or news.",
    parameters: obj(),
  },
  {
    name: "review_my_week",
    description:
      "The last 7 days: planned vs completed vs missed, per-goal results, recurring blockers with evidence, goals with nothing scheduled, trajectory changes and suggested changes for next week. Use for 'how did my week go?'. Offer request_replan to apply the changes.",
    parameters: obj(),
  },
  {
    name: "get_mission",
    description:
      "The member's Goal Mission from saved records: stage, Goal Definition (outcome, done, horizon, starting point, unknowns, confidence), next scheduled sessions, milestones, open blockers (HARD/SOFT/UNKNOWN/RESOLVABLE with a route around), the saved decision record (specialist views, disagreements, trade-offs, chosen route, rationale), route options, recent changes, the planner's real placement rationale and the likely root cause of misses. Use for 'what are we doing next?', 'why this way?', 'what's blocking me?', 'am I on track?', 'what changed?', 'what should I do tonight?'. No args lists missions.",
    parameters: obj({
      mission_id: str("Mission id"),
      goal_id: str("Goal id"),
      title: str("Part of the goal title"),
    }),
  },
  {
    name: "fix_repeated_misses",
    description:
      "For 'why do I keep missing this?' or repeated skipped/missed sessions of one goal: reads the goal's real execution history, finds the root cause (time clash, sessions too long, fatigue, unclear action, missing prerequisite, cost, priority), retrieves the Plexecute behaviour/productivity knowledge for that cause and works out the plan change it implies (shorter sessions, new time of day, lighter week). Without apply it returns the diagnosis and the proposed change: explain the cause from the evidence and ask one yes/no question to apply it. With apply true (the member said yes or told you to fix it) it changes the goal and rebuilds the week so future sessions follow the fix, saving the cause, change and knowledge ids as the decision rationale.",
    parameters: obj({
      goal_id: str("Goal id (from get_goals); omit to use the goal with the most recent misses"),
      apply: {
        type: "boolean",
        description: "Apply the change now (only when the member asked or agreed)",
      },
    }),
  },
  {
    name: "protect_recurring_time",
    description:
      "Save a RECURRING fixed time the member states as off-limits for planned work (never the time they offer FOR their goal — that is availability, not a block): job hours (9-5 weekdays), family time (weekends), children's bedtime routine (e.g. 17:30-19:30 weekdays), religious, care or sports commitments. The planner then never places sessions over it. Call it for every such boundary BEFORE request_replan or draft_goal_pathway. Idempotent.",
    parameters: obj(
      {
        title: str("Short name, e.g. Family time, Kids' bedtime routine, Work"),
        kind: str("family | shift"),
        days: {
          type: "array",
          items: { type: "number" },
          description: "ISO weekdays 1=Mon..7=Sun",
        },
        start_time: str("HH:MM 24h"),
        end_time: str("HH:MM 24h (23:59 for until the end of the day)"),
      },
      ["title", "kind", "days", "start_time", "end_time"],
    ),
  },
  {
    name: "triage_tonight",
    description:
      "For 'I have too much to do tonight', 'sort out my evening', overwhelm about today: reads tonight's saved plan entries, fixed commitments and calendar busy time, goal priorities, deadlines and active missions, calculates the real free minutes until bedtime, keeps the highest-priority work that fits, moves lower-priority work to tomorrow (never deletes) and returns the first action. Call it BEFORE asking what is due. Applies when the member asked to sort it out or said they have too much; otherwise previews.",
    parameters: obj({
      end_minutes: {
        type: "number",
        description:
          "Evening end as minutes from midnight if the member stated one (default 22:30 = 1350)",
      },
      apply: { type: "boolean", description: "Apply the reorganisation (member asked or agreed)" },
    }),
  },
  {
    name: "advance_mission",
    description:
      "Create or update the durable Goal Mission for a meaningful goal or dream, and move its stage. Call it first for any substantial new goal or vague dream (title + member_text), then again as facts arrive (contract fields), after research (checkpoint.research_id), after comparing routes (options + member_factors: it ranks them deterministically), after reconciling specialists for complex goals (council: one view per relevant expert with stance, binding constraint and urgency, plus selected_route), when blockers are found, and when the pathway is accepted (to_state PATHWAY_READY), planned (SCHEDULED) or changed (ADAPTING). It refuses illegal jumps, refuses PATHWAY_READY while the outcome is still vague, and refuses ACHIEVED without a completed goal. It returns clarifying_questions (ask only these, at most 3, before planning a vague dream), experts_to_consider, council_needed and next_needed.",
    parameters: obj({
      mission_id: str("Existing mission id"),
      goal_id: str("Linked goal id once it exists"),
      title: str("Short goal title"),
      member_text: str("The member's own words"),
      to_state: {
        type: "string",
        enum: [
          "UNDERSTANDING",
          "RESEARCHING",
          "MODELLING",
          "FEASIBILITY_CHECK",
          "PATHWAY_READY",
          "PLANNING",
          "SCHEDULED",
          "EXECUTING",
          "BLOCKED",
          "ADAPTING",
          "VERIFYING",
          "ACHIEVED",
        ],
      },
      why: str("Reason for the stage change"),
      contract: {
        type: "object",
        description:
          "Goal Definition facts the member actually gave or research established: desired_outcome, definition_of_done, target_horizon, current_state, life_direction, success_metrics[], constraints[], resources[], prerequisites[], dependencies[], assumptions[], unknowns[], risks[], evidence_required",
      },
      blockers: {
        type: "array",
        items: {
          type: "object",
          properties: { area: { type: "string" }, detail: { type: "string" } },
        },
      },
      options: {
        type: "array",
        description: "2-3 realistic routes",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            name: { type: "string" },
            months: { type: "number" },
            cost: { type: "number" },
            needs: { type: "array", items: { type: "string" } },
            risk: { type: "string", enum: ["low", "medium", "high"] },
            fits_schedule: { type: "boolean" },
          },
        },
      },
      member_factors: {
        type: "object",
        properties: {
          budget: { type: "number" },
          horizonMonths: { type: "number" },
          has: { type: "array", items: { type: "string" } },
        },
      },
      council: {
        type: "object",
        properties: {
          views: {
            type: "array",
            items: {
              type: "object",
              properties: {
                expert: { type: "string" },
                stance: { type: "string" },
                constraint: { type: "string" },
                urgency: { type: "string", enum: ["now", "soon", "later"] },
              },
            },
          },
          selected_route: { type: "string" },
          alternatives: { type: "array", items: { type: "string" } },
          assumptions: { type: "array", items: { type: "string" } },
        },
      },
      checkpoint: {
        type: "object",
        description: "Where work stopped, e.g. {step, research_id, pathway_drafted}",
      },
      new_goal: {
        type: "boolean",
        description:
          "True only when the member starts a genuinely different goal; otherwise the mission being discussed continues",
      },
    }),
  },
  {
    name: "build_learning_pathway",
    description:
      "Use whenever the member wants to learn or study a subject (e.g. 'I want to learn organic marketing for my app', 'learn project management', 'learn Spanish'). Runs the real Learning system: reuses an existing pathway for that subject or finds real free courses, books, videos and webinars, saves the pathway in Learning (a learning goal with topics and resources) and schedules the first execution-ready study sessions. Never replace this with generic advice. Report the resources, first session and that it is in Learning.",
    parameters: obj(
      {
        subject: str(
          "What they want to learn, including their context, e.g. 'organic marketing for my app'",
        ),
        level: str("beginner | intermediate | advanced"),
        session_minutes: { type: "number", description: "Minutes per study session if stated" },
        start_time: str("HH:MM if the member stated a study time"),
      },
      ["subject"],
    ),
  },
  {
    name: "research_topic",
    description:
      "Live research for any current, external, changing or location-specific information: jobs, courses, qualifications, regulations, businesses, prices, services, travel, communities and recent facts. Use automatically when needed, even if the member did not say search. Returns real sources and synthesis, distinguishing quoted verified facts from discoveries and unknown details; not every question needs tasks or a goal.",
    parameters: obj(
      {
        query: str("What to research"),
        jurisdiction: str("Country or region, e.g. United Kingdom"),
        goal_id: str("Linked goal id"),
        context: str(
          "Relevant context from the member's words or saved records only. Omit unrelated personal context; never guess.",
        ),
      },
      ["query", "jurisdiction"],
    ),
  },
  {
    name: "schedule_execution_queue",
    description:
      "Put a timed queue of execution-ready tasks on the member's plan for one day (today by default), e.g. today's waitlist marketing, a study hour, a job-application session, a finance evening. Each task needs an exact title (never 'work on X'), the exact action, what counts as done, and where relevant the destination, real https link, posting/usage rule, first step, prepared copy ready to paste and what to record. Fits around existing entries and commitments, skips past times, updates rather than duplicates on repeat. The tasks show on Today and Plan. Up to 24 tasks per call; when the result's capacity.free_minutes_left is large, call again for the same day to fill the window.",
    parameters: obj(
      {
        day: str("today, tomorrow or YYYY-MM-DD"),
        goal_id: {
          type: ["string", "null"],
          description: "The existing goal this work serves (from get_goals), or null",
        },
        domain: str("career | business | learning | finance | training | other"),
        mission_id: {
          type: ["string", "null"],
          description:
            "The Goal Mission this work serves (get_mission); outcomes roll up to it even while its goal is still a proposal",
        },
        all_day: {
          type: ["boolean", "null"],
          description:
            "true when the member said all day / the whole day; fills their real working window with lunch/dinner breaks",
        },
        window_end: {
          type: ["string", "null"],
          description:
            "HH:MM when the member's stated window ends (e.g. 21:00 for all day unless they said otherwise, 22:00 for tonight)",
        },
        replace_open: {
          type: ["boolean", "null"],
          description:
            "true when this list replaces earlier open tasks for that day (they are cancelled), e.g. after new facts made them wrong",
        },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              start_time: {
                type: ["string", "null"],
                description: "HH:MM local, or null to follow the previous task",
              },
              minutes: { type: "number" },
              destination: { type: ["string", "null"] },
              link: { type: ["string", "null"] },
              rule: { type: ["string", "null"] },
              action: { type: "string" },
              first_step: { type: ["string", "null"] },
              prepared_copy: { type: ["string", "null"] },
              done_when: { type: "string" },
              record: { type: ["string", "null"] },
            },
            required: ["title", "minutes", "action", "done_when"],
          },
        },
      },
      ["tasks"],
    ),
  },
  {
    name: "update_execution_task",
    description:
      "Record what happened to a queued task when the member says 'done', reports a result ('got 15 signups') or a failure ('they removed my post'), and returns the next task. With no task_id it uses the task they are on now. status pause_rest moves every unfinished task today to tomorrow in order ('I need to stop now, continue tomorrow').",
    parameters: obj(
      {
        task_id: { type: ["string", "null"] },
        mission_id: { type: ["string", "null"] },
        status: { type: "string", enum: ["done", "partial", "skipped", "blocked", "pause_rest"] },
        outcome_note: { type: ["string", "null"] },
        metric_label: { type: ["string", "null"], description: "e.g. signups" },
        metric_value: { type: ["number", "null"] },
        reason: { type: ["string", "null"], description: "Why it failed or was skipped" },
        resume_time: { type: ["string", "null"], description: "HH:MM tomorrow for pause_rest" },
      },
      ["status"],
    ),
  },
];

TOOL_DEFS.push(...COACH_ACTION_DEFS);

export type ToolCtx = {
  db: Db;
  userId: string;
  tier: string;
  tz: string | null;
  actions: CoachAction[];
  evidenceRefs: string[];
  safety: string[];
  messageId?: string;
  /** The member's own words this turn (before attachments), for intent checks. */
  memberText?: string;
  /** Areas a multi-area request touches; goal tools remind the reply to join them up. */
  areas?: string[];
  /** When this Coach turn started (ms), so research stays inside the turn's time budget. */
  turnStarted?: number;
};

async function usedInWindow(ctx: ToolCtx, tool: ToolName) {
  const a = FREE_ALLOWANCE[tool];
  if (!a) return 0;
  const since =
    a.window === "localDay"
      ? startOfLocalDay(new Date(), ctx.tz).toISOString()
      : new Date(Date.now() - 7 * 864e5).toISOString();
  const { count } = await ctx.db
    .from("coach_tool_calls")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId)
    .eq("tool", tool)
    .eq("allowed", true)
    .gte("created_at", since);
  return count ?? 0;
}

export async function runTool(
  ctx: ToolCtx,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const def = TOOL_DEFS.find((t) => t.name === name);
  if (!def) return { error: "unknown_tool" };
  const tool = def.name;
  const gate = gateTool(tool, ctx.tier, await usedInWindow(ctx, tool));
  const supabaseAdmin = await adminDb();
  await supabaseAdmin.from("coach_tool_calls").insert({
    user_id: ctx.userId,
    tool,
    allowed: gate.allowed,
    reason: gate.allowed ? null : gate.reason,
    args: args as never,
  });
  if (!gate.allowed)
    return {
      error:
        gate.reason === "paid_only"
          ? "This needs Pro or Execute."
          : "This week's or today's free allowance is used.",
    };
  // An existing company's stage decides what the work is: no goal, pathway or rebuild for "scale my company" until it is known.
  if (
    [
      "propose_new_goal",
      "draft_goal_pathway",
      "request_replan",
      "schedule_execution_queue",
    ].includes(tool)
  ) {
    const { data: ms } = await supabaseAdmin
      .from("goal_missions")
      .select("title,contract,updated_at")
      .eq("user_id", ctx.userId)
      .neq("state", "ACHIEVED")
      .order("updated_at", { ascending: false })
      .limit(1);
    const m = (ms ?? [])[0] as any;
    const words = `${m?.title ?? ""} ${m?.contract?.desired_outcome ?? ""}`.toLowerCase();
    const said = String(ctx.memberText ?? "").toLowerCase();
    const stageSaid =
      /\b(launch(ed)?|pre-?launch|live|users|customers|revenue|waiting list|waitlist|mvp|beta|idea stage)\b/.test(
        said,
      );
    if (
      m &&
      /\b(scale|grow|expand)\b/.test(words) &&
      /\b(company|business|startup|platform)\b/.test(words) &&
      !m.contract?.current_state &&
      !stageSaid
    )
      return {
        error: "stage_unknown",
        hint: "The company's stage is not known yet. Save what the member said (advance_mission contract) and ask one short question: is it pre-launch or launched (users, customers, revenue)? Do not create a goal, pathway or schedule yet.",
      };
  }
  // Difficulty feedback adapts the existing programme; it never rebuilds it.
  if (
    tool === "change_training_programme" &&
    (await import("./training")).effortFeedback(ctx.memberText)
  ) {
    return {
      error: "use_update_execution_task",
      hint: "This is feedback on a workout: call update_execution_task (status done, outcome_note with the feedback). It adapts the programme and the next workout.",
    };
  }
  // Questions asked for a vague goal are awaiting answers: a question from the member (e.g. "why?") is answered, not turned into a goal or plan.
  if (["propose_new_goal", "draft_goal_pathway"].includes(tool)) {
    const said = String(ctx.memberText ?? "").trim();
    const isQuestion =
      /\?\s*$/.test(said) ||
      /^(why|what|how|can|could|do|does|is|are|will|would|should)\b/i.test(said);
    if (isQuestion && !(await import("./life-intelligence")).memberInstructed(said)) {
      const { data: ms } = await supabaseAdmin
        .from("goal_missions")
        .select("goal_id,state,checkpoint,contract")
        .eq("user_id", ctx.userId)
        .is("goal_id", null)
        .neq("state", "ACHIEVED");
      const M = await import("./mission");
      if (
        (ms ?? []).some(
          (m: any) => m.checkpoint?.clarify_asked && !M.readyForPathway(m.contract ?? {}),
        )
      )
        return {
          error: "awaiting_answers",
          hint: "Your clarifying questions are still unanswered. Answer the member's question in words only, then repeat the unanswered questions. Do not create a goal, pathway or proposal yet.",
        };
    }
  }
  try {
    // Development drill only (compiled out of production): a real failing database for this turn.
    const FI = await import("./fault-injection.server");
    if (FI.faultOn(ctx.userId, "action") && !tool.startsWith("get_"))
      ctx = { ...ctx, db: FI.failingDb(ctx.db) };
    const out = await exec({ ...ctx, db: guardCoachDb(ctx.db) }, tool, args);
    // A fitness goal created or edited next to a programme folds into the programme's goal (no competing workouts).
    if (
      [
        "propose_new_goal",
        "draft_goal_pathway",
        "update_goal",
        "change_training_programme",
      ].includes(tool) &&
      out &&
      typeof out === "object" &&
      !(out as { error?: unknown }).error
    ) {
      const u = await (
        await import("./training-goal.server")
      )
        .unifyTrainingGoal(ctx.userId)
        .catch(() => null);
      if (u?.changed)
        (out as Record<string, unknown>)["training_goal"] = {
          linked_to: u.keeper_goal_id,
          note: "This fitness goal and the training programme are one goal now; its workouts are the programme sessions. Never add separate fitness sessions.",
        };
    }
    // Days the member offered for a new goal ("Monday, Wednesday and Thursday evenings") become its preferred days.
    if (
      ["propose_new_goal", "draft_goal_pathway"].includes(tool) &&
      out &&
      typeof out === "object" &&
      !(out as { error?: unknown }).error
    ) {
      const av = (await import("./boundaries")).extractAvailability(String(ctx.memberText ?? ""));
      if (av) {
        const { data: fresh } = await supabaseAdmin
          .from("goals")
          .select("id,preferred_days")
          .eq("user_id", ctx.userId)
          .eq("status", "active")
          .gte("created_at", new Date(Date.now() - 15 * 60000).toISOString());
        for (const g of (fresh ?? []) as { id: string; preferred_days: number[] | null }[])
          if (!g.preferred_days?.length)
            await supabaseAdmin
              .from("goals")
              .update({
                preferred_days: av.days,
                ...(av.part ? { preferred_time: av.part } : {}),
                ...(av.weeklyMinutes
                  ? {
                      weekly_minutes: av.weeklyMinutes,
                      session_minutes: Math.round(av.weeklyMinutes / av.days.length),
                    }
                  : {}),
              } as never)
              .eq("id", g.id)
              .eq("user_id", ctx.userId);
        (out as Record<string, unknown>)["preferred_days_set"] = av;
      }
    }
    // Goal Mission sync: saved goals/pathways link to the open mission and move it forward; rebuilt weeks mark it scheduled.
    if (
      [
        "propose_new_goal",
        "draft_goal_pathway",
        "request_replan",
        "change_training_programme",
        "update_goal",
      ].includes(tool) &&
      out &&
      typeof out === "object" &&
      !(out as { error?: unknown }).error
    ) {
      try {
        const note = await (
          await import("./mission.server")
        ).syncFromTool(await adminDb(), ctx.userId, tool, args, out as Record<string, unknown>);
        if (note) return { ...(out as object), mission_note: note };
      } catch (e) {
        console.error("mission sync", e);
      }
    }
    if (
      ctx.areas?.length &&
      /goal|pathway/.test(tool) &&
      out &&
      typeof out === "object" &&
      !Array.isArray(out)
    )
      return {
        ...(out as object),
        reply_must_also_cover: `In plain words, how ${ctx.areas.join(", ")} fit together for this goal around their real schedule (one joined-up plan, not only the goal status).`,
      };
    return out;
  } catch (e) {
    console.error("tool", tool, e);
    return { error: "tool_failed" };
  }
}

async function exec(ctx: ToolCtx, tool: ToolName, a: Record<string, unknown>): Promise<unknown> {
  const { db, userId } = ctx;
  const today = localDayKey(new Date(), ctx.tz);
  const dayStart = startOfLocalDay(new Date(), ctx.tz);
  const s = (k: string) => String(a[k] ?? "").slice(0, 300);
  if ((COACH_ACTION_TOOLS as readonly string[]).includes(tool))
    return execActionTool(
      {
        db,
        admin: await adminDb(),
        userId,
        tier: ctx.tier,
        tz: ctx.tz,
        actions: ctx.actions,
        ...(ctx.messageId ? { messageId: ctx.messageId } : {}),
        ...(ctx.memberText ? { memberText: ctx.memberText } : {}),
      },
      tool as CoachActionTool,
      a,
    );
  switch (tool) {
    case "get_mission": {
      const view = (await (
        await import("./mission.server")
      ).missionView(
        db,
        userId,
        {
          mission_id: a["mission_id"] ? s("mission_id") : null,
          goal_id: a["goal_id"] ? s("goal_id") : null,
          title: a["title"] ? s("title") : null,
        },
        ctx.tz,
      )) as Record<string, unknown> | null;
      const admin = await adminDb();
      // Tonight's saved reorganisation is part of the decision record "why did you plan it this way?" answers from.
      const { data: ev } = await admin
        .from("plan_block_events")
        .select("metadata")
        .eq("user_id", userId)
        .eq("reason_code", "evening_overload")
        .gte("created_at", new Date(Date.now() - 18 * 3600e3).toISOString())
        .order("created_at", { ascending: false })
        .limit(1);
      const tonight = (ev?.[0]?.metadata as { decision?: unknown } | undefined)?.decision ?? null;
      const hasMission = !!view && !("missions" in view) && !(view as { error?: unknown }).error;
      if (hasMission) return { ...view, ...(tonight ? { tonight_reorganisation: tonight } : {}) };
      // No mission yet: the member's main goal is their highest-priority active goal, with its next real session.
      const { data: goals } = await admin
        .from("goals")
        .select("id,title,priority,deadline,weekly_minutes,session_minutes")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("priority", { ascending: false })
        .order("deadline", { ascending: true, nullsFirst: false })
        .limit(3);
      const main = (goals ?? [])[0] as { id: string; title: string } | undefined;
      let next: unknown = null;
      if (main) {
        const { data: nb } = await admin
          .from("plan_blocks")
          .select("title,starts_at,duration_min,status")
          .eq("user_id", userId)
          .eq("goal_id", main.id)
          .in("status", ["planned", "scheduled", "upcoming", "due", "snoozed"])
          .gte("starts_at", new Date(Date.now() - 30 * 60000).toISOString())
          .order("starts_at")
          .limit(1);
        const b = (nb ?? [])[0] as
          { title: string; starts_at: string; duration_min: number } | undefined;
        if (b)
          next = {
            title: b.title,
            day: localDayKey(b.starts_at, ctx.tz),
            time: localHm(b.starts_at, ctx.tz),
            minutes: b.duration_min,
          };
      }
      return {
        ...(view ?? {}),
        no_mission: true,
        main_goal: main ?? null,
        other_goals: (goals ?? []).slice(1),
        next_session: next,
        ...(tonight ? { tonight_reorganisation: tonight } : {}),
        instruction: main
          ? "No mission record exists, but the member has active goals: treat main_goal (highest priority, nearest deadline) as their main goal and answer from it and next_session. For 'why did you plan it this way?' use tonight_reorganisation if present (its basis), never disown it. Do not ask which goal they mean."
          : "No goals yet: ask for the goal in one short question.",
      };
    }
    case "fix_repeated_misses":
      return fixRepeatedMisses(ctx, a, today);
    case "protect_recurring_time": {
      const days = (Array.isArray(a["days"]) ? (a["days"] as unknown[]) : [])
        .map(Number)
        .filter((d) => d >= 1 && d <= 7);
      const st = /^\d{1,2}:\d{2}$/.test(s("start_time")) ? s("start_time").padStart(5, "0") : null;
      const en = /^\d{1,2}:\d{2}$/.test(s("end_time")) ? s("end_time").padStart(5, "0") : null;
      if (!days.length || !st || !en || en <= st)
        return {
          error: "invalid_time",
          hint: "Give ISO days and HH:MM start/end with end after start.",
        };
      if (!["family", "shift"].includes(s("kind")))
        return {
          error: "not_a_boundary",
          hint: "Only job hours (shift) or family time (family) are protected; time the member offers for a goal is availability.",
        };
      const kind = s("kind");
      // Only boundaries the member actually stated: family words for family time, job words for work hours.
      const said = String(ctx.memberText ?? "");
      const titleT = s("title");
      if (
        (kind === "family" &&
          !/\b(family|kids?|child(ren)?|partner|wife|husband|bedtime|weekends?|school|son|daughter)\b/i.test(
            said,
          )) ||
        (kind === "shift" && !/\b(work|job|shift|9-5|9 ?to ?5|office|hours)\b/i.test(said)) ||
        /pathway|career|study|goal|business work|project/i.test(titleT)
      )
        return {
          error: "not_a_stated_boundary",
          hint: "That is time for the goal (availability). Set it on the goal with update_goal days_of_week/start_time instead.",
        };
      const key = `coach:recurring:${kind}:${[...new Set(days)].sort().join("")}:${st}-${en}`;
      const admin = await adminDb();
      const { data: ex } = await admin
        .from("commitments")
        .select("id")
        .eq("user_id", userId)
        .eq("dedupe_key", key)
        .limit(1);
      if (ex?.length) return { saved: true, already_saved: true };
      const { error } = await admin.from("commitments").insert({
        user_id: userId,
        title: s("title").slice(0, 120) || "Protected time",
        kind,
        recurrence: "weekly",
        days: [...new Set(days)].sort(),
        start_time: st,
        end_time: en,
        is_hard: true,
        active: true,
        dedupe_key: key,
        source: "coach",
      });
      if (error) return { error: "could_not_save", detail: error.message };
      return {
        saved: true,
        basis: "MEMBER_FACT",
        note: "The planner will now keep work out of this time.",
      };
    }
    case "triage_tonight":
      return (await import("./evening-triage.server")).triageTonight(ctx as never, a);
    case "advance_mission": {
      const MS = await import("./mission.server");
      return MS.advanceMission(await adminDb(), userId, {
        ...(a as object),
        member_text: (a["member_text"] as string) ?? ctx.memberText ?? null,
        domains: ctx.areas ?? [],
        knowledge: (
          ((ctx as any).turnKnowledge?.evidence ?? []) as {
            chunk_id: string;
            title: string;
            domain: string;
          }[]
        )
          .filter((e) => e.domain !== "safety")
          .map((e) => ({ id: e.chunk_id, title: e.title, domain: e.domain })),
      } as never);
    }
    case "build_learning_pathway":
      return (await import("./learning-pathway.server")).buildLearningPathway(ctx as never, a);
    case "research_topic": {
      const { isInformationOnly } = await import("./research");
      const { currentEmployerQuestion, EMPLOYER_EVIDENCE_POLICY } =
        await import("./employer-research");
      const q =
          ctx.memberText && isInformationOnly(ctx.memberText)
            ? ctx.memberText.slice(0, 300)
            : s("query"),
        j = s("jurisdiction") || "United Kingdom";
      const { data: prior } = await db
        .from("career_research")
        .select("id,created_at")
        .ilike("query", q)
        .eq("jurisdiction", j)
        .gte("created_at", new Date(Date.now() - 86400000).toISOString())
        .eq("user_id", userId)
        .limit(1);
      const previous = prior?.[0];
      if (previous) {
        const { RESEARCH_POLICY_VERSION } = await import("./research");
        const { data: completed } = await db
          .from("audit_events")
          .select("metadata")
          .eq("resource_id", previous.id)
          .eq("action", "research.completed")
          .limit(1);
        const metadata = completed?.[0]?.metadata as
          { policy?: string; sufficient?: boolean; employer_policy?: string } | undefined;
        const { count } = await db
          .from("research_findings")
          .select("id", { count: "exact", head: true })
          .eq("research_id", previous.id);
        if (
          count &&
          count > 0 &&
          metadata?.policy === RESEARCH_POLICY_VERSION &&
          (!currentEmployerQuestion(q) || metadata.employer_policy === EMPLOYER_EVIDENCE_POLICY) &&
          metadata.sufficient === true
        ) {
          const { data: sources } = await db
            .from("research_sources")
            .select("url,title")
            .eq("research_id", previous.id)
            .limit(12);
          return {
            reused: true,
            sources: sources ?? [],
            research_id: previous.id,
            note: "Read get_research_findings with this exact research_id. This is saved research, not a new live search. Use its linked interpretation and name three sampled employers with essential/desirable qualifications and direct advert links for employer questions; link every channel and its available posting terms for discovery. Do not replace evidence with generic advice.",
          };
        }
      }
      try {
        const R = await import("./research.functions");
        let goalId: string | null = null;
        if (/^[0-9a-f-]{36}$/i.test(s("goal_id")))
          goalId =
            (await db.from("goals").select("id").eq("id", s("goal_id")).maybeSingle()).data?.id ??
            null;
        const context = s("context");
        const out = await R.runResearchCore(
          { goalId, query: q.slice(0, 300), jurisdiction: j.slice(0, 80), context },
          {
            userId,
            supabase: db,
            ...(ctx.turnStarted ? { turnStarted: ctx.turnStarted } : {}),
          },
        );
        return {
          response_requirement:
            "Include direct clickable source links in your answer. For employer questions give three named employers' actual essential/desirable requirements from the evidence, alongside learning advice. For discovery link every destination and state confirmed/partial/unknown posting terms. Do not replace the sourced answer with advice to do more research.",
          ...out,
          research_id: out.id,
          next: "Answer using the linked interpretation and verified evidence. For employer questions name at least three sampled employers with their actual essential/desirable qualifications and clickable advert links, then combine with internal knowledge for learning advice. For discovery include each real destination's link, available posting information and confirmed/partially confirmed/unknown free terms. Do not omit this evidence in favour of generic advice. Call get_research_findings with this exact research_id only if more quoted claims are needed. Only change a mission or schedule tasks if execution was requested.",
        };
      } catch (e) {
        return {
          error: e instanceof Error ? e.message : "research_failed",
          note: "Say the facts still need checking; do not invent them.",
        };
      }
    }
    case "get_session_brief": {
      const { loadSessionBrief } = await import("./session-brief.server");
      const { briefForCoach } = await import("./session-brief");
      const b = await loadSessionBrief(db, userId, s("block_id"));
      return b ? briefForCoach(b) : { error: "That session is not on your plan." };
    }
    case "get_life_intelligence":
    case "explain_plan_item":
    case "brief_my_day":
    case "review_my_week": {
      const LI = await import("./life-intelligence.server");
      const snap = await LI.loadSnapshot(db, userId, ctx.tz);
      const admin = await adminDb();
      await LI.syncLinks(admin, userId, snap).catch((e) => console.error("life links", e));
      if (tool === "explain_plan_item")
        return LI.explain(
          snap,
          a["block_id"] ? s("block_id") : null,
          a["title"] ? s("title") : null,
        );
      if (tool === "brief_my_day") {
        await LI.recordIntel(admin, userId, "daily_brief");
        return LI.brief(db, snap, userId);
      }
      if (tool === "review_my_week") {
        await LI.recordIntel(admin, userId, "weekly_review");
        return LI.review(snap);
      }
      const budget = Number(a["monthly_budget"]);
      const out = LI.analyse(
        snap,
        Number.isFinite(budget) && budget > 0 ? { monthlyBudget: budget } : {},
      );
      await LI.meterAnalysis(admin, userId, out);
      return out;
    }
    case "get_life_twin": {
      const { data } = await db
        .from("life_twin_facts")
        .select("domain,fact_key,fact_value,source,confidence,is_locked")
        .is("valid_until", null)
        .limit(60);
      return data ?? [];
    }
    case "get_goals": {
      const { data } = await db
        .from("goals")
        .select(
          "id,title,domain,status,priority,deadline,weekly_minutes,session_minutes,why,current_value,target_value,target_unit,is_protected,preferred_days,preferred_start,created_at",
        )
        .in("status", ["active", "paused", "proposed"]);
      const ids = (data ?? []).map((g) => g.id);
      const { data: ms } = ids.length
        ? await db
            .from("goal_milestones")
            .select(
              "id,goal_id,title,due_date,done_at,stage,status,depends_on,evidence_type,is_major,blocked_reason",
            )
            .in("goal_id", ids)
        : { data: [] };
      // The training programme is scheduled through the first active/paused training goal (createProgramme).
      const { data: prog } = await db
        .from("training_programmes")
        .select("id")
        .eq("status", "active")
        .limit(1);
      const programmeGoal = prog?.length
        ? [...(data ?? [])]
            .filter((g) => g.domain === "training" && ["active", "paused"].includes(g.status))
            .sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))[0]?.id
        : undefined;
      return (data ?? []).map(({ created_at: _c, ...g }) => ({
        ...g,
        sessions_per_week: Math.round(g.weekly_minutes / Math.max(g.session_minutes, 1)),
        ...(g.id === programmeGoal
          ? {
              holds_training_programme: true,
              note: "Carries the training programme's sessions; not a duplicate of it.",
            }
          : {}),
        milestones: (ms ?? []).filter((m) => m.goal_id === g.id),
      }));
    }
    case "get_plan": {
      // Covers the rest of this week and the whole of next week, so "what's on next week?" is answered
      // from every saved session, never a partial window.
      const isoDowToday = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
      const spanDays = 7 - isoDowToday + 8;
      const [{ data: blocks }, { data: pv }] = await Promise.all([
        db
          .from("plan_blocks")
          .select("id,title,domain,starts_at,duration_min,status,is_protected,goal_id")
          .gte("starts_at", dayStart.toISOString())
          .lt("starts_at", new Date(dayStart.getTime() + spanDays * 864e5).toISOString())
          // Moved/cancelled copies are history from earlier plan versions, not live entries or duplicates.
          .not("status", "in", "(rescheduled,cancelled)")
          .order("starts_at")
          .limit(150),
        db
          .from("plan_versions")
          .select("week_start,version,status,feasibility,explanation,rationale")
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      const nextMonday = addDaysIso(today, 8 - isoDowToday);
      const rows = (blocks ?? []).map((b) => ({
        ...b,
        local_day: localDayKey(b.starts_at, ctx.tz),
        local_time: localHm(b.starts_at, ctx.tz),
      }));
      const countBy = (sel: (typeof rows)[number][]) => {
        const m: Record<string, number> = {};
        for (const r of sel) m[r.domain] = (m[r.domain] ?? 0) + 1;
        return m;
      };
      const thisWeek = rows.filter((r) => r.local_day < nextMonday);
      const nextWeek = rows.filter((r) => r.local_day >= nextMonday);
      return {
        user_today: today,
        next_week_starts: nextMonday,
        saved_counts: {
          note: "Exact counts of saved sessions by life area. Quote these; never estimate.",
          rest_of_this_week: countBy(thisWeek),
          next_week: countBy(nextWeek),
        },
        blocks: rows,
        latest_proposal: pv?.[0] ?? null,
      };
    }
    case "get_today": {
      const { data } = await db
        .from("plan_blocks")
        .select("id,title,domain,starts_at,duration_min,status")
        .gte("starts_at", dayStart.toISOString())
        .lt("starts_at", new Date(dayStart.getTime() + 864e5).toISOString())
        .not("status", "in", "(rescheduled,cancelled)")
        .order("starts_at");
      const open = (data ?? []).filter(
        (b) =>
          !["done", "skipped", "cancelled", "missed", "safety_stopped", "partial"].includes(
            b.status,
          ),
      );
      return { date: today, sessions: data ?? [], next: open[0] ?? null };
    }
    case "get_execution_history": {
      const { data } = await db
        .from("plan_block_events")
        .select("event_type,to_status,reason_code,note,occurred_at")
        .gte("occurred_at", new Date(Date.now() - 14 * 864e5).toISOString())
        .order("occurred_at", { ascending: false })
        .limit(80);
      return data ?? [];
    }
    case "get_behaviour_patterns": {
      const { data } = await db
        .from("plan_blocks")
        .select("domain,starts_at,status")
        .gte("starts_at", new Date(Date.now() - 28 * 864e5).toISOString())
        .lt("starts_at", new Date().toISOString());
      const by: Record<string, { done: number; total: number }> = {};
      for (const b of data ?? []) {
        const k = b.domain;
        by[k] ??= { done: 0, total: 0 };
        by[k].total++;
        if (b.status === "done") by[k].done++;
      }
      return { window_days: 28, by_domain: by };
    }
    case "get_training_context": {
      const [{ data: prog }, { data: sets }] = await Promise.all([
        db
          .from("training_programmes")
          .select("goal,experience,equipment,days_per_week,session_minutes,version")
          .eq("status", "active")
          .limit(1),
        db
          .from("workout_sets")
          .select("performed_on,exercise,weight_kg,reps,rir")
          .order("created_at", { ascending: false })
          .limit(30),
      ]);
      return { programme: prog?.[0] ?? null, recent_sets: sets ?? [] };
    }
    case "get_nutrition_context": {
      const [{ data: t }, { data: food }] = await Promise.all([
        db
          .from("nutrition_targets")
          .select("kcal,protein_g,carbs_g,fat_g,method,confidence,status")
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1),
        db.from("food_entries").select("kcal,protein_g,carbs_g,fat_g").eq("eaten_on", today),
      ]);
      const sum = (k: "kcal" | "protein_g" | "carbs_g" | "fat_g") =>
        Math.round((food ?? []).reduce((x, f) => x + Number(f[k]), 0));
      return {
        target: t?.[0] ?? null,
        today: {
          kcal: sum("kcal"),
          protein_g: sum("protein_g"),
          carbs_g: sum("carbs_g"),
          fat_g: sum("fat_g"),
        },
      };
    }
    case "get_recovery_context": {
      const [{ data: c }, { data: p }] = await Promise.all([
        db
          .from("recovery_checkins")
          .select("check_date,sleep_quality,energy,soreness,stress,ill_or_injured")
          .eq("check_date", today)
          .maybeSingle(),
        db.from("profiles").select("sleep_target_hours").eq("id", userId).maybeSingle(),
      ]);
      const r = assessRecovery({
        checkin: c ?? null,
        sleepTargetHours: Number(p?.sleep_target_hours ?? 8),
      });
      if (r.state === "RED") ctx.safety.push("recovery_red");
      return r;
    }
    case "get_learning_context": {
      const [{ data: due }, { data: res }] = await Promise.all([
        db
          .from("retrieval_items")
          .select("prompt,due_on,interval_step")
          .lte("due_on", today)
          .limit(20),
        db.from("learning_resources").select("title,kind,total_units,done_units").limit(20),
      ]);
      return { reviews_due: due?.length ?? 0, due: due ?? [], resources: res ?? [] };
    }
    case "get_outcomes": {
      const { data } = await db
        .from("outcome_ledger")
        .select("outcome_type,metric,value,text_value,unit,evidence_class,observed_at")
        .neq("outcome_type", "observation")
        .order("observed_at", { ascending: false })
        .limit(20);
      return data ?? [];
    }
    case "get_experiments": {
      const { data } = await db
        .from("experiments")
        .select("title,hypothesis,metric,status,start_date")
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    }
    case "get_knowledge_evidence": {
      const { retrieveForTurn, retrieveCoachEvidence } = await import("./knowledge.server");
      const { sourceOf } = await import("./knowledge");
      let b: Awaited<ReturnType<typeof retrieveForTurn>>;
      try {
        b = await retrieveCoachEvidence(s("query"), today, userId);
      } catch {
        return {
          evidence_state: "KNOWLEDGE_RETRIEVAL_FAILED",
          note: "The knowledge lookup failed (system problem). Do not say no evidence exists.",
          evidence: [],
        };
      }
      ctx.evidenceRefs.push(...b.evidence.map((e) => e.chunk_id));
      return {
        evidence_state: b.evidence.length ? "KNOWLEDGE_FOUND" : "NO_RELEVANT_KNOWLEDGE",
        ...(b.evidence.length
          ? {}
          : {
              note: "Lookup worked; the library has no sourced passage on this. Say so; never claim retrieval failed.",
            }),
        evidence: b.evidence.map((e) => ({
          chunk_id: e.chunk_id,
          text_or_rule: e.text_or_rule,
          trust_tier: e.trust_tier,
          citation_label: e.citation_label,
          evidence_kind: sourceOf(e.source_id).evidence_kind ?? "research",
        })),
        uncertainty: b.status === "unavailable" ? ["The knowledge lookup failed."] : [],
      };
    }
    case "search_food": {
      const { data } = await db
        .from("user_foods")
        .select("id,name,brand,kcal_100g,protein_100g,serving_g")
        .ilike("name", `%${s("query").replace(/[%_]/g, "")}%`)
        .limit(8);
      return data ?? [];
    }
    case "log_user_statement": {
      const { recordTwinObservation, sanitizeInferred } = await import("./twin.server");
      const obs = sanitizeInferred(
        { facts: [{ key: s("fact_key"), value: a["value"], confidence: 0.6 }] },
        ctx.messageId ?? "coach",
      );
      const supabaseAdmin = await adminDb();
      const out = [];
      for (const o of obs) out.push(await recordTwinObservation(supabaseAdmin, userId, o));
      return { recorded: out };
    }
    case "request_replan":
      // A call or reminder request never rebuilds the week as a side effect.
      if ((await import("./coach-scheduling")).isCallOrReminderOnly(ctx.memberText))
        return {
          skipped: "not_requested",
          next: "The member only asked for a call or reminder. Do not rebuild or mention the plan. Report the saved call from schedule_commitment (day and time) in one or two sentences.",
        };
      try {
        const admin = await adminDb();
        const { count } = await admin
          .from("intelligence_events")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("kind", "signal_generated")
          .gte("created_at", new Date(Date.now() - 864e5).toISOString());
        if (count)
          await admin
            .from("intelligence_events")
            .insert({ user_id: userId, kind: "signal_accepted", detail: {} });
      } catch {
        /* metering only */
      }
      if ((await import("./life-intelligence")).memberInstructed(ctx.memberText)) {
        // The member asked for this change: build the week with the deterministic planner and apply it through the normal approval path.
        try {
          const { proposeWeekPlan, approveWeekPlan } = await import("./planning.functions");
          const isoDow = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
          const weeks: ("current" | "next")[] =
            a["include_next_week"] === true || isoDow >= 4 ? ["current", "next"] : ["current"];
          const sessions: { title: string; day: string; time: string; minutes: number }[] = [];
          const unplaced: unknown[] = [];
          let added = 0;
          let feasibility = "",
            explanation: string | null = null;
          for (const week of weeks) {
            const p = (await proposeWeekPlan({ data: { trigger: "manual", week } })) as {
              id: string;
              feasibility: string;
              explanation: string | null;
              diff_summary: {
                unplaced?: unknown[];
                proposed_blocks?: { title: string; starts_at: string; duration_min: number }[];
              };
            };
            const r = await approveWeekPlan({
              data: { proposalId: p.id, mode: "permanent", trialDays: 14 },
            });
            added += (r as { blocksCreated?: number }).blocksCreated ?? 0;
            unplaced.push(...(p.diff_summary?.unplaced ?? []));
            feasibility = p.feasibility;
            explanation = p.explanation ?? explanation;
          }
          // Report what was actually saved, not the intermediate planner output (dedupe may drop copies).
          {
            const isoDowT = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
            const span = weeks.includes("next") ? 7 - isoDowT + 8 : 8 - isoDowT;
            const { data: saved } = await db
              .from("plan_blocks")
              .select("title,starts_at,duration_min")
              .gte("starts_at", dayStart.toISOString())
              .lt("starts_at", new Date(dayStart.getTime() + span * 864e5).toISOString())
              .not("status", "in", "(rescheduled,cancelled)")
              .order("starts_at")
              .limit(150);
            for (const b of saved ?? [])
              sessions.push({
                title: b.title,
                day: localDayKey(b.starts_at, ctx.tz),
                time: localHm(b.starts_at, ctx.tz),
                minutes: b.duration_min,
              });
          }
          ctx.actions.push({
            kind: "link",
            label: "See your plan",
            to: "/app/plan",
            reason: "Your updated weeks.",
          });
          // A rebuild never silently drops session calls the member asked for earlier: "keep" inherits the
          // last standing choice; only an explicit "none" (member asked to stop) turns them off.
          let kind = String(a["call_for_sessions"] ?? "keep");
          const stopped = kind === "none";
          if (kind !== "training" && kind !== "all" && !stopped) {
            const { data: past } = await (
              await adminDb()
            )
              .from("coach_standing_orders")
              .select("params")
              .eq("user_id", userId)
              .eq("kind", "weekly_plan")
              .order("created_at", { ascending: false })
              .limit(20);
            const last = (past ?? [])
              .map((o) => (o.params ?? {}) as Record<string, unknown>)
              .find(
                (p) =>
                  p["calls_stopped"] === true ||
                  ["training", "all"].includes(String(p["call_for_sessions"])),
              );
            kind =
              last && last["calls_stopped"] !== true ? String(last["call_for_sessions"]) : "none";
          }
          const calls =
            kind === "training" || kind === "all"
              ? await callsForSessions(ctx, kind, Number(a["call_lead_minutes"]) || 0)
              : null;
          let continues: unknown = false;
          if (a["keep_going"] !== false) {
            const so = await import("./standing-orders.server");
            continues = await so.recordStandingOrder(
              ctx,
              "weekly_plan",
              {
                call_for_sessions: kind,
                call_lead_minutes: Number(a["call_lead_minutes"]) || 0,
                ...(stopped ? { calls_stopped: true } : {}),
              },
              { goal_id: a["goal_id"] ? String(a["goal_id"]) : null, target_weight_kg: null },
            );
          }
          // Intended weekly frequency vs what this calendar week can still hold, with the exact reason.
          const frequency: Record<string, unknown>[] = [];
          try {
            const isoDowT = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
            const daysLeft = 8 - isoDowT;
            const weekEnd = new Date(dayStart.getTime() + daysLeft * 864e5);
            const { data: gs } = await db
              .from("goals")
              .select("id,title,domain,weekly_minutes,session_minutes,preferred_days")
              .eq("status", "active");
            const { data: wk } = await db
              .from("plan_blocks")
              .select("goal_id,starts_at")
              .gte("starts_at", dayStart.toISOString())
              .lt("starts_at", new Date(weekEnd.getTime() + 7 * 864e5).toISOString())
              .not("status", "in", "(rescheduled,cancelled)");
            for (const g of (gs ?? []) as any[]) {
              const intended = g.session_minutes
                ? Math.round((g.weekly_minutes ?? 0) / g.session_minutes)
                : 0;
              if (!intended) continue;
              const mine = ((wk ?? []) as any[]).filter((b) => b.goal_id === g.id);
              const thisWeek = mine.filter((b) => Date.parse(b.starts_at) < weekEnd.getTime());
              const nextWeek = mine.length - thisWeek.length;
              if (thisWeek.length >= intended) continue;
              const restRule =
                g.domain === "training" && intended <= 4 && !g.preferred_days?.length;
              const fitCap = restRule ? Math.ceil(daysLeft / 2) : daysLeft;
              const reason =
                thisWeek.length >= Math.min(intended, fitCap)
                  ? `Only ${daysLeft} day(s) of this calendar week remain (today to Sunday)${restRule ? " and Plexecute's planning rule keeps at least one rest day between strength sessions" : ""}, so ${thisWeek.length} of ${intended} fit this week. This is a planning rule, not sourced evidence.`
                  : `Saved commitments, existing plan and free time left room for ${thisWeek.length} of ${intended} this week (see could_not_fit).`;
              frequency.push({
                goal: g.title,
                intended_per_week: intended,
                this_week: thisWeek.length,
                next_week: nextWeek,
                reason,
                next_session_after_this_week: mine.find(
                  (b) => Date.parse(b.starts_at) >= weekEnd.getTime(),
                )
                  ? `${localDayKey(mine.find((b) => Date.parse(b.starts_at) >= weekEnd.getTime()).starts_at, ctx.tz)} ${localHm(mine.find((b) => Date.parse(b.starts_at) >= weekEnd.getTime()).starts_at, ctx.tz)}`
                  : null,
              });
              // Persist the reason with the goal's mission so "why did you plan it this way?" answers from it.
              const admin = await adminDb();
              const { data: ms } = await admin
                .from("goal_missions")
                .select("id,metrics")
                .eq("user_id", userId)
                .eq("goal_id", g.id)
                .limit(1);
              const m0 = (ms ?? [])[0] as any;
              if (m0)
                await admin
                  .from("goal_missions")
                  .update({
                    metrics: {
                      ...(m0.metrics ?? {}),
                      frequency_basis: {
                        ...frequency[frequency.length - 1],
                        source: "DETERMINISTIC_PLANNING_RULE",
                        at: new Date().toISOString(),
                      },
                    } as never,
                  })
                  .eq("id", m0.id);
            }
          } catch {
            /* reporting only */
          }
          return {
            applied: true,
            authorised_by: "member_instruction",
            ...(frequency.length
              ? {
                  frequency_check: frequency,
                  frequency_instruction:
                    "A goal has fewer sessions this calendar week than intended: tell the member the exact reason from frequency_check, and when the next session after this week is. Do not call next week's sessions 'this week'.",
                }
              : {}),
            weeks_planned: weeks,
            keeps_planning_every_week: continues,
            sessions_added: added,
            sessions: sessions.slice(0, 40),
            feasibility,
            explanation,
            could_not_fit: unplaced,
            ...(calls ? { session_calls: calls } : {}),
          };
        } catch (e) {
          return { error: (e as Error).message || "plan_could_not_be_rebuilt" };
        }
      }
      ctx.actions.push({ kind: "replan", label: "Build a new plan proposal", reason: s("reason") });
      return { queued_for_user_approval: true };
    case "propose_goal_change": {
      const goalId = s("goal_id");
      const { data: existing } = await db.from("goals").select("id").eq("id", goalId).maybeSingle();
      if (!existing)
        return {
          error: "unknown_goal",
          hint: "Use an id from get_goals, or propose_new_goal for a new goal.",
        };
      ctx.actions.push({
        kind: "link",
        label: "Review goal change",
        to: `/app/goals/${encodeURIComponent(goalId)}`,
        reason: s("change"),
      });
      return { queued_for_user_confirmation: true };
    }
    case "propose_new_goal": {
      const supabaseAdmin = await adminDb();
      const title = s("title").slice(0, 120);
      if (!title) return { error: "title_required" };
      // Moderate/complex missions get their goal from draft_goal_pathway (goal + pathway together), never a bare second goal.
      {
        const { data: open } = await db
          .from("goal_missions")
          .select("id,tier,goal_id")
          .neq("state", "ACHIEVED")
          .neq("tier", "simple")
          .gte("updated_at", new Date(Date.now() - 2 * 3600e3).toISOString())
          .limit(1);
        if (open?.length) {
          // Build the mission's goal + pathway now instead of bouncing the call (a bounce often ended the turn unsaved).
          const r = (await runTool(ctx, "draft_goal_pathway" as ToolName, {
            goal: [title, s("why")].filter(Boolean).join(" — ").slice(0, 400),
            ...(a["deadline"] ? { deadline: a["deadline"] } : {}),
            ...(a["budget"] ? { budget: a["budget"] } : {}),
          })) as Record<string, unknown>;
          return {
            ...r,
            redirected:
              "Saved through draft_goal_pathway as part of the open mission (no separate goal).",
            mission_id: open[0]!.id,
          };
        }
      }
      const weekly = Math.min(
        Math.max(Math.round(Number(a["weekly_minutes"]) || 120), 15),
        40 * 60,
      );
      const session = Math.min(
        Math.max(Math.round(Number(a["session_minutes"]) || 45), 10),
        8 * 60,
      );
      const pt = ["morning", "midday", "evening", "any"].includes(s("preferred_time"))
        ? s("preferred_time")
        : "any";
      // Asked for in the member's own words: the goal is active straight away (their instruction is the confirmation).
      const instructed = (await import("./life-intelligence")).memberInstructed(ctx.memberText);
      const { data: goal, error } = await supabaseAdmin
        .from("goals")
        .insert({
          user_id: userId,
          title,
          domain: s("domain") || "other",
          why: s("why") || null,
          weekly_minutes: weekly,
          session_minutes: session,
          preferred_time: pt,
          status: instructed ? "active" : "proposed",
        })
        .select("id,title")
        .single();
      if (error || !goal) return { error: error?.message ?? "insert_failed" };
      if (instructed) {
        await supabaseAdmin.from("audit_events").insert({
          user_id: userId,
          actor_type: "user",
          action: "coach.goal_created",
          resource_type: "goal",
          resource_id: goal.id,
          outcome: "succeeded",
          metadata: {
            source_message: ctx.messageId ?? null,
            authorised_by: "member_instruction",
          },
        });
        return {
          goal_status: "active",
          goal_id: goal.id,
          authorised_by: "member_instruction",
          next: "Call request_replan so its sessions go on the plan.",
        };
      }
      ctx.actions.push({
        kind: "link",
        label: `Review proposed goal: ${goal.title}`,
        to: "/app/goals",
        reason: "Confirm it on the Goals page to add it to your plan.",
      });
      return { queued_for_user_confirmation: true, goal_id: goal.id };
    }
    case "propose_food_log":
      ctx.actions.push({
        kind: "link",
        label: `Log ${Math.round(Number(a["grams"]) || 0)} g of ${s("food_name")}`,
        to: "/app/nutrition",
        reason: "Confirm on the nutrition page; nutrients are calculated from your saved food.",
      });
      return { queued_for_user_confirmation: true };
    case "request_calendar_change":
      ctx.actions.push({
        kind: "link",
        label: "Review on the plan page",
        to: "/app/plan",
        reason: s("change"),
      });
      return { queued_for_user_confirmation: true };
    case "request_call_setting_change":
      ctx.actions.push({
        kind: "link",
        label: "Review call settings",
        to: "/app/accountability",
        reason: s("change"),
      });
      return { queued_for_user_confirmation: true };
    case "get_schedule_context": {
      const [c, sc] = await Promise.all([
        db
          .from("commitments")
          .select("id,title,kind,recurrence,days,on_date,start_time,end_time,note,source")
          .eq("active", true)
          .or(`recurrence.eq.weekly,on_date.gte.${today}`)
          .limit(60),
        // Recent calls (last 2 days, any status, incl. blocked/not placed) plus upcoming ones,
        // so a call that didn't ring is never invisible behind many future bookings.
        Promise.all([
          db
            .from("scheduled_calls")
            .select("id,commitment_id,call_at,purpose,status,status_reason,campaign_id")
            .gte("call_at", new Date(Date.now() - 2 * 864e5).toISOString())
            .lte("call_at", new Date().toISOString())
            .order("call_at", { ascending: false })
            .limit(20),
          db
            .from("scheduled_calls")
            .select("id,commitment_id,call_at,purpose,status,status_reason,campaign_id")
            .gt("call_at", new Date().toISOString())
            .eq("status", "scheduled")
            .order("call_at", { ascending: true })
            .limit(30),
        ]).then(([p, f]) => ({ data: [...(p.data ?? []), ...(f.data ?? [])] })),
      ]);
      const ids = (sc.data ?? []).map((x) => x.campaign_id).filter(Boolean) as string[];
      const camps = ids.length
        ? ((
            await db
              .from("call_campaigns")
              .select("id,state,attempts,acknowledgement")
              .in("id", ids)
          ).data ?? [])
        : [];
      return {
        user_today: today,
        time_zone: ctx.tz,
        commitments: c.data ?? [],
        scheduled_calls: (sc.data ?? []).map(({ call_at, ...x }) => ({
          ...x,
          call_local_day: localDayKey(call_at, ctx.tz),
          call_local_time: localHm(call_at, ctx.tz),
          outcome: camps.find((k) => k.id === x.campaign_id) ?? null,
        })),
      };
    }
    case "get_journal_context": {
      const pick = async (
        t:
          | "daily_logs"
          | "recovery_checkins"
          | "goal_reflections"
          | "goal_metric_entries"
          | "wellness_sessions",
      ) =>
        (await db.from(t).select("*").order("created_at", { ascending: false }).limit(8)).data ??
        [];
      const [daily, recovery, reflections, progress, wellness] = await Promise.all([
        pick("daily_logs"),
        pick("recovery_checkins"),
        pick("goal_reflections"),
        pick("goal_metric_entries"),
        pick("wellness_sessions"),
      ]);
      return { daily, recovery, reflections, progress, wellness };
    }
    case "schedule_commitment":
      return scheduleCommitment(ctx, a, today);
    case "schedule_meals":
      return scheduleMeals(ctx, a, today);
    case "schedule_execution_queue":
      return (await import("./execution-queue.server")).scheduleExecutionQueue(ctx, a);
    case "update_execution_task":
      return (await import("./execution-queue.server")).updateExecutionTask(ctx, a);
    case "estimate_energy_needs":
      return estimateEnergy(ctx, a);
    case "set_notification_preferences": {
      const { applyPromptChange } = await import("./push-plan");
      const { data: cur } = await db
        .from("profiles")
        .select(
          "reminders_enabled,reminder_lead_min,push_motivating,quiet_start,quiet_end,push_muted_kinds",
        )
        .eq("id", userId)
        .maybeSingle();
      const r = applyPromptChange(cur ?? {}, a);
      if ("error" in r) return r;
      const { error } = await db
        .from("profiles")
        .update(r.patch as never)
        .eq("id", userId);
      if (error) return { error: "could_not_save" };
      return { saved: true, now: r.summary, note: "Same settings as Settings → Notifications." };
    }
    case "cancel_scheduled_call": {
      const admin = await adminDb();
      const { data } = await admin
        .from("scheduled_calls")
        .update({ status: "cancelled", status_reason: "cancelled_by_user" })
        .eq("id", s("call_id"))
        .eq("user_id", userId)
        .eq("status", "scheduled")
        .select("id")
        .maybeSingle();
      if (data)
        await admin.from("audit_events").insert({
          user_id: userId,
          actor_type: "user",
          action: "coach.call_cancelled",
          resource_type: "scheduled_call",
          resource_id: data.id,
          outcome: "succeeded",
          metadata: { source_message: ctx.messageId ?? null },
        });
      return data ? { cancelled: true } : { error: "not_found_or_already_processed" };
    }
    case "get_call_readiness":
      return (await import("./calling.server")).callReadiness(userId);
    case "start_phone_verification":
      return (await import("./calling.server")).startVerificationFor(userId, s("phone"));
    case "confirm_phone_code":
      return (await import("./calling.server")).confirmVerificationFor(
        userId,
        s("code"),
        ctx.messageId ?? null,
      );
    case "give_call_consent":
      if (a["agreed"] !== true) return { error: "consent_needs_explicit_yes" };
      return (await import("./calling.server")).grantCallConsent(userId, ctx.messageId ?? null);
    case "start_experiment_proposal":
      ctx.actions.push({
        kind: "link",
        label: "Set up this experiment",
        to: "/app/experiments",
        reason: `${s("hypothesis")} (measure: ${s("metric")})`,
      });
      return { queued_for_user_confirmation: true };
    default:
      return { error: "unknown_tool" };
  }
}

/** Saves a dated commitment (user's RLS client) and an optional call before it; idempotent via dedupe keys. */
/** The member's own workout (gym, circuit, training) rather than an external appointment (PT, class, physio). */
export function isOwnTrainingSession(title: string, note?: unknown) {
  const t = `${title} ${note ?? ""}`.toLowerCase();
  if (
    /\b(appointment|class|lesson|physio|pt session|personal trainer|coach(ing)? session|match|game|with\s+[a-z])/.test(
      t,
    )
  )
    return false;
  return /\b(gym|work ?out|training|circuit|exercise session|lifting|weights session)\b/.test(t);
}

export async function scheduleCommitment(ctx: ToolCtx, a: Record<string, unknown>, today: string) {
  const sc = await import("./coach-scheduling");
  const { zonedInstant } = await import("./tz");
  const title = String(a["title"] ?? "")
    .trim()
    .slice(0, 120);
  if (!title) return { error: "title_required" };
  if (isOwnTrainingSession(title, a["note"])) {
    // A fixed "gym session" commitment would block the planner's own training slot (the 07:00 session lands at 17:45).
    const { data: tg } = await ctx.db
      .from("goals")
      .select("id")
      .eq("domain", "training")
      .eq("status", "active")
      .limit(1);
    if (tg?.length)
      return {
        error: "training_goes_on_the_plan",
        next: "Training sessions come from the member's training goal, not fixed commitments: use change_training_programme (days_of_week, start_time), then request_replan with call_for_sessions 'training'. Never save training as a commitment.",
      };
  }
  const inMin = Number(a["in_minutes"]);
  if (Number.isFinite(inMin) && inMin > 0) {
    // Relative times are resolved here, in the member's own time zone, never by the model.
    const at = new Date(Date.now() + Math.min(Math.round(inMin), 7 * 1440) * 60000);
    const hm = localHm(at.toISOString(), ctx.tz);
    a = {
      ...a,
      day: localDayKey(at.toISOString(), ctx.tz),
      time: hm,
      call_time: hm,
      call_lead_minutes: null,
      duration_minutes: a["duration_minutes"] ?? 15,
    };
  }
  // "Call me at 8am": the call itself is the commitment, so it rings at that time even if the model left call fields empty.
  if (
    a["call_time"] == null &&
    a["call_lead_minutes"] == null &&
    /\b(call|ring|phone)\b/i.test(`${title} ${ctx.memberText ?? ""}`) &&
    /\b(call|ring|phone)\s+me\b/i.test(ctx.memberText ?? title)
  )
    a = { ...a, call_time: String(a["time"] ?? "") };
  // "Working late until 9pm": the shift runs from the normal finish time UNTIL 21:00, it does not start at 21:00.
  const until = /\b(?:until|till|til|to)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(
    ctx.memberText ?? "",
  );
  if (
    until &&
    /\b(work|shift|late)\b/i.test(`${title} ${a["kind"] ?? ""} ${ctx.memberText ?? ""}`)
  ) {
    let uh = Number(until[1]) % 12;
    if ((until[3] ?? "pm").toLowerCase() === "pm") uh += 12;
    const untilMin = uh * 60 + Number(until[2] ?? 0);
    const asked = sc.parseTime(String(a["time"] ?? ""));
    if (asked != null && Math.abs(asked - untilMin) < 1) {
      const { data: pf } = await ctx.db
        .from("profiles")
        .select("work_end")
        .eq("id", ctx.userId)
        .maybeSingle();
      const we = sc.parseTime(String(pf?.work_end ?? "17:00").slice(0, 5)) ?? 17 * 60;
      const from = we < untilMin ? we : Math.max(0, untilMin - 120);
      a = { ...a, time: sc.hm(from), duration_minutes: untilMin - from };
    }
  }
  const day = sc.resolveDay(String(a["day"] ?? ""), today);
  if (!day) return { error: "could_not_understand_day", hint: "Ask the user which day." };
  const start = sc.parseTime(String(a["time"] ?? ""));
  if (start == null) return { error: "could_not_understand_time", hint: "Ask the user what time." };
  const dur = Math.min(Math.max(Math.round(Number(a["duration_minutes"]) || 60), 5), 12 * 60);
  const end = Math.min(start + dur, 23 * 60 + 59);
  if (zonedInstant(day, start, ctx.tz).getTime() < Date.now() - 60000)
    return { error: "that_time_has_passed", day, time: sc.hm(start) };
  const key = sc.commitmentKey(title, day, start);
  const note = a["note"] ? String(a["note"]).slice(0, 300) : null;

  // A repeated request ("I asked you to call me in 2 minutes") reuses what is already saved: one call, not two.
  {
    const { data: recent } = await ctx.db
      .from("commitments")
      .select("id,title,on_date,start_time,end_time,created_at")
      .eq("user_id", ctx.userId)
      .eq("on_date", day)
      .eq("source", "coach")
      .eq("active", true);
    const prior = (recent ?? []).find((r) =>
      sc.isRepeatOfRecentRequest(r, title, start, Date.now(), ctx.memberText),
    );
    if (prior) {
      const admin = await adminDb();
      const { data: calls } = await admin
        .from("scheduled_calls")
        .select("id,status,call_at")
        .eq("user_id", ctx.userId)
        .eq("commitment_id", prior.id)
        .order("call_at", { ascending: false })
        .limit(1);
      const c = calls?.[0];
      return {
        commitment: { ...prior, created_at: undefined, already_existed: true },
        call: c
          ? {
              id: c.id,
              status: c.status,
              already_existed: true,
              local_time: localHm(c.call_at, ctx.tz),
              already_rang: c.status !== "scheduled",
            }
          : null,
        next:
          c && c.status !== "scheduled"
            ? "This call was already made at the time shown. Say so plainly and apologise if the earlier reply was unclear. Do not schedule another unless they ask to be rung again."
            : "This call is already set. Confirm its time once; do not create another.",
      };
    }
  }

  let created = true;
  let { data: commitment } = await ctx.db
    .from("commitments")
    .insert({
      user_id: ctx.userId,
      title,
      kind: sc.kindFor(String(a["kind"] ?? "other")),
      recurrence: "once",
      on_date: day,
      days: [],
      start_time: sc.hm(start),
      end_time: sc.hm(end > start ? end : start + 1),
      is_hard: true,
      note,
      dedupe_key: key,
      source: "coach",
    })
    .select("id,title,on_date,start_time,end_time")
    .maybeSingle();
  if (!commitment) {
    created = false;
    ({ data: commitment } = await ctx.db
      .from("commitments")
      .select("id,title,on_date,start_time,end_time")
      .eq("dedupe_key", key)
      .maybeSingle());
  }
  if (!commitment) return { error: "could_not_save_commitment" };
  const admin = await adminDb();
  await admin.from("audit_events").insert({
    user_id: ctx.userId,
    actor_type: "user",
    action: created ? "coach.commitment_created" : "coach.commitment_reused",
    resource_type: "commitment",
    resource_id: commitment.id,
    outcome: "succeeded",
    metadata: { source_message: ctx.messageId ?? null, day, start: sc.hm(start) },
  } as never);

  const result: Record<string, unknown> = {
    commitment: { ...commitment, already_existed: !created },
    weekday: new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
      weekday: "long",
      timeZone: "UTC",
    }),
  };
  const callMin = sc.callMinute(start, {
    lead_minutes: a["call_lead_minutes"] == null ? null : Number(a["call_lead_minutes"]),
    call_time: a["call_time"] ? String(a["call_time"]) : null,
  });
  if (callMin != null) {
    const callAt = zonedInstant(day, callMin, ctx.tz);
    if (ctx.tier === "free") result["call"] = { error: "calls_need_pro_or_execute" };
    else if (callAt.getTime() < Date.now()) result["call"] = { error: "call_time_has_passed" };
    else {
      const ck = sc.callKey(key, callAt.toISOString());
      let { data: call } = await admin
        .from("scheduled_calls")
        .insert({
          user_id: ctx.userId,
          commitment_id: commitment.id,
          call_at: callAt.toISOString(),
          purpose: `Before ${title}`.slice(0, 200),
          source: "coach",
          source_ref: ctx.messageId ?? null,
          dedupe_key: ck,
        })
        .select("id,status")
        .maybeSingle();
      const callCreated = !!call;
      if (!call)
        ({ data: call } = await admin
          .from("scheduled_calls")
          .select("id,status")
          .eq("user_id", ctx.userId)
          .eq("dedupe_key", ck)
          .maybeSingle());
      const { callReadiness } = await import("./calling.server");
      result["call"] = call
        ? {
            ...call,
            already_existed: !callCreated,
            local_time: sc.hm(((callMin % 1440) + 1440) % 1440),
            ...(await callReadiness(ctx.userId, callAt)),
          }
        : { error: "could_not_schedule_call" };
    }
  }
  const call = result["call"] as { calls_will_ring?: boolean; blocking?: string[] } | undefined;
  if (call && call.calls_will_ring === false)
    result["next"] =
      "Tell the member exactly what is blocking the call. For daily_call_limit_reached say the safety limit of 12 calls in 24 hours is reached and give calls_ring_again_from in their local time; the item is still on their plan with an in-app reminder. For phone_not_verified ask for their mobile here and use start_phone_verification; for call_consent_not_given read the consent line and use give_call_consent on their yes. Other blockers are on Plexecute's side: say so honestly, never claim the call will ring.";
  return result;
}

const MEAL_NOTE = "Meal from nutrition plan";
const DEFAULT_SLOT_TIMES: Record<string, string> = {
  breakfast: "07:30",
  lunch: "12:30",
  snack: "16:00",
  dinner: "19:00",
};

/** Each day's entries: either the member's own meal plan (exact meal per day) or the given meal list. */
async function mealEntries(ctx: ToolCtx, a: Record<string, unknown>, first: string, n: number) {
  const { addDaysKey } = await import("./tz");
  if (a["from_meal_plan"] === true) {
    const mp = await import("./meal-prep.server");
    const pl = await mp.currentPlan({ supabase: ctx.db, userId: ctx.userId });
    if (!pl)
      return { error: "no_meal_plan", hint: "Build one with plan_meal_prep first." } as const;
    let breakfastMoved: string | null = null;
    const given = (a["slot_times"] ?? {}) as Record<string, string>;
    const times = { ...DEFAULT_SLOT_TIMES, ...given };
    {
      // Training before breakfast: breakfast goes after the morning session (wake routine + session + buffers), never on top of it.
      const [{ data: prof }, { data: mg }] = await Promise.all([
        ctx.db.from("profiles").select("wake_time").eq("id", ctx.userId).maybeSingle(),
        ctx.db
          .from("goals")
          .select("session_minutes")
          .eq("status", "active")
          .eq("preferred_time", "morning")
          .in("domain", ["training", "fitness", "mobility", "nutrition", "other"])
          .order("session_minutes", { ascending: false })
          .limit(1),
      ]);
      const { toMin } = await import("./scheduler");
      const wake = toMin(prof?.wake_time ?? null);
      const sess = mg?.[0]?.session_minutes;
      if (wake != null && sess) {
        const at = Math.ceil((wake + 30 + sess + 30) / 15) * 15; // scheduler: wake routine 30, session buffer 15, meal buffer 15
        if (at > (toMin(times["breakfast"]) ?? 0)) {
          times["breakfast"] =
            `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;
          breakfastMoved = times["breakfast"];
        }
      }
    }
    const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const out: { day: string; name: string; time: string }[] = [];
    for (const d of pl.plan.days) {
      if (d.date < first) continue;
      for (const m of d.meals)
        out.push({
          day: d.date,
          time: String(times[m.slot] ?? DEFAULT_SLOT_TIMES[m.slot] ?? "12:30"),
          name: `${label(m.slot)}: ${m.name} (${Math.round(m.kcal)} kcal, ${Math.round(m.protein_g)} g protein)`,
        });
    }
    return { entries: out, planStatus: pl.status, breakfastMoved, times } as const;
  }
  const meals = (Array.isArray(a["meals"]) ? a["meals"] : []).slice(0, 6) as {
    name?: unknown;
    time?: unknown;
  }[];
  if (!meals.length) return { error: "no_meals_given" } as const;
  const out: { day: string; name: string; time: string }[] = [];
  for (let d = 0; d < n; d++)
    for (const m of meals)
      out.push({
        day: addDaysKey(first, d),
        name: String(m.name ?? "Meal"),
        time: String(m.time ?? ""),
      });
  return { entries: out, planStatus: null, breakfastMoved: null, times: null } as const;
}

async function scheduleMeals(ctx: ToolCtx, a: Record<string, unknown>, today: string) {
  const sc = await import("./coach-scheduling");
  const first = sc.resolveDay(String(a["start_day"] ?? "today"), today);
  if (!first) return { error: "could_not_understand_day" };
  const n = Math.min(Math.max(Math.round(Number(a["days"]) || 1), 1), 14);
  const calls = a["call_reminders"] === true;
  const got = await mealEntries(ctx, a, first, n);
  if ("error" in got) return got;
  const entries = got.entries.slice(0, 60);
  // Replace earlier Coach meal entries on these days that no longer match the plan (no stale or duplicate meals).
  const days = [...new Set(entries.map((e) => e.day))];
  let replaced = 0;
  if (days.length) {
    const keep = new Set(entries.map((e) => `${e.day}|${e.name.slice(0, 120)}`));
    const { data: old } = await ctx.db
      .from("commitments")
      .select("id,title,on_date")
      .eq("source", "coach")
      .eq("note", MEAL_NOTE)
      .in("on_date", days);
    const stale = (old ?? []).filter((c) => !keep.has(`${c.on_date}|${c.title}`)).map((c) => c.id);
    if (stale.length) {
      const admin = await adminDb();
      await admin
        .from("scheduled_calls")
        .update({ status: "cancelled", status_reason: "meal_plan_updated" })
        .eq("user_id", ctx.userId)
        .in("commitment_id", stale)
        .eq("status", "scheduled");
      await ctx.db.from("commitments").delete().in("id", stale);
      replaced = stale.length;
    }
  }
  const saved: unknown[] = [];
  const skipped: string[] = [];
  let callIssue: unknown = null;
  for (const e of entries) {
    const title = e.name.slice(0, 120);
    const r = (await scheduleCommitment(
      ctx,
      {
        title,
        kind: "other",
        day: e.day,
        time: e.time,
        duration_minutes: 30,
        call_lead_minutes: calls ? 0 : null,
        call_time: null,
        note: MEAL_NOTE,
        in_minutes: null,
      },
      today,
    )) as Record<string, unknown>;
    if (r["error"]) skipped.push(`${e.day} ${e.time}: ${r["error"]}`);
    else {
      saved.push({ day: e.day, time: e.time, title });
      if (
        calls &&
        !callIssue &&
        r["call"] &&
        (r["call"] as Record<string, unknown>)["calls_will_ring"] === false
      )
        callIssue = r["call"];
    }
  }
  let continues: unknown = null;
  if (a["until_goal"] === true) {
    // Standing instruction: the weekly menu rolls on (with its calls) until the goal or target weight is reached.
    const so = await import("./standing-orders.server");
    continues = await so.recordStandingOrder(
      ctx,
      "meals",
      {
        from_meal_plan: a["from_meal_plan"] === true,
        times: got.times,
        meals:
          a["from_meal_plan"] === true
            ? null
            : (Array.isArray(a["meals"]) ? a["meals"] : []).slice(0, 6),
        calls,
      },
      {
        goal_id: a["goal_id"] ? String(a["goal_id"]) : null,
        target_weight_kg: Number(a["target_weight_kg"]) || null,
      },
    );
  }
  return {
    saved_count: saved.length,
    saved: saved.slice(0, 30),
    skipped,
    replaced_old_entries: replaced,
    ...(continues ? { continues_until_goal: continues } : { continues_until_goal: false }),
    ...(got.breakfastMoved ? { breakfast_after_morning_training_at: got.breakfastMoved } : {}),
    call_reminders: calls,
    call_issue: callIssue,
    on_daily_plan: true,
  };
}

/** Nutrition engine estimate (Mifflin-St Jeor × activity), with a bodyweight fallback when height/age are unknown. */
export async function estimateEnergy(ctx: ToolCtx, a: Record<string, unknown>) {
  const { computeTargets, ageFrom } = await import("./nutrition-engine");
  const { data: p } = await ctx.db
    .from("profiles")
    .select("sex,height_cm,date_of_birth,activity_level")
    .eq("id", ctx.userId)
    .maybeSingle();
  const { data: w } = await ctx.db
    .from("daily_logs")
    .select("value")
    .eq("kind", "weight")
    .order("log_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const n = (v: unknown) =>
    v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  const weight = n(a["weight_kg"]) ?? n(w?.value);
  const goal = ["gain", "lose", "maintain"].includes(String(a["goal"]))
    ? String(a["goal"])
    : "maintain";
  if (!weight) return { error: "need_weight", ask: "Ask the member for their current weight." };
  const sex = ["male", "female"].includes(String(a["sex"])) ? String(a["sex"]) : (p?.sex ?? null);
  const activity = ["low", "light", "moderate", "high"].includes(String(a["activity"]))
    ? String(a["activity"])
    : (p?.activity_level ?? "moderate");
  const strength = a["strength_training"] === true;
  const t = computeTargets({
    sex,
    height_cm: n(a["height_cm"]) ?? n(p?.height_cm),
    age: n(a["age"]) ?? ageFrom(p?.date_of_birth ?? null),
    weight_kg: weight,
    activity,
    goal,
    training_focus: strength ? "strength" : "general",
  });
  const protein = Math.round(weight * (goal === "gain" && strength ? 2.0 : strength ? 1.8 : 1.6));
  if (t.status === "blocked") return { blocked: true, note: t.notes[0] };
  if (t.status === "missing") {
    // Height or age unknown: the standard bodyweight method (about 33 kcal per kg for an active adult).
    const tdee =
      Math.round((weight * (activity === "low" ? 28 : activity === "high" ? 38 : 33)) / 10) * 10;
    const kcal =
      goal === "gain"
        ? tdee + 400
        : goal === "lose"
          ? Math.max(1200, Math.round(tdee * 0.85))
          : tdee;
    return {
      method: "bodyweight estimate",
      maintenance_kcal: tdee,
      target_kcal: kcal,
      protein_g: protein,
      expected_weekly_change_kg: goal === "gain" ? 0.25 : goal === "lose" ? -0.4 : 0,
      refine:
        "Height and date of birth in their profile sharpen this; logged weight and food make it adaptive.",
    };
  }
  return {
    method: "Mifflin-St Jeor × activity (Plexecute nutrition engine)",
    maintenance_kcal: t.tdee,
    target_kcal: t.kcal,
    kcal_range: t.kcal_range ?? null,
    protein_g: Math.max(protein, t.protein_g),
    fat_g: t.fat_g,
    carbs_g: t.carbs_g,
    expected_weekly_change_pct: t.weekly_change_pct,
    notes: t.notes,
  };
}

/** One accountability call per upcoming plan session (next 14 days), idempotent per session. */
export async function callsForSessions(ctx: ToolCtx, kind: string, lead: number) {
  if (ctx.tier === "free") return { error: "calls_need_pro_or_execute" };
  const admin = await adminDb();
  const now = new Date();
  let q = ctx.db
    .from("plan_blocks")
    .select("id,title,domain,starts_at,status")
    .eq("user_id", ctx.userId)
    .gte("starts_at", now.toISOString())
    .lte("starts_at", new Date(now.getTime() + 14 * 864e5).toISOString())
    .in("status", ["planned", "scheduled", "upcoming"])
    .order("starts_at")
    .limit(40);
  if (kind === "training") q = q.in("domain", ["training", "fitness", "mobility"]);
  const { data: blocks } = await q;
  const leadMin = Math.min(Math.max(Math.round(lead), 0), 120);
  // Calls for sessions that are no longer on the plan never ring; one call per moment, never duplicates.
  const open = new Set(((blocks ?? []) as { id: string }[]).map((b) => b.id));
  const { data: existing } = await admin
    .from("scheduled_calls")
    .select("id,call_at,dedupe_key")
    .eq("user_id", ctx.userId)
    .eq("status", "scheduled")
    .like("dedupe_key", "session:%");
  const seen = new Set<number>();
  const drop: string[] = [];
  for (const c of existing ?? []) {
    const id = String(c.dedupe_key).split(":")[1] ?? "";
    const t = new Date(c.call_at).getTime();
    if ((t <= now.getTime() + 14 * 864e5 && !open.has(id)) || seen.has(t)) drop.push(c.id);
    else seen.add(t);
  }
  if (drop.length)
    await admin
      .from("scheduled_calls")
      .update({ status: "cancelled", status_reason: "session_replaced" })
      .in("id", drop);
  const booked: { day: string; time: string; session: string }[] = [];
  for (const b of (blocks ?? []) as { id: string; title: string; starts_at: string }[]) {
    const at = new Date(new Date(b.starts_at).getTime() - leadMin * 60000);
    if (at.getTime() < now.getTime() + 60000) continue;
    if (seen.has(at.getTime())) {
      booked.push({ day: localDayKey(at, ctx.tz), time: localHm(at, ctx.tz), session: b.title });
      continue;
    }
    seen.add(at.getTime());
    await admin.from("scheduled_calls").upsert(
      {
        user_id: ctx.userId,
        call_at: at.toISOString(),
        purpose: `Accountability: ${b.title}`.slice(0, 200),
        source: "coach",
        source_ref: ctx.messageId ?? null,
        dedupe_key: `session:${b.id}:${at.toISOString()}`,
      },
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
    );
    booked.push({ day: localDayKey(at, ctx.tz), time: localHm(at, ctx.tz), session: b.title });
  }
  const { callReadiness } = await import("./calling.server");
  return { calls_booked: booked.length, calls: booked, ...(await callReadiness(ctx.userId)) };
}

/** Standing meal order: fill any day in the next 14 without meal entries, rotating the weekly menu by weekday. */
export async function rollMeals(ctx: ToolCtx, params: Record<string, unknown>, today: string) {
  const { addDaysKey, isoDowOfKey } = await import("./tz");
  const end = addDaysKey(today, 13);
  const { data: have } = await ctx.db
    .from("commitments")
    .select("on_date")
    .eq("source", "coach")
    .eq("note", MEAL_NOTE)
    .eq("active", true)
    .gte("on_date", today)
    .lte("on_date", end);
  const covered = new Set((have ?? []).map((c) => c.on_date as string));
  const missing = Array.from({ length: 14 }, (_, i) => addDaysKey(today, i)).filter(
    (d) => !covered.has(d),
  );
  if (!missing.length) return { added: 0 };
  const byDow = new Map<number, { name: string; time: string }[]>();
  if (params["from_meal_plan"]) {
    const mp = await import("./meal-prep.server");
    const pl = await mp.currentPlan({ supabase: ctx.db, userId: ctx.userId });
    if (!pl || pl.status !== "approved") return { error: "no_approved_meal_plan" };
    const times = { ...DEFAULT_SLOT_TIMES, ...((params["times"] ?? {}) as Record<string, string>) };
    const label = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
    for (const d of pl.plan.days) {
      const dow = isoDowOfKey(d.date);
      if (byDow.has(dow)) continue;
      byDow.set(
        dow,
        d.meals.map((m) => ({
          time: String(times[m.slot] ?? "12:30"),
          name: `${label(m.slot)}: ${m.name} (${Math.round(m.kcal)} kcal, ${Math.round(m.protein_g)} g protein)`,
        })),
      );
    }
  } else {
    const meals = ((params["meals"] ?? []) as { name?: unknown; time?: unknown }[]).map((m) => ({
      name: String(m.name ?? "Meal"),
      time: String(m.time ?? ""),
    }));
    for (let dow = 1; dow <= 7; dow++) byDow.set(dow, meals);
  }
  let added = 0;
  for (const day of missing) {
    for (const m of byDow.get(isoDowOfKey(day)) ?? []) {
      const r = (await scheduleCommitment(
        ctx,
        {
          title: m.name.slice(0, 120),
          kind: "other",
          day,
          time: m.time,
          duration_minutes: 30,
          call_lead_minutes: params["calls"] ? 0 : null,
          call_time: null,
          note: MEAL_NOTE,
          in_minutes: null,
        },
        today,
      )) as Record<string, unknown>;
      if (!r["error"]) added++;
    }
  }
  return { added, days: missing.length };
}

function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Root-cause adaptation: execution history -> cause -> Plexecute knowledge -> real goal/plan change with provenance. */
async function fixRepeatedMisses(ctx: ToolCtx, a: Record<string, unknown>, today: string) {
  const { db, userId } = ctx;
  const M = await import("./mission");
  const KR = await import("./knowledge-routing");
  const since = new Date(Date.now() - 42 * 864e5).toISOString();
  const { data: past } = await db
    .from("plan_blocks")
    .select("goal_id,status,starts_at,duration_min,note,title")
    .eq("user_id", userId)
    .gte("starts_at", since)
    .lt("starts_at", new Date().toISOString())
    .not("status", "in", "(rescheduled,cancelled)")
    .order("starts_at", { ascending: false })
    .limit(200);
  const rows = (past ?? []) as any[];
  const missedRe = /missed|skipped|expired|failed|blocked/;
  let goalId = String(a["goal_id"] ?? "") || null;
  if (!goalId) {
    const counts = new Map<string, number>();
    for (const r of rows)
      if (r.goal_id && missedRe.test(r.status))
        counts.set(r.goal_id, (counts.get(r.goal_id) ?? 0) + 1);
    goalId = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  }
  if (!goalId)
    return { cause: "none", evidence: "no missed sessions in the last 6 weeks", change: null };
  const { data: goal } = await db
    .from("goals")
    .select("id,title,session_minutes,weekly_minutes,preferred_time,preferred_start")
    .eq("id", goalId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!goal) return { error: "goal_not_found" };
  const mine = rows.filter((r) => r.goal_id === goalId);
  const hourOf = (iso: string) =>
    Number(
      new Date(iso).toLocaleString("en-GB", {
        timeZone: ctx.tz ?? "Europe/London",
        hour: "2-digit",
        hour12: false,
      }),
    );
  const outs = mine.map((r) => ({
    status: r.status,
    reason: r.note ?? null,
    planned_minutes: r.duration_min ?? null,
    hour: hourOf(r.starts_at),
  }));
  const rc = M.rootCause(outs as never);
  const kept = mine.filter((r) => r.status === "done");
  const keptHour = kept.length ? hourOf(kept[0].starts_at) : null;
  const history = {
    sessions_looked_at: mine.length,
    missed: outs.filter((o) => missedRe.test(o.status)).length,
    done: kept.length,
    missed_reasons: outs
      .filter((o) => missedRe.test(o.status) && o.reason)
      .map((o) => o.reason)
      .slice(0, 6),
  };
  const KS = await import("./knowledge.server");
  const k =
    rc.cause === "none"
      ? null
      : await KS.retrieveForTurn(
          (await adminDb()) as never,
          `${KR.CAUSE_QUERY[rc.cause]} ${goal.title}`,
          {
            domains: KR.CAUSE_DOMAINS[rc.cause],
            today,
            limit: 3,
            userId,
          },
        );
  const knowledge = (k?.evidence ?? [])
    .filter((e) => e.domain !== "safety")
    .map((e) => ({ id: e.chunk_id, title: e.title, domain: e.domain, rule: e.text_or_rule }));
  ctx.evidenceRefs.push(...knowledge.map((x) => x.id));
  // The goal's mission holds the decision record; link an unlinked mission of the same goal, else start one.
  const adm = await adminDb();
  let { data: mis } = await adm
    .from("goal_missions")
    .select("id,metrics,history,state,goal_id,title")
    .eq("user_id", userId)
    .eq("goal_id", goal.id)
    .limit(1);
  if (!mis?.length) {
    const { data: byTitle } = await adm
      .from("goal_missions")
      .select("id,metrics,history,state,goal_id,title")
      .eq("user_id", userId)
      .is("goal_id", null)
      .ilike("title", `%${String(goal.title).slice(0, 40).replace(/[%_]/g, "")}%`)
      .limit(1);
    if (byTitle?.length) {
      await adm.from("goal_missions").update({ goal_id: goal.id }).eq("id", byTitle[0]!.id);
      mis = byTitle;
    } else {
      const MS = await import("./mission.server");
      await MS.advanceMission(adm, userId, {
        title: goal.title,
        goal_id: goal.id,
        new_goal: true,
      } as never);
      ({ data: mis } = await adm
        .from("goal_missions")
        .select("id,metrics,history,state,goal_id,title")
        .eq("user_id", userId)
        .eq("goal_id", goal.id)
        .limit(1));
    }
  }
  const ms0 = mis?.[0] as any;
  // A fix already applied for this cause is given time to work: no stacking the same change again.
  const lastFix = ((ms0?.metrics?.adaptations ?? []) as any[])
    .filter((x) => x.cause === rc.cause)
    .pop();
  if (lastFix && Date.now() - Date.parse(lastFix.at) < 7 * 864e5)
    return {
      goal: goal.title,
      goal_id: goal.id,
      cause: rc.cause,
      already_applied: lastFix,
      next: "This cause was already fixed recently (already_applied). Say what was changed and when, and that it needs a week of sessions before judging it; do not change it again.",
    };
  const change = KR.causeChange(rc.cause, goal as never, keptHour);
  const base = {
    goal: goal.title,
    goal_id: goal.id,
    cause: rc.cause,
    evidence: rc.evidence,
    execution_history: history,
    knowledge_used: knowledge.length
      ? knowledge
      : k?.status === "unavailable"
        ? "knowledge library unavailable; diagnosis is from history only"
        : "no matching passage",
    recommended_fix: rc.fix,
  };
  if (!change)
    return {
      ...base,
      change: null,
      next: "This cause needs the member, not the planner: explain the cause and the fix and ask the one question it needs (e.g. the exact first step, the prerequisite, or whether the goal still matters).",
    };
  const instructed =
    a["apply"] === true || (await import("./life-intelligence")).memberInstructed(ctx.memberText);
  if (!instructed)
    return {
      ...base,
      proposed_change: change.summary,
      applied: false,
      next: "Explain the cause from execution_history and the knowledge rule in plain words, then ask one yes/no question: apply this change? Do not just move the sessions.",
    };
  const upd: Record<string, unknown> = {};
  if (change.session_minutes) upd["session_minutes"] = change.session_minutes;
  if (change.weekly_minutes) upd["weekly_minutes"] = change.weekly_minutes;
  if (change.preferred_time) {
    upd["preferred_time"] = change.preferred_time;
    upd["preferred_start"] = null;
  }
  const admin = await adminDb();
  const { error } = await admin
    .from("goals")
    .update(upd as never)
    .eq("id", goal.id)
    .eq("user_id", userId);
  if (error) return { ...base, applied: false, error: "could_not_save", detail: error.message };
  let rebuilt: unknown = null;
  try {
    const { proposeWeekPlan, approveWeekPlan } = await import("./planning.functions");
    const p = (await proposeWeekPlan({ data: { trigger: "manual", week: "current" } })) as {
      id: string;
    };
    const r = await approveWeekPlan({
      data: { proposalId: p.id, mode: "permanent", trialDays: 14 },
    });
    rebuilt = { sessions_added: (r as { blocksCreated?: number }).blocksCreated ?? 0 };
  } catch (e) {
    rebuilt = { error: (e as Error).message };
  }
  // Decision rationale on the goal's mission: cause, change and the knowledge ids behind it.
  const ms = ms0;
  if (ms) {
    const met = ms.metrics ?? {};
    await admin
      .from("goal_missions")
      .update({
        metrics: {
          ...met,
          adaptations: [
            ...(met.adaptations ?? []),
            {
              at: new Date().toISOString(),
              cause: rc.cause,
              evidence: rc.evidence,
              change: change.summary,
              knowledge_refs: knowledge.map((x) => x.id),
            },
          ].slice(-10),
          knowledge_basis: [
            ...((met.knowledge_basis ?? []) as any[]).filter(
              (x) => !knowledge.some((n) => n.id === x.id),
            ),
            ...knowledge.map(({ id, title, domain }) => ({
              id,
              title,
              domain,
              at: new Date().toISOString(),
            })),
          ].slice(-16),
        },
        history: [
          ...(ms.history ?? []),
          {
            at: new Date().toISOString(),
            from: ms.state,
            to: ms.state,
            why: `root cause ${rc.cause}: ${change.summary}`,
          },
        ].slice(-40),
      })
      .eq("id", ms.id);
  }
  return {
    ...base,
    applied: true,
    authorised_by: "member_instruction",
    change: change.summary,
    goal_now: upd,
    week_rebuilt: rebuilt,
    next: "Tell the member the cause (from the evidence), the change now on their plan and the knowledge rule behind it in one line each.",
  };
}
