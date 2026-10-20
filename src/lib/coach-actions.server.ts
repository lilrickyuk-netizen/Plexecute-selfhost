// Coach execution tools (V3 Coach-as-execution rule). Every write goes through the same table rules (RLS
// client), the same domain server functions, or the same plan-proposal/approval path the screens use.
// Destructive, bulk or material changes become coach_pending_actions the member confirms in chat.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CoachAction } from "./coach-tools";
import { SESSION_TYPES } from "./wellness";
import { preservesExistingBooking } from "./appointments";
import { addDaysKey, localDayKey, weekKeyOf, zonedInstant, zonedParts } from "./tz";

type Db = SupabaseClient<Database>;
export type ActionCtx = {
  db: Db; // guarded user (RLS) client
  admin: Db; // guarded service client, used only for audit / plan_versions / scheduled_calls (as the UI's server fns do)
  userId: string;
  tier: string;
  tz: string | null;
  actions: CoachAction[];
  messageId?: string;
  /** The member's own words this turn; a capability question never starts a booking. */
  memberText?: string;
};

import type { CoachActionTool } from "./coach-action-names";
export {
  COACH_ACTION_TOOLS,
  CONFIRM_KINDS,
  type CoachActionTool,
  type PendingKind,
} from "./coach-action-names";

import type { PendingKind } from "./coach-action-names";

const N = (type: string, description: string) => ({ type: [type, "null"], description });
const S = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const strArr = (description: string) => ({ type: "array", items: { type: "string" }, description });

export const COACH_ACTION_DEFS: {
  name: CoachActionTool;
  description: string;
  parameters: unknown;
}[] = [
  {
    name: "find_appointment",
    description:
      "Execute only. Start ANY real-world booking a business takes by phone or online — the examples are not a limit: appointments (dentist, GP reception, barber, vet, physio, MOT, car service, tradespeople, cleaners, tutors, viewings), reservations (restaurant tables, hotels, courts, classes, tickets, venues, taxis/minicabs/airport transfers with category transport — put pickup_address, pickup_time, destination, passengers in details) or simple orders (flowers, gifts, takeaway). Use category other when nothing fits. Never refuse because a type isn't listed. One booking per request: for 'flowers and a table' call it twice. If get_appointments already shows an open booking for the same thing, continue it (choose_appointment / prepare_checkout with its booking_id) instead of calling this again. Checks the member's real schedule for free times and finds providers (their usual one, a named one, or a web search). Nothing is booked. Work out dates/times from their words and fixed commitments (e.g. after work). If they describe something urgent, do not book: safety comes first.",
    parameters: obj({
      service: S("What the appointment is for, e.g. dentist check-up"),
      request_text: S("The member's words"),
      date_from: S("YYYY-MM-DD"),
      date_to: S("YYYY-MM-DD"),
      earliest: S("Earliest start HH:MM"),
      latest: S("Latest start HH:MM"),
      duration_min: { type: "number", description: "Expected length in minutes" },
      travel_min: {
        type: ["number", "null"],
        description: "Travel each way in minutes only if the member said; else null",
      },
      max_price: {
        type: ["number", "null"],
        description: "Maximum price in pounds/dollars, or null",
      },
      location: N("string", "Area or postcode, or null"),
      provider_name: N("string", "A named provider, or null"),
      provider_url: N("string", "Booking page URL if given, or null"),
      provider_phone: N("string", "Provider phone with country code if given, or null"),
      use_usual: { type: "boolean", description: "True for 'my usual dentist' etc." },
      preauthorised: {
        type: "boolean",
        description:
          'True whenever the member gave a time range ("between 7 and 9pm") or asked for a taxi: that range is their authorisation to book the first available time inside it',
      },
      kind: { type: "string", enum: ["appointment", "reservation", "order"] },
      category: {
        type: "string",
        enum: [
          "health",
          "personal_care",
          "automotive",
          "restaurant",
          "hotel",
          "leisure",
          "professional",
          "flowers",
          "gifts",
          "repair",
          "transport",
          "other",
        ],
      },
      details: {
        type: "object",
        description:
          "Only details the member gave for this booking. Restaurant: party_size, cuisine, seating, dietary, occasion. Barber/hair: service_type, stylist. Car: vehicle, registration, dropoff. Hotel: check_in, check_out, guests, room. Flowers/gifts: recipient, delivery_address, delivery_window (a delivery time such as 'before 17:00', never a price), card_message, style, budget_note. Never card details.",
        additionalProperties: { type: ["string", "number"] },
      },
    }),
  },
  {
    name: "choose_appointment",
    description:
      "The member picked a provider and free time. method online opens the provider's booking page for them; method phone has Plexecute call the business (Pro/Execute only, needs the business number, never ask the member to approve a time: once they gave a time range the booking is pre-authorised, so call this at once with the start of their range).",
    parameters: obj({
      booking_id: S("From find_appointment"),
      provider_index: { type: ["number", "null"], description: "Index in providers, or null" },
      date: S("YYYY-MM-DD"),
      start: S("HH:MM"),
      end: S("HH:MM"),
      method: { type: "string", enum: ["online", "phone"] },
      provider_phone: N("string", "Business phone with country code, or null"),
    }),
  },
  {
    name: "confirm_appointment",
    description:
      "Record a booking the member has completed online. Requires the confirmation reference or message they received. Never call this without one. Adds it to the calendar and reports any planned sessions that now clash.",
    parameters: obj({
      booking_id: S("Booking id"),
      date: S("YYYY-MM-DD"),
      start: S("HH:MM"),
      end: S("HH:MM"),
      reference: N("string", "Booking reference, or null"),
      confirmation_text: N("string", "Confirmation message text, or null"),
      price: { type: ["number", "null"], description: "Price charged by the business, or null" },
      deposit: { type: ["number", "null"], description: "Deposit paid, or null" },
      cancellation_terms: N("string", "Cancellation terms, or null"),
      prep_notes: N("string", "Preparation notes, or null"),
      address: N("string", "Address, or null"),
      accept_terms: {
        type: "boolean",
        description: "True only if the member accepted a different time/price/deposit",
      },
    }),
  },
  {
    name: "prepare_checkout",
    description:
      "Payment is required (deposit, prepayment, order). Call it as soon as the member gives the business's checkout link (or it was found) for an open booking; you cannot see inside that page, so use the amount the member or business stated. Records the business's own secure https checkout page and sends it to the member to pay themselves, showing amount, deposit, fees and terms. Plexecute never pays and never takes card details. Never call confirm_appointment until the member sends the confirmation after paying.",
    parameters: obj({
      booking_id: S("Booking id"),
      checkout_url: S("The business's secure checkout/payment page (https)"),
      amount: {
        type: ["number", "null"],
        description: "Total to pay, or null if only shown on their page",
      },
      deposit: { type: ["number", "null"], description: "Deposit, or null" },
      fee: { type: ["number", "null"], description: "Booking/delivery/cancellation fee, or null" },
      cancellation_terms: N("string", "Cancellation/no-show terms, or null"),
      expires_in_min: {
        type: ["number", "null"],
        description: "How long the hold/checkout lasts if the business said, else null",
      },
      date: N("string", "YYYY-MM-DD of the held time, or null for orders"),
      start: N("string", "HH:MM, or null"),
      end: N("string", "HH:MM, or null"),
    }),
  },
  {
    name: "get_appointments",
    description:
      "The member's bookings, reservations and orders with status and payment state (checkout_ready means waiting for them to pay; expired means it must be re-checked).",
    parameters: obj({}),
  },
  {
    name: "cancel_appointment",
    description:
      "Cancel a booked appointment. Shows cancellation terms; the calendar entry and reminders are removed only after the member confirms it was cancelled with the business.",
    parameters: obj({ booking_id: S("Booking id") }),
  },
  {
    name: "reschedule_appointment",
    description:
      "Move a booked appointment: finds new free times with the same provider. The original stays until the new time is confirmed.",
    parameters: obj({
      booking_id: S("Booking id"),
      date_from: S("YYYY-MM-DD"),
      date_to: S("YYYY-MM-DD"),
      earliest: S("HH:MM"),
      latest: S("HH:MM"),
    }),
  },
  {
    name: "draft_goal_pathway",
    description:
      "Universal goal planner for ANY legitimate goal (become a pilot, buy a first home, write a novel, save £10,000, move abroad...). Researches current official requirements when needed, builds the definition of done, route options, prerequisites, costs, dependent milestones and concrete actions, and checks it against the member's real free time and money. If feasible it is saved as a proposed goal the member confirms on the Goals page; if impossible it returns why and the earliest realistic alternative. If it returns clarify questions, ask them, then call again. Never write your own generic plan instead.",
    parameters: obj({
      goal: S("The goal in the member's words"),
      deadline: S("YYYY-MM-DD target date, if they gave one"),
      jurisdiction: S("Country, if it matters and is known"),
      budget: S("Money they have available for it now (number)"),
      monthly_saving: S("Money they can set aside per month (number)"),
      current: S("Current amount already saved/achieved (number)"),
      feedback: S("What to change, when revising"),
    }),
  },
  {
    name: "update_pathway_milestone",
    description:
      "Record progress on a pathway milestone: complete (with evidence for major steps, e.g. 'pass certificate 12345'), block (e.g. course cancelled, funding refused), fail (e.g. exam failed — keeps it open with a retry), unblock. Completed work is always kept; dependants wait while blocked.",
    parameters: obj({
      milestone_id: S("Milestone id"),
      action: S("complete | block | fail | unblock"),
      evidence: S("Evidence of completion"),
      reason: S("Why it is blocked or failed"),
    }),
  },
  {
    name: "plan_journey",
    description:
      "Plan a journey with Google Maps (Pro/Execute): works out the route, travel time and when to leave, and reserves the travel window in the member's plan so nothing else is scheduled over it. Use for 'plan my journey to work', 'what time do I leave for the dentist', 'get me to my meeting for 9'. Destination can be a saved place (home/work), an address, a business name, or a booked appointment. Never quote a travel time you did not get from this tool.",
    parameters: obj({
      destination: S("Where they're going: saved place label, address, business/place name"),
      origin: S("Where from: 'home', 'work', an address, or empty for their usual start"),
      mode: S("drive | transit | walk"),
      arrive_by: S("ISO time they must arrive by"),
      buffer_min: S("Extra minutes early they want to arrive (default 10)"),
      appointment_id: S("Linked appointment booking id, if any"),
    }),
  },
  {
    name: "get_journeys",
    description: "List the member's planned journeys with leave times, modes and statuses.",
    parameters: obj({}),
  },
  {
    name: "change_journey",
    description:
      "Change a planned journey: switch mode (driving→train), change origin ('leaving from work instead'), or adjust the arrival buffer. Recalculates only what changed.",
    parameters: obj({
      journey_id: S("Journey id"),
      mode: S("drive | transit | walk (optional)"),
      origin: S("New origin (optional)"),
      buffer_min: S("New buffer minutes (optional)"),
    }),
  },
  {
    name: "cancel_journey",
    description: "Cancel a planned journey and remove its travel block from the plan.",
    parameters: obj({ journey_id: S("Journey id") }),
  },
  {
    name: "journey_leave_call",
    description:
      "Schedule a phone call at the moment the member needs to leave for a journey ('call me when I need to leave'). Uses their normal call allowance — Free members cannot schedule calls.",
    parameters: obj({ journey_id: S("Journey id") }),
  },
  {
    name: "update_commitment",
    description:
      "Change one commitment (id from get_schedule_context): title, day, start/end time or note. One-off changes save at once; recurring ones need the member's confirmation.",
    parameters: obj({
      commitment_id: S("Commitment id"),
      title: N("string", "New title or null"),
      day: N("string", "New day (today, tomorrow, friday, YYYY-MM-DD) or null"),
      start_time: N("string", "New start HH:MM or null"),
      end_time: N("string", "New end HH:MM or null"),
      note: N("string", "New note or null"),
    }),
  },
  {
    name: "remove_commitments",
    description:
      "Remove commitments: either listed ids, or every commitment on a day. Never deletes immediately; the member confirms first. Scheduled calls before them are cancelled too.",
    parameters: obj({
      commitment_ids: strArr("Ids to remove, or empty when using day"),
      day: N(
        "string",
        "Remove all one-off commitments on this day (tomorrow, friday, YYYY-MM-DD), or null",
      ),
    }),
  },
  {
    name: "reschedule_scheduled_call",
    description:
      "Move a booked accountability call (id from get_schedule_context) to a new time on its day, or a new lead time before its commitment.",
    parameters: obj({
      call_id: S("Scheduled call id"),
      new_time: N("string", "New call time HH:MM or null"),
      lead_minutes: N("number", "Minutes before the commitment, or null"),
    }),
  },
  {
    name: "edit_plan",
    description:
      "Change planned sessions (ids from get_plan/get_today): move a session to a new time/day, swap two sessions by sending both moves, remove sessions, or clear a whole day. A direct member instruction overrides internal locks on explicitly targeted Plexecute-created items, never fixed external commitments. Internal locks still prevent automatic changes. Finished and in-progress sessions stay unchanged. A passed start time is not a lock. Applies through the approved plan path.",
    parameters: obj({
      moves: {
        type: "array",
        items: obj({
          session_id: S("Session id"),
          day: N("string", "New day or null for same day"),
          time: S("New start HH:MM"),
        }),
      },
      remove_session_ids: strArr("Sessions to remove"),
      clear_day: N(
        "string",
        "Empty this day with no rebuild (only when the member wants nothing planned that day), or null",
      ),
      rebuild_day: N(
        "string",
        "Clear and rebuild this day: its sessions are re-placed around its commitments (deterministic first free slot). Use for any 'clear/redo/rebuild the day around X' request. Or null",
      ),
      reason: S("Why, in the member's words"),
    }),
  },
  {
    name: "delete_goal",
    description:
      "Permanently delete one goal (id from get_goals). Never deletes immediately: shows the member exactly what goes (milestones, upcoming sessions, reminders, calls, entries) and what stays, then they press Confirm.",
    parameters: obj({ goal_id: S("Goal id from get_goals") }),
  },
  {
    name: "delete_plan",
    description:
      "Delete a week's plan: its upcoming planned sessions, their reminders and calls, and any pending proposal. Finished sessions, commitments and routines stay. Never deletes immediately; the member confirms first.",
    parameters: obj({
      week: N(
        "string",
        "'this week', 'next week' or a YYYY-MM-DD in that week; null for this week",
      ),
    }),
  },
  {
    name: "update_goal",
    description:
      "Change an existing goal (id from get_goals): title, why, sessions per week, session length, weekly minutes, deadline, time of day (preferred_time: morning for 'every morning' / 'before breakfast') or status (active to activate a proposed goal, paused, completed). Applied at once when the member asked for it; then call request_replan so the plan reflects it.",
    parameters: obj({
      goal_id: S("Goal id"),
      title: N("string", "New title or null"),
      why: N("string", "New reason or null"),
      sessions_per_week: N("number", "Sessions per week or null"),
      session_minutes: N("number", "Minutes per session or null"),
      weekly_minutes: N("number", "Weekly minutes or null"),
      deadline: N("string", "YYYY-MM-DD or null"),
      status: N("string", "active | paused | completed, or null"),
      preferred_time: N("string", "morning | midday | evening | any, or null"),
      days_of_week: {
        type: ["array", "null"],
        items: { type: "string" },
        description: "Exact weekdays, e.g. monday..friday, or null",
      },
      start_time: N("string", "Exact start time HH:MM, or null"),
      stop_training: N(
        "boolean",
        "true only when the member explicitly asked to stop or pause all training; otherwise null",
      ),
    }),
  },
  {
    name: "add_milestone",
    description: "Add a milestone to a goal.",
    parameters: obj({
      goal_id: S("Goal id"),
      title: S("Milestone"),
      due_date: N("string", "YYYY-MM-DD or null"),
    }),
  },
  {
    name: "update_milestone",
    description: "Rename, re-date, complete or reopen a milestone (id from get_goals).",
    parameters: obj({
      milestone_id: S("Milestone id"),
      title: N("string", "New title or null"),
      due_date: N("string", "YYYY-MM-DD or null"),
      done: N("boolean", "true to complete, false to reopen, null to leave"),
    }),
  },
  {
    name: "add_reflection",
    description: "Save a goal reflection.",
    parameters: obj({
      goal_id: S("Goal id"),
      went_well: N("string", "What went well"),
      got_in_way: N("string", "What got in the way"),
      change_next: N("string", "What to change next"),
    }),
  },
  {
    name: "record_progress",
    description: "Record a progress value on a goal's target metric.",
    parameters: obj({
      goal_id: S("Goal id"),
      value: { type: "number" },
      note: N("string", "Note"),
    }),
  },
  {
    name: "add_checkin",
    description: "Save today's recovery check-in (scores 1-5).",
    parameters: obj({
      sleep_quality: { type: "number" },
      energy: { type: "number" },
      soreness: { type: "number" },
      stress: { type: "number" },
      ill_or_injured: { type: "boolean" },
      note: N("string", "Note"),
    }),
  },
  {
    name: "add_daily_log",
    description:
      "Quick daily log: weight (kg), sleep (hours) or energy (1-10), with an optional note.",
    parameters: obj({
      kind: { type: "string", enum: ["weight", "sleep", "energy"] },
      value: { type: "number" },
      note: N("string", "Note"),
    }),
  },
  {
    name: "update_availability",
    description:
      "Change wake/sleep times and work hours/days (work_days as 0=Sun,1=Mon..6=Sat, same as Settings). The member confirms, then a new plan proposal is offered.",
    parameters: obj({
      wake_time: N("string", "HH:MM"),
      sleep_time: N("string", "HH:MM"),
      work_start: N("string", "HH:MM"),
      work_end: N("string", "HH:MM"),
      work_days: { type: ["array", "null"], items: { type: "number" } },
    }),
  },
  {
    name: "log_movement",
    description: "Log a cardio session the member did (runs progression rules).",
    parameters: obj({
      modality: {
        type: "string",
        enum: ["walking", "running", "cycling", "rowing", "swimming", "conditioning"],
      },
      minutes: { type: "number" },
      rpe: { type: "number", description: "Effort 1-10" },
      completed: { type: "boolean" },
      pain: { type: "boolean" },
      note: N("string", "Note"),
    }),
  },
  {
    name: "log_wellness",
    description: "Log a meditation/wellness session the member did.",
    parameters: obj({
      type: { type: "string", enum: Object.keys(SESSION_TYPES) },
      minutes: { type: "number" },
      note: N("string", "Note"),
    }),
  },
  {
    name: "find_guided_videos",
    description:
      "Find real, checked guided yoga or meditation videos matching a focus and the time the member has (same engine as Wellness). Use when they ask for yoga/meditation to follow now. Never invent video links; only share what this returns. If they report injury, significant pain or recent surgery, give safety guidance instead of presenting a video as treatment.",
    parameters: obj({
      activity: { type: "string", enum: ["yoga", "meditation"] },
      focus: {
        type: "string",
        description:
          "yoga: full_body upper_body lower_body back neck_shoulders hips legs core mobility flexibility stretching recovery morning evening relaxation post_workout desk beginner wellbeing; meditation: relaxation stress mindfulness focus sleep confidence motivation gratitude breathing morning evening recovery before_event reset",
      },
      minutes: { type: "number" },
    }),
  },
  {
    name: "add_wellness_practice",
    description:
      "Add a recurring guided yoga or meditation practice to the member's plan (e.g. 10-minute meditation every morning). The member confirms; the planner schedules it.",
    parameters: obj({
      activity: { type: "string", enum: ["yoga", "meditation"] },
      focus: { type: "string" },
      minutes: { type: "number" },
      per_week: { type: "number", description: "1-14" },
      preferred_time: { type: "string", enum: ["morning", "midday", "evening", "any"] },
    }),
  },
  {
    name: "set_wellness_preferences",
    description:
      "Change meditation/wellness plan: sessions per week, length and time of day. The member confirms.",
    parameters: obj({
      sessions_per_week: N("number", "1-14"),
      min_minutes: N("number", "2-60"),
      max_minutes: N("number", "2-90"),
      preferred_time: N("string", "morning | midday | evening | any"),
      enabled: N("boolean", "Switch on/off"),
    }),
  },
  {
    name: "get_nutrition_status",
    description:
      "Calories and macros eaten so far (from the food log), the member's targets, what's left, and the meals planned for that day in the accepted meal plan. Use for any 'how many calories have I eaten / got left / protein so far / what's for dinner tonight / tomorrow's lunch' question.",
    parameters: obj({ day: S("today, tomorrow, a weekday or YYYY-MM-DD") }),
  },
  {
    name: "get_meal_prep",
    description:
      "The member's food inventory and current inventory-based meal-prep plan (id, status, days with meals and kcal/macros, shopping list, batch-prep sessions).",
    parameters: obj({}),
  },
  {
    name: "add_food_inventory",
    description:
      "Add foods the member says they have (typed or spoken list, e.g. 'six chicken breasts, a kilo of rice, eggs'). Same inventory as the Nutrition screen; amounts not stated stay unknown and are returned in needs_quantity so you can ask.",
    parameters: obj({ text: S("The foods exactly as the member listed them") }),
  },
  {
    name: "update_food_inventory",
    description:
      "Correct one inventory food: set grams, mark 'use as needed', rename, or remove it.",
    parameters: obj({
      name: S("Food as listed"),
      grams: N("number", "Total grams they have"),
      as_needed: { type: "boolean" },
      remove: { type: "boolean" },
      rename_to: N("string", "Correct food name"),
    }),
  },
  {
    name: "plan_meal_prep",
    description:
      "Build a real weekly diet/meal plan with Plexecute's meal engine (not your own ideas). Use this whenever the member asks for a diet plan, meal plan or what to eat this week. Works even with no food inventory (uses healthy everyday staples and produces a shopping list) — never refuse or ask for inventory first. When the member asked for the plan it is accepted straight away (no review step); otherwise it is saved as a proposal. Always pass kcal and protein_g: use estimate_energy_needs first when weight is known (gain: its gain kcal; protein about 1.8-2.2 g per kg), and when the member names a calorie range use its midpoint or higher. Their saved daily targets are never changed. Then call schedule_meals with from_meal_plan true to put each day's real meals on the daily plan.",
    parameters: obj({
      start_day: S("first day: today, tomorrow, next monday, a weekday or YYYY-MM-DD"),
      days: { type: "number", description: "1-7" },
      only_existing: { type: "boolean", description: "true when they say only use what I have" },
      kcal: N("number", "plan calories per day if the member asked"),
      protein_g: N("number", "plan protein per day if the member asked"),
      prep_day: {
        type: "string",
        enum: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
      },
      unknown_as_needed: {
        type: "boolean",
        description: "true only if the member said to use foods without amounts as needed",
      },
    }),
  },
  {
    name: "edit_meal_prep",
    description:
      "Change the current meal-prep plan; only affected meals and totals change. action: replace (one meal, with avoid/prefer/vegetarian/quick), replace_from (every meal from a day onwards, optional slot), swap (day+slot with day2+slot2), adjust_kcal (kcal change for a day), more_protein (grams for a day), remove.",
    parameters: obj({
      action: {
        type: "string",
        enum: ["replace", "replace_from", "swap", "adjust_kcal", "more_protein", "remove"],
      },
      day: S("day words or YYYY-MM-DD"),
      slot: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
      day2: N("string", "second day for swap"),
      slot2: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
      avoid: strArr("foods to avoid, e.g. chicken, eggs"),
      prefer: strArr("foods wanted, e.g. eggs"),
      vegetarian: { type: "boolean" },
      quick: { type: "boolean" },
      kcal: N("number", "e.g. -200"),
      grams: N("number", "extra protein grams"),
    }),
  },
  {
    name: "accept_meal_prep",
    description: "Make the proposed meal-prep plan the member's real plan. The member confirms.",
    parameters: obj({}),
  },
  {
    name: "log_planned_meal",
    description:
      "Log a planned meal from the accepted plan as eaten into the food log (e.g. 'I've eaten my lunch'). factor for half/more. The member confirms. For a photo of what they actually ate, use get_meal_estimate then log_meal_estimate with planned_slot instead.",
    parameters: obj({
      day: S("today, yesterday or YYYY-MM-DD"),
      slot: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
      factor: N("number", "0.5 for half, 1.5 for one and a half"),
    }),
  },
  {
    name: "set_meal_preferences",
    description:
      "Save stable meal preferences for future plans: foods disliked (replaces the list), prep weekday, quick workday breakfasts.",
    parameters: obj({
      dislikes: strArr("foods they don't eat"),
      prep_day: {
        type: "string",
        enum: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
      },
      quick_breakfasts: { type: "boolean" },
    }),
  },
  {
    name: "propose_meal_plan",
    description:
      "Build a weekly meal plan proposal from the member's saved meals (approved on the Nutrition page).",
    parameters: obj({
      household: { type: "number" },
      prep_minutes: { type: "number" },
      exclusions: strArr("Foods to avoid"),
      next_week: { type: "boolean" },
    }),
  },
  {
    name: "add_learning_item",
    description: "Add a learning flashcard/review question to a learning goal.",
    parameters: obj({ goal_id: S("Learning goal id"), prompt: S("Question"), answer: S("Answer") }),
  },
  {
    name: "get_research_findings",
    description:
      "Read saved live research for this exact request: verified facts, discovered sources, interpretation and unconfirmed details. Pass research_id from research_topic to avoid mixing unrelated earlier searches.",
    parameters: obj({
      goal_id: N("string", "Goal id or null for all"),
      research_id: N("string", "Exact research id from research_topic"),
    }),
  },
  {
    name: "log_food",
    description:
      "Log food the member ATE. Either food_id+grams for a saved food (search_food), or eaten_text with their own words ('two scrambled eggs, two slices of toast and a banana') — Plexecute's food lookup works out each item and grams from its nutrition database. A direct 'log it' is the confirmation. Never ask for a photo when they described the food in words.",
    parameters: obj({
      food_id: N("string", "Saved food id from search_food, or null when using eaten_text"),
      eaten_text: N("string", "What the member said they ate, in their words, or null"),
      grams: { type: "number" },
      meal_slot: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
    }),
  },
  {
    name: "get_meal_estimate",
    description:
      "The member's meal photo estimate (foods, gram ranges, calorie and macro ranges, open questions, status pending/logged/cancelled). Omit estimate_id for the latest.",
    parameters: obj({
      estimate_id: N("string", "Estimate id from the attached photo note, or null for the latest"),
    }),
  },
  {
    name: "correct_meal_estimate",
    description:
      "Apply the member's correction to a pending meal photo estimate (e.g. 'that was two chicken breasts', 'no oil', '250 g chicken'). Recalculates and returns the new ranges. Does not log anything.",
    parameters: obj({
      estimate_id: S("Estimate id"),
      correction: S("The member's correction in their words"),
    }),
  },
  {
    name: "log_meal_estimate",
    description:
      "Log a meal photo estimate into the normal food log after the member says to log it. Queues a Confirm; returns already_logged if it was logged before.",
    parameters: obj({
      estimate_id: S("Estimate id"),
      meal_slot: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
      planned_slot: {
        type: "string",
        enum: ["breakfast", "lunch", "dinner", "snack"],
        description:
          "When the photo is of a meal from their accepted meal plan; it replaces that planned meal instead of adding a second one",
      },
    }),
  },
  {
    name: "explain_exercise",
    description:
      'Explain one exercise: from the member\'s current or next workout by position ("exercise 2") or by name ("Romanian deadlift"). Returns the prescription, setup, cues, common errors, easier options and a checked demonstration video link for that exact variation (or none). Never invent links.',
    parameters: obj({
      exercise: S("Position like 'exercise 2' or the exercise name as the member said it"),
    }),
  },
  {
    name: "build_workout",
    description:
      "TRAINING. Build one strength, bodyweight or conditioning workout with the Plexecute training engine (never a video search): focus upper, lower or full body, minutes, equipment (bodyweight for home/no-equipment), style conditioning for circuits. Use for 'give me a 30-minute upper-body workout' or 'a bodyweight workout at home'.",
    parameters: obj({
      focus: { type: "string", enum: ["upper", "lower", "full"] },
      minutes: { type: "number" },
      equipment: { type: "string", enum: ["gym", "home", "bodyweight"] },
      style: { type: "string", enum: ["strength", "muscle", "general", "conditioning"] },
    }),
  },
  {
    name: "get_cardio_session",
    description:
      "TRAINING. Today's cardio prescription (walk, run, cycle, row, swim, conditioning) from the cardio rules: minutes, effort, talk test, weekly active minutes. Use for 'I want to go for a run'.",
    parameters: obj({
      modality: {
        type: "string",
        enum: ["walking", "running", "cycling", "rowing", "swimming", "conditioning"],
      },
      intensity: { type: "string", enum: ["easy", "moderate", "vigorous"] },
    }),
  },
  {
    name: "get_mobility_session",
    description:
      "WELLNESS & MOVEMENT. A mobility or stretching/recovery sequence from the mobility rules for a region and length (spine for back stiffness). Use for 'my back is stiff, I have 10 minutes' or 'stretch after training' (intent flexibility). Pair with find_guided_videos (yoga) for a follow-along video if they want one.",
    parameters: obj({
      region: {
        type: "string",
        enum: ["hips", "hamstrings", "spine", "shoulders", "ankles", "full_body"],
      },
      minutes: { type: "number" },
      intent: { type: "string", enum: ["mobility", "flexibility"] },
    }),
  },
  {
    name: "get_training_programme",
    description:
      "Active strength programme with each exercise's id (prescription), sets/reps/load and allowed swaps.",
    parameters: obj({}),
  },
  {
    name: "substitute_exercise",
    description:
      "Swap one programme exercise for a matching movement (key from allowed_swaps). Saves at once and logs a progression event.",
    parameters: obj({
      prescription_id: S("Exercise id from get_training_programme"),
      exercise_key: S("Replacement key from allowed_swaps"),
    }),
  },
  {
    name: "change_training_programme",
    description:
      "Replace the training programme with a new one built by the training rules (days, length, equipment, goal, limitations). Bodyweight circuits: equipment bodyweight, goal conditioning (or hypertrophy for muscle gain). The engine programmes up to 6 days; for 'every day' use 6 and recommend one easy mobility or rest day. Applied at once when the member asked for it. The programme IS the member's training goal on the plan: set preferred_time here (morning for 'every morning' / 'before breakfast') and never create a separate goal for the same training.",
    parameters: obj({
      goal: {
        type: "string",
        enum: ["strength", "hypertrophy", "general", "conditioning", "mixed"],
      },
      experience: { type: "string", enum: ["novice", "intermediate"] },
      equipment: { type: "string", enum: ["gym", "home", "bodyweight"] },
      days: { type: "number", description: "2-6 per week" },
      session_minutes: { type: "number", description: "20-120" },
      limitations: {
        type: "array",
        items: { type: "string", enum: ["knee_pain", "back_pain", "shoulder_pain", "wrist_pain"] },
      },
      preferred_time: {
        type: "string",
        enum: ["morning", "midday", "evening", "any"],
        description: "When the sessions happen",
      },
      days_of_week: {
        type: "array",
        items: { type: "string" },
        description:
          'Exact weekdays asked for, e.g. ["monday","tuesday","wednesday","thursday","friday"] for \'Monday to Friday\'. Sessions go only on these days.',
      },
      start_time: {
        type: "string",
        description: "Exact start time asked for, HH:MM (e.g. 07:00 for '7am training')",
      },
      exercises: {
        type: "array",
        items: { type: "string" },
        description:
          'Exercises the member named, in their words (e.g. ["pull ups","dips","push ups","squats","burpees","ab exercises"]). Every session is built from exactly these. Keep the current days_of_week/start_time when only the exercises change.',
      },
    }),
  },
  {
    name: "log_mobility",
    description:
      "Log a mobility/stretching session the member did (runs mobility progression rules).",
    parameters: obj({
      region: {
        type: "string",
        enum: ["hips", "hamstrings", "spine", "shoulders", "ankles", "full_body"],
      },
      minutes: { type: "number" },
      tolerance: { type: "string", enum: ["easy", "right", "hard"] },
      restrictions: {
        type: "array",
        items: { type: "string", enum: ["knee", "back", "shoulder", "wrist"] },
      },
      completed: { type: "boolean" },
      pain: { type: "boolean" },
      note: N("string", "Note"),
    }),
  },
  {
    name: "get_routines",
    description:
      "The member's routines and habits: daily wake/work routine, weekly commitments, meditation routine and habit goals, with which tool changes each.",
    parameters: obj({}),
  },
  {
    name: "get_connected_devices",
    description: "Connected wearables and phone health connections with ids, status and last sync.",
    parameters: obj({}),
  },
  {
    name: "sync_connected_device",
    description: "Fetch the latest data now from one connected wearable.",
    parameters: obj({ connection_id: S("Id from get_connected_devices") }),
  },
  {
    name: "disconnect_connected_device",
    description:
      "Disconnect a wearable, optionally deleting its imported data. The member confirms.",
    parameters: obj({
      connection_id: S("Id from get_connected_devices"),
      delete_data: { type: "boolean" },
    }),
  },
];

const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const hmOk = (v: unknown) => (typeof v === "string" && HM.test(v) ? v.padStart(5, "0") : null);
const str = (v: unknown, n = 300) => (v == null ? null : String(v).slice(0, n));
const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const clampInt = (v: number, lo: number, hi: number) => Math.min(Math.max(Math.round(v), lo), hi);
const isoDow = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The member's own recent words (this turn plus saved chat), for facts like what equipment they have. */
export async function memberHistory(ctx: {
  db: Db;
  userId: string;
  memberText?: string | null;
}): Promise<string> {
  const { data } = await ctx.db
    .from("coach_messages")
    .select("content")
    .eq("user_id", ctx.userId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(60);
  return [
    ctx.memberText ?? "",
    ...((data ?? []) as { content: string }[]).map((m) => m.content),
  ].join("\n");
}

async function audit(
  ctx: { admin: Db; userId: string; messageId?: string | undefined },
  action: string,
  target: string | null,
  metadata: Record<string, unknown>,
) {
  await ctx.admin.from("audit_events").insert({
    user_id: ctx.userId,
    actor_type: "user",
    action,
    resource_type: action.split(".")[1]?.split("_")[0] ?? "coach",
    resource_id: target,
    outcome: "succeeded",
    metadata: { ...metadata, source: "coach", source_message: ctx.messageId ?? null },
  } as never);
}

/** Permanent deletions keep their impact preview and one in-chat Confirm, even when instructed. */
const ALWAYS_CONFIRM = new Set<string>(["delete_goal", "delete_plan"]);

/** Whether the member's own words this turn told Coach to do this (then their instruction is the confirmation). */
export async function instructedNow(ctx: { memberText?: string | undefined }) {
  return (await import("./life-intelligence")).memberInstructed(ctx.memberText);
}

async function pend(
  ctx: ActionCtx,
  kind: PendingKind,
  summary: string,
  payload: Record<string, unknown>,
) {
  const mustConfirm =
    ALWAYS_CONFIRM.has(kind) || (kind === "disconnect_device" && payload["delete_data"] === true);
  const instructed = !mustConfirm && (await instructedNow(ctx));
  const { data, error } = await ctx.admin
    .from("coach_pending_actions")
    .insert({
      user_id: ctx.userId,
      kind,
      summary: summary.slice(0, 400),
      payload: payload as never,
      source_message: ctx.messageId ?? null,
      ...(instructed ? { status: "confirmed", decided_at: new Date().toISOString() } : {}),
    })
    .select("id")
    .single();
  if (error || !data) return { error: "could_not_queue_confirmation" };
  if (instructed) {
    // The member told Coach to do this in their own words: that is the confirmation, so it runs now, once.
    try {
      const result = await runPending(ctx.db, ctx.admin, ctx.userId, {
        id: data.id,
        kind,
        payload,
      });
      await ctx.admin
        .from("coach_pending_actions")
        .update({ result: result as never })
        .eq("id", data.id);
      await audit(ctx, "coach.action_instructed", data.id, { kind });
      return { done: true, saved_now: true, authorised_by: "member_instruction", summary, result };
    } catch (e) {
      await ctx.admin
        .from("coach_pending_actions")
        .update({ status: "failed", result: { error: (e as Error).message } as never })
        .eq("id", data.id);
      return { error: (e as Error).message || "could_not_apply", summary };
    }
  }
  ctx.actions.push({
    kind: "confirm",
    id: data.id,
    label: summary.slice(0, 400),
    reason: mustConfirm
      ? "This is permanent, so press Confirm to go ahead."
      : "Nothing changes until you press Confirm.",
  });
  return { awaiting_member_confirmation: true, pending_action_id: data.id, summary };
}

async function resolveDayExpr(expr: unknown, ctx: { tz: string | null }) {
  if (expr == null || expr === "") return null;
  const { resolveDay } = await import("./coach-scheduling");
  return resolveDay(String(expr), localDayKey(new Date(), ctx.tz));
}

export async function execActionTool(
  ctx: ActionCtx,
  tool: CoachActionTool,
  a: Record<string, unknown>,
): Promise<unknown> {
  const { db, userId } = ctx;
  const today = localDayKey(new Date(), ctx.tz);
  if (/_appointment|appointments|^prepare_checkout$/.test(tool))
    return appointmentTool(ctx, tool, a);
  if (/journey|journeys/.test(tool)) return journeyTool(ctx, tool, a);
  if (/pathway/.test(tool)) return pathwayTool(ctx, tool, a);
  switch (tool) {
    case "update_commitment": {
      const { data: c } = await db
        .from("commitments")
        .select("*")
        .eq("id", String(a["commitment_id"]))
        .maybeSingle();
      if (!c) return { error: "unknown_commitment", hint: "Use an id from get_schedule_context." };
      const patch: Record<string, unknown> = {};
      if (a["title"]) patch["title"] = str(a["title"], 120);
      if (a["note"] != null) patch["note"] = str(a["note"], 300);
      const st = hmOk(a["start_time"]);
      const en = hmOk(a["end_time"]);
      if (a["start_time"] && !st) return { error: "start_time_must_be_HH:MM" };
      if (st) {
        patch["start_time"] = st;
        if (!en) {
          const { toMin } = await import("./scheduler");
          const { hm } = await import("./coach-scheduling");
          const len = Math.max((toMin(c.end_time) ?? 0) - (toMin(c.start_time) ?? 0), 15);
          patch["end_time"] = hm(Math.min((toMin(st) ?? 0) + len, 1439));
        }
      }
      if (en) patch["end_time"] = en;
      if (a["day"]) {
        if (c.recurrence === "weekly")
          return {
            error: "weekly_commitment_day_change_not_supported_here",
            hint: "Ask the member which weekdays.",
          };
        const d = await resolveDayExpr(a["day"], ctx);
        if (!d) return { error: "could_not_understand_day" };
        if (d < today) return { error: "day_has_passed" };
        patch["on_date"] = d;
      }
      if (!Object.keys(patch).length) return { error: "nothing_to_change" };
      if (c.recurrence === "weekly")
        return pend(ctx, "update_recurring_commitment", `Change weekly "${c.title}"`, {
          commitment_id: c.id,
          patch,
        });
      const { error } = await db
        .from("commitments")
        .update(patch as never)
        .eq("id", c.id);
      if (error) return { error: error.message };
      await audit(ctx, "coach.commitment_updated", c.id, { patch });
      const moved_calls = await moveCallsWithCommitment(ctx, c, patch);
      ctx.actions.push({
        kind: "link",
        label: "See Commitments",
        to: "/app/commitments",
        reason: "Updated.",
      });
      return { updated: true, commitment_id: c.id, ...patch, moved_calls };
    }
    case "remove_commitments": {
      if (preservesExistingBooking(ctx.memberText ?? ""))
        return {
          error: "separate_booking_preserves_existing",
          message:
            "The member requested a separate booking, not removal of an existing reservation. Continue the new booking without deleting commitments.",
        };
      let ids = Array.isArray(a["commitment_ids"])
        ? (a["commitment_ids"] as unknown[]).map(String).slice(0, 50)
        : [];
      let day: string | null = null;
      if (!ids.length && a["day"]) {
        day = await resolveDayExpr(a["day"], ctx);
        if (!day) return { error: "could_not_understand_day" };
        const { data } = await db
          .from("commitments")
          .select("id")
          .eq("active", true)
          .eq("recurrence", "once")
          .eq("on_date", day);
        ids = (data ?? []).map((x) => x.id);
      }
      const { data: found } = ids.length
        ? await db
            .from("commitments")
            .select("id,title,on_date,start_time,recurrence")
            .in("id", ids)
        : { data: [] };
      if (!found?.length) return { error: "no_matching_commitments", day };
      const names = found.map(
        (f) =>
          `${f.title}${f.on_date ? ` (${f.on_date} ${f.start_time.slice(0, 5)})` : " (weekly)"}`,
      );
      return pend(
        ctx,
        "remove_commitments",
        `Remove ${found.length} commitment${found.length > 1 ? "s" : ""}: ${names.join(", ")}`,
        {
          commitment_ids: found.map((f) => f.id),
        },
      );
    }
    case "reschedule_scheduled_call": {
      const { data: call } = await ctx.admin
        .from("scheduled_calls")
        .select("*")
        .eq("id", String(a["call_id"]))
        .eq("user_id", userId)
        .maybeSingle();
      if (!call) return { error: "unknown_call" };
      if (call.status !== "scheduled") return { error: `call_already_${call.status}` };
      const dayKey = localDayKey(call.call_at, ctx.tz);
      let minute: number | null = null;
      const nt = hmOk(a["new_time"]);
      if (nt) {
        const { toMin } = await import("./scheduler");
        minute = toMin(nt);
      } else if (num(a["lead_minutes"]) != null && call.commitment_id) {
        const { data: c } = await db
          .from("commitments")
          .select("start_time")
          .eq("id", call.commitment_id)
          .maybeSingle();
        const { toMin } = await import("./scheduler");
        if (c) minute = (toMin(c.start_time) ?? 0) - clampInt(num(a["lead_minutes"])!, 0, 24 * 60);
      }
      if (minute == null) return { error: "give_new_time_or_lead_minutes" };
      const at = zonedInstant(dayKey, minute, ctx.tz);
      if (at.getTime() < Date.now()) return { error: "call_time_has_passed" };
      return rebookCall(ctx, call, at, "coach.call_rescheduled");
    }
    case "edit_plan":
      return proposePlanEdit(ctx, a);
    case "delete_goal": {
      const d = await import("./deletion.server");
      const imp = await d.goalImpact(ctx.admin, userId, String(a["goal_id"]));
      if (!imp.found)
        return { already_deleted_or_unknown: true, hint: "Use an id from get_goals." };
      const t = d.describeImpact(imp);
      return pend(
        ctx,
        "delete_goal",
        `Delete goal "${imp.title}"${t.removes.length ? `. Also removes: ${t.removes.join(", ")}` : ""}${t.keeps.length ? `. Keeps: ${t.keeps.join(", ")}` : ""}`,
        { goal_id: String(a["goal_id"]), token: imp.token, impact: t },
      );
    }
    case "delete_plan": {
      const d = await import("./deletion.server");
      const week = d.weekStartFor(a["week"] == null ? null : String(a["week"]), ctx.tz);
      const imp = await d.planImpact(ctx.admin, userId, week, ctx.tz);
      if (!imp.found) return { nothing_to_delete: true, week_start: week };
      const t = d.describeImpact(imp);
      return pend(
        ctx,
        "delete_plan",
        `Delete the plan for the week of ${week}${t.removes.length ? `. Removes: ${t.removes.join(", ")}` : ""}${t.keeps.length ? `. Keeps: ${t.keeps.join(", ")}` : ""}`,
        { week_start: week, token: imp.token, impact: t },
      );
    }
    case "update_goal": {
      const { data: g } = await db
        .from("goals")
        .select("*")
        .eq("id", String(a["goal_id"]))
        .maybeSingle();
      if (!g) return { error: "unknown_goal" };
      const patch: Record<string, unknown> = {};
      if (a["title"]) patch["title"] = str(a["title"], 120);
      if (a["why"]) patch["why"] = str(a["why"], 500);
      const sm = num(a["session_minutes"]);
      if (sm != null) patch["session_minutes"] = clampInt(sm, 10, 480);
      const spw = num(a["sessions_per_week"]);
      const wm = num(a["weekly_minutes"]);
      if (spw != null)
        patch["weekly_minutes"] = clampInt(
          clampInt(spw, 1, 21) * Number(patch["session_minutes"] ?? g.session_minutes),
          15,
          2400,
        );
      else if (wm != null) patch["weekly_minutes"] = clampInt(wm, 15, 2400);
      {
        const pd = weekdaysArg(a["days_of_week"]);
        if (pd) patch["preferred_days"] = pd;
        const st = hmArg(a["start_time"]);
        if (st) patch["preferred_start"] = st;
      }
      if (a["preferred_time"]) {
        const pt = String(a["preferred_time"]);
        if (!["morning", "midday", "evening", "any"].includes(pt))
          return { error: "preferred_time_must_be_morning_midday_evening_or_any" };
        patch["preferred_time"] = pt;
      }
      if (a["deadline"]) {
        if (!DAY_KEY.test(String(a["deadline"]))) return { error: "deadline_must_be_YYYY-MM-DD" };
        patch["deadline"] = String(a["deadline"]);
      }
      if (a["status"]) {
        const st = String(a["status"]);
        if (!["active", "paused", "completed"].includes(st))
          return { error: "status_must_be_active_paused_or_completed" };
        // The training programme's sessions reach the plan through one training goal; pausing it silently removes all training.
        if (
          st !== "active" &&
          g.domain === "training" &&
          g.status === "active" &&
          a["stop_training"] !== true
        ) {
          const [{ data: prog }, { data: others }] = await Promise.all([
            db.from("training_programmes").select("id").eq("status", "active").limit(1),
            db
              .from("goals")
              .select("id")
              .eq("domain", "training")
              .eq("status", "active")
              .neq("id", g.id)
              .limit(1),
          ]);
          if (prog?.length && !others?.length)
            return {
              error: "this_goal_holds_the_training_programme",
              hint: "This is the member's only active training goal and it carries their training programme: pausing it removes every training session. It is not a duplicate. Keep it active (change its days/time instead). Only pass stop_training true if they asked to stop training.",
            };
        }
        patch["status"] = st;
        if (st === "completed") patch["completed_at"] = new Date().toISOString();
      }
      if (!Object.keys(patch).length) return { error: "nothing_to_change" };
      const parts = Object.entries(patch)
        .filter(([k]) => k !== "completed_at")
        .map(([k, v]) => {
          if (k === "weekly_minutes") {
            const per = Number(patch["session_minutes"] ?? g.session_minutes);
            return `${Math.round(Number(v) / per)} × ${per} min a week (was ${Math.round(g.weekly_minutes / g.session_minutes)} × ${g.session_minutes})`;
          }
          return `${k.replace("_", " ")} → ${v}`;
        });
      return pend(ctx, "update_goal", `Change "${g.title}": ${parts.join("; ")}`, {
        goal_id: g.id,
        patch,
      });
    }
    case "add_milestone": {
      const { data: g } = await db
        .from("goals")
        .select("id")
        .eq("id", String(a["goal_id"]))
        .maybeSingle();
      if (!g) return { error: "unknown_goal" };
      const due =
        a["due_date"] && DAY_KEY.test(String(a["due_date"])) ? String(a["due_date"]) : null;
      const { data: last } = await db
        .from("goal_milestones")
        .select("position")
        .eq("goal_id", g.id)
        .order("position", { ascending: false })
        .limit(1);
      const title = str(a["title"], 160);
      const { data: dup } = await db
        .from("goal_milestones")
        .select("id")
        .eq("goal_id", g.id)
        .eq("title", title ?? "")
        .maybeSingle();
      if (dup) return { already_existed: true, milestone_id: dup.id };
      const { data, error } = await db
        .from("goal_milestones")
        .insert({
          user_id: userId,
          goal_id: g.id,
          title: title ?? "Milestone",
          due_date: due,
          position: (last?.[0]?.position ?? -1) + 1,
        })
        .select("id")
        .single();
      if (error) return { error: error.message };
      await audit(ctx, "coach.milestone_added", data.id, { goal_id: g.id });
      ctx.actions.push({
        kind: "link",
        label: "See goal",
        to: `/app/goals/${g.id}`,
        reason: "Milestone added.",
      });
      return { created: true, milestone_id: data.id };
    }
    case "update_milestone": {
      const { data: m } = await db
        .from("goal_milestones")
        .select("*")
        .eq("id", String(a["milestone_id"]))
        .maybeSingle();
      if (!m) return { error: "unknown_milestone" };
      const patch: Record<string, unknown> = {};
      if (a["title"]) patch["title"] = str(a["title"], 160);
      if (a["due_date"] && DAY_KEY.test(String(a["due_date"])))
        patch["due_date"] = String(a["due_date"]);
      if (a["done"] === true) patch["done_at"] = m.done_at ?? new Date().toISOString();
      if (a["done"] === false) patch["done_at"] = null;
      if (!Object.keys(patch).length) return { error: "nothing_to_change" };
      const { error } = await db
        .from("goal_milestones")
        .update(patch as never)
        .eq("id", m.id);
      if (error) return { error: error.message };
      await audit(ctx, "coach.milestone_updated", m.id, { patch });
      ctx.actions.push({
        kind: "link",
        label: "See goal",
        to: `/app/goals/${m.goal_id}`,
        reason: "Milestone updated.",
      });
      return { updated: true, ...patch };
    }
    case "add_reflection": {
      const { data: g } = await db
        .from("goals")
        .select("id")
        .eq("id", String(a["goal_id"]))
        .maybeSingle();
      if (!g) return { error: "unknown_goal" };
      const row = {
        went_well: str(a["went_well"], 1000),
        got_in_way: str(a["got_in_way"], 1000),
        change_next: str(a["change_next"], 1000),
      };
      if (!row.went_well && !row.got_in_way && !row.change_next)
        return { error: "empty_reflection" };
      const { data, error } = await db
        .from("goal_reflections")
        .insert({ user_id: userId, goal_id: g.id, ...row })
        .select("id")
        .single();
      if (error) return { error: error.message };
      await audit(ctx, "coach.reflection_added", data.id, { goal_id: g.id });
      return { saved: true, reflection_id: data.id };
    }
    case "record_progress": {
      const { data: g } = await db
        .from("goals")
        .select("id,target_metric,target_unit")
        .eq("id", String(a["goal_id"]))
        .maybeSingle();
      if (!g) return { error: "unknown_goal" };
      const v = num(a["value"]);
      if (v == null) return { error: "value_required" };
      const { data, error } = await db
        .from("goal_metric_entries")
        .insert({
          user_id: userId,
          goal_id: g.id,
          value: v,
          note: str(a["note"], 300),
          source: "coach",
        } as never)
        .select("id")
        .single();
      if (error) return { error: error.message };
      await db.from("goals").update({ current_value: v }).eq("id", g.id);
      await audit(ctx, "coach.progress_recorded", data.id, { goal_id: g.id, value: v });
      return { saved: true, value: v, unit: g.target_unit };
    }
    case "add_checkin": {
      const { readiness } = await import("./wellbeing");
      const { RECOVERY_RULES_VERSION } = await import("./recovery-state");
      const sc = (k: string) => clampInt(num(a[k]) ?? 3, 1, 5);
      const f = {
        sleep_quality: sc("sleep_quality"),
        energy: sc("energy"),
        soreness: sc("soreness"),
        stress: sc("stress"),
      };
      const ill = a["ill_or_injured"] === true;
      const { error } = await db.from("recovery_checkins").upsert(
        {
          user_id: userId,
          check_date: today,
          ...f,
          ill_or_injured: ill,
          note: str(a["note"], 500),
          readiness: readiness(f.sleep_quality, f.soreness, f.stress, f.energy),
          recovery_version: RECOVERY_RULES_VERSION,
        },
        { onConflict: "user_id,check_date" },
      );
      if (error) return { error: error.message };
      if (ill || /pain|injur/i.test(String(a["note"] ?? "")))
        await (await import("./safety.server")).recordSafety(userId, "training", "input", ["pain"]);
      await audit(ctx, "coach.checkin_saved", today, f);
      ctx.actions.push({
        kind: "link",
        label: "See recovery",
        to: "/app/recovery",
        reason: "Today's check-in saved.",
      });
      return {
        saved: true,
        day: today,
        readiness: readiness(f.sleep_quality, f.soreness, f.stress, f.energy),
      };
    }
    case "add_daily_log": {
      const kind = String(a["kind"]);
      const v = num(a["value"]);
      if (!["weight", "sleep", "energy"].includes(kind) || v == null)
        return { error: "kind_and_value_required" };
      if (kind === "energy" && (v < 1 || v > 10)) return { error: "energy_is_1_to_10" };
      const { data, error } = await db
        .from("daily_logs")
        .insert({ user_id: userId, kind, value: v, note: str(a["note"], 300), log_date: today })
        .select("id")
        .single();
      if (error) return { error: error.message };
      await audit(ctx, "coach.daily_log_added", data.id, { kind });
      return { saved: true, kind, value: v, day: today };
    }
    case "update_availability": {
      const patch: Record<string, unknown> = {};
      for (const k of ["wake_time", "sleep_time", "work_start", "work_end"]) {
        if (a[k] == null) continue;
        const v = hmOk(a[k]);
        if (!v) return { error: `${k}_must_be_HH:MM` };
        patch[k] = v;
      }
      if (Array.isArray(a["work_days"])) {
        const d = [
          ...new Set(
            (a["work_days"] as unknown[])
              .map(Number)
              .filter((x) => Number.isInteger(x) && x >= 0 && x <= 6),
          ),
        ].sort();
        patch["work_days"] = d;
      }
      if (!Object.keys(patch).length) return { error: "nothing_to_change" };
      return pend(
        ctx,
        "update_availability",
        `Change your availability: ${Object.entries(patch)
          .map(([k, v]) => `${k.replace("_", " ")} ${Array.isArray(v) ? v.join(",") : v}`)
          .join("; ")}`,
        { patch },
      );
    }
    case "log_movement": {
      const { logMovement } = await import("./movement.functions");
      const r = await logMovement({
        data: {
          kind: "cardio",
          modality: String(a["modality"]) as never,
          intensity: "easy" as never,
          prescribedMinutes: null,
          minutes: clampInt(num(a["minutes"]) ?? 20, 1, 600),
          rpe: clampInt(num(a["rpe"]) ?? 5, 1, 10),
          completed: a["completed"] !== false,
          pain: a["pain"] === true,
          note: str(a["note"], 500),
        } as never,
      });
      ctx.actions.push({
        kind: "link",
        label: "See cardio",
        to: "/app/training?section=cardio",
        reason: "Logged under Training.",
      });
      const { effortFeedback } = await import("./training");
      const effort = effortFeedback(`${str(a["note"], 500) ?? ""} ${ctx.memberText ?? ""}`);
      const progression = effort
        ? await (
            await import("./training-adapt.server")
          )
            .applyEffortFeedback(ctx.userId, effort, null)
            .catch((e) => ({ status: "FAILED", error: String(e?.message ?? e) }))
        : null;
      return { logged: true, result: r, progression };
    }
    case "log_wellness": {
      const { logWellness } = await import("./wellness.functions");
      const m = clampInt(num(a["minutes"]) ?? 10, 1, 90);
      const SYN: Record<string, string> = {
        breathing: "breath",
        breathwork: "breath",
        meditation: "mindfulness",
        meditate: "mindfulness",
        sleep: "wind_down",
        sleep_wind_down: "wind_down",
        bodyscan: "body_scan",
      };
      const raw = String(a["type"] ?? "")
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
      const type = raw in SESSION_TYPES ? raw : (SYN[raw] ?? raw);
      if (!(type in SESSION_TYPES))
        return { error: "unknown_session_type", allowed: Object.keys(SESSION_TYPES) };
      const r = await logWellness({
        data: {
          type: type as never,
          plannedMinutes: m,
          actualMinutes: m,
          state: "completed",
          calmBefore: null,
          calmAfter: null,
          useful: null,
          note: str(a["note"], 500),
          blockId: null,
        },
      });
      ctx.actions.push({
        kind: "link",
        label: "See wellness",
        to: "/app/wellness",
        reason: "Logged.",
      });
      return { logged: true, result: r };
    }
    case "find_guided_videos": {
      const gv = await import("./guided-video");
      const activity = a["activity"] === "yoga" ? "yoga" : "meditation";
      const raw = String(a["focus"] ?? "")
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
      const focus = gv.focusOf(activity, raw)
        ? raw
        : gv.parseWellnessIntent(`${activity} ${a["focus"] ?? ""}`).focus;
      const minutes = gv.snapMinutes(activity, num(a["minutes"]) ?? 10);
      const { findGuidedVideos } = await import("./guided-video.server");
      const r = await findGuidedVideos(ctx.admin, userId, { activity, focus, minutes });
      ctx.actions.push({
        kind: "link",
        label: `Open ${activity} choices`,
        to: `/app/wellness?section=${activity}&activity=${activity}&focus=${focus}&minutes=${minutes}`,
        reason: "Same choices, ready to follow and mark complete.",
      });
      return {
        activity,
        focus,
        minutes,
        videos: r.choices.map((c) => ({
          title: c.title,
          creator: c.creator,
          minutes: Math.round(c.seconds / 60),
          url: c.url,
          why: c.why,
        })),
        safety_note: activity === "yoga" ? gv.YOGA_SAFETY : gv.MEDITATION_SAFETY,
      };
    }
    case "add_wellness_practice": {
      const gv = await import("./guided-video");
      const activity = a["activity"] === "yoga" ? "yoga" : "meditation";
      const raw = String(a["focus"] ?? "")
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
      const time = ["morning", "midday", "evening", "any"].includes(String(a["preferred_time"]))
        ? String(a["preferred_time"])
        : "any";
      const focus = gv.focusOf(activity, raw)
        ? raw
        : time === "morning" || time === "evening"
          ? time
          : activity === "yoga"
            ? "wellbeing"
            : "relaxation";
      const minutes = gv.snapMinutes(activity, num(a["minutes"]) ?? 10);
      const perWeek = clampInt(num(a["per_week"]) ?? 7, 1, 14);
      const label = gv.focusOf(activity, focus)!.label;
      return pend(
        ctx,
        "add_wellness_practice",
        `Add ${minutes}-minute ${activity} (${label}) ${perWeek}× a week, ${time === "any" ? "any time" : time}`,
        { activity, focus, minutes, perWeek, time },
      );
    }
    case "set_wellness_preferences": {
      const { data: cur } = await db
        .from("wellness_preferences")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      const base = (cur ?? {}) as Record<string, unknown>;
      const next = {
        enabled: a["enabled"] == null ? (base["enabled"] ?? true) : a["enabled"] === true,
        session_types: (base["session_types"] as string[] | undefined)?.length
          ? base["session_types"]
          : ["mindfulness", "breath", "body_scan"],
        experience: base["experience"] ?? "beginner",
        min_minutes: num(a["min_minutes"]) ?? base["min_minutes"] ?? 5,
        max_minutes: num(a["max_minutes"]) ?? base["max_minutes"] ?? 15,
        preferred_time: a["preferred_time"] ?? base["preferred_time"] ?? "any",
        guidance: base["guidance"] ?? "text",
        sessions_per_week: num(a["sessions_per_week"]) ?? base["sessions_per_week"] ?? 3,
        reminders: base["reminders"] ?? true,
        allow_auto_move: base["allow_auto_move"] ?? false,
      };
      return pend(
        ctx,
        "set_wellness_preferences",
        `Wellness plan: ${next.sessions_per_week} sessions a week, ${next.min_minutes}–${next.max_minutes} min, ${next.preferred_time}`,
        { prefs: next },
      );
    }
    case "get_nutrition_status":
    case "get_meal_prep":
    case "add_food_inventory":
    case "update_food_inventory":
    case "plan_meal_prep":
    case "edit_meal_prep":
    case "accept_meal_prep":
    case "log_planned_meal":
    case "set_meal_preferences":
      return mealPrepTool(ctx, tool, a);
    case "propose_meal_plan": {
      // No saved meals to plan from: use the meal engine (everyday staples) instead of an empty proposal.
      const { count: savedMeals } = await ctx.db
        .from("saved_meals")
        .select("id", { count: "exact", head: true })
        .eq("user_id", ctx.userId);
      if (!savedMeals) return mealPrepTool(ctx, "plan_meal_prep", { exclusions: a["exclusions"] });
      const { generateMealPlan } = await import("./meal-plan.functions");
      const r = await generateMealPlan({
        data: {
          household: clampInt(num(a["household"]) ?? 1, 1, 12),
          prepMinutes: clampInt(num(a["prep_minutes"]) ?? 60, 0, 600),
          exclusions: Array.isArray(a["exclusions"])
            ? (a["exclusions"] as unknown[]).map((x) => String(x).slice(0, 40)).slice(0, 20)
            : [],
          nextWeek: a["next_week"] === true,
        },
      });
      ctx.actions.push({
        kind: "link",
        label: "Review meal plan",
        to: "/app/nutrition",
        reason: "Approve it on the Nutrition page.",
      });
      return { proposed: true, result: r };
    }
    case "add_learning_item": {
      const { addRetrievalItem } = await import("./learning.functions");
      const r = await addRetrievalItem({
        data: {
          goalId: String(a["goal_id"]),
          topicId: null,
          prompt: String(a["prompt"] ?? "").slice(0, 1000),
          answer: String(a["answer"] ?? "").slice(0, 2000),
        },
      });
      return { saved: true, result: r };
    }
    case "get_research_findings": {
      let r = db
        .from("career_research")
        .select("id,goal_id,query,jurisdiction,status,created_at,interpretation")
        .order("created_at", { ascending: false })
        .limit(10);
      if (a["goal_id"]) r = r.eq("goal_id", String(a["goal_id"]));
      if (a["research_id"]) r = r.eq("id", String(a["research_id"]));
      const { data: research, error: researchError } = await r;
      if (researchError)
        return { error: "Saved research could not be read. This is not an empty search result." };
      const ids = (research ?? []).map((x) => x.id);
      const [{ data: f, error: findingError }, { data: src, error: sourceError }] = ids.length
        ? await Promise.all([
            db.from("research_findings").select("*").in("research_id", ids).limit(60),
            db.from("research_sources").select("*").in("research_id", ids).limit(60),
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
          ];
      if (findingError || sourceError)
        return { error: "Saved research sources could not be read." };
      const byId = new Map((src ?? []).map((x) => [x.id, x]));
      return {
        research: (research ?? []).map((x) => ({
          ...x,
          interpretation: x.interpretation?.slice(0, 4500),
        })),
        sources: (src ?? []).map((x) => ({
          research_id: x.research_id,
          url: x.url,
          title: x.title,
          publisher: x.publisher,
          trust: x.trust,
          excerpt: x.content_excerpt?.slice(0, 150),
          verification: "discovered_source; only quoted findings below are verified facts",
        })),
        findings: (f ?? []).map((x) => {
          const so = byId.get(x.source_id);
          return {
            research_id: x.research_id,
            category: x.category,
            statement: x.statement,
            quote: x.quote.slice(0, 150),
            source_url: so?.url ?? null,
            source_title: so?.title ?? null,
            publisher: so?.publisher ?? null,
            trust: so?.trust ?? null,
            retrieved_at: so?.retrieved_at ?? null,
          };
        }),
      };
    }
    case "log_food": {
      const slotT = ["breakfast", "lunch", "dinner", "snack"].includes(String(a["meal_slot"]))
        ? String(a["meal_slot"])
        : "snack";
      const eaten = String(a["eaten_text"] ?? "")
        .trim()
        .slice(0, 500);
      if (!a["food_id"] && eaten.length >= 2) {
        const { parseFoodTextCore } = await import("./nutrition.functions");
        let drafts: Awaited<ReturnType<typeof parseFoodTextCore>> = [];
        try {
          drafts = await parseFoodTextCore(eaten, ctx.userId);
        } catch (e) {
          return {
            error: "food_lookup_failed",
            detail: e instanceof Error ? e.message : String(e),
            note: "Say the food could not be looked up right now; nothing was logged.",
          };
        }
        // Best match, not first hit: "scrambled eggs" must not become "egg white", "toast" not "egg bread".
        const pick = (q: string, opts: { name: string }[]) => {
          const qw = q
            .toLowerCase()
            .split(/[^a-z]+/)
            .filter((w) => w.length > 2)
            .map((w) => w.replace(/(es|s)$/, ""));
          const score = (n: string) => {
            const nl = n.toLowerCase();
            let sc = qw.filter((w) => nl.includes(w)).length * 3;
            for (const bad of ["white", "yolk", "overripe", "dried", "powder", "baby", "raw"])
              if (nl.includes(bad) && !q.toLowerCase().includes(bad)) sc -= 2;
            return sc - nl.length / 200;
          };
          return [...opts].sort((x, y) => score(y.name) - score(x.name))[0];
        };
        const items = drafts
          .filter((d) => d.options[0] && d.grams_estimate > 0)
          .map((d) => ({
            food: pick(d.query, d.options as { name: string }[]),
            grams: clampInt(d.grams_estimate, 1, 5000),
            query: d.query,
          }));
        const missing = drafts.filter((d) => !d.options[0]).map((d) => d.query);
        if (!items.length)
          return {
            error: "no_food_match",
            unmatched: missing,
            note: "Nothing logged. Ask the member to name the foods differently.",
          };
        const kcal = Math.round(
          items.reduce(
            (t, i) =>
              t + ((Number((i.food as { kcal_100g?: number }).kcal_100g) || 0) * i.grams) / 100,
            0,
          ),
        );
        return {
          ...((await pend(
            ctx,
            "log_food",
            `Log ${slotT}: ${items.map((i) => `${i.grams} g ${(i.food as { name: string }).name}`).join(", ")} (~${kcal} kcal)`,
            { items, meal_slot: slotT, date: today, text: eaten },
          )) as object),
          estimated_kcal: kcal,
          items: items.map((i) => ({ name: (i.food as { name: string }).name, grams: i.grams })),
          unmatched: missing,
          note: "Amounts are estimates from the description.",
        };
      }
      const { data: food } = await db
        .from("user_foods")
        .select("*")
        .eq("id", String(a["food_id"]))
        .maybeSingle();
      if (!food) return { error: "unknown_food", hint: "Use an id from search_food." };
      const grams = clampInt(num(a["grams"]) ?? 0, 1, 5000);
      const slot = ["breakfast", "lunch", "dinner", "snack"].includes(String(a["meal_slot"]))
        ? String(a["meal_slot"])
        : "snack";
      return pend(ctx, "log_food", `Log ${grams} g of ${food.name} for ${slot}`, {
        food_id: food.id,
        grams,
        meal_slot: slot,
        date: today,
      });
    }
    case "get_meal_estimate":
    case "correct_meal_estimate":
    case "log_meal_estimate": {
      const mp = await import("./meal-photo.server");
      const { describeEstimate, fmtRange } = await import("./meal-photo");
      const mctx = { supabase: ctx.db, userId };
      try {
        const id = a["estimate_id"] ? String(a["estimate_id"]) : null;
        const cur = id
          ? (
              await ctx.admin
                .from("meal_photo_estimates")
                .select("id,status,estimate,corrections")
                .eq("id", id)
                .eq("user_id", userId)
                .maybeSingle()
            ).data
          : null;
        if (tool === "get_meal_estimate") {
          const v = id
            ? cur
              ? { id: cur.id, status: cur.status, estimate: cur.estimate }
              : null
            : await mp.latestMealEstimate(mctx);
          if (!v)
            return { error: "no_meal_estimate", hint: "Ask the member to attach a meal photo." };
          const { normaliseEstimate } = await import("./meal-photo");
          return {
            estimate_id: v.id,
            status: v.status,
            description: describeEstimate(normaliseEstimate(v.estimate)),
          };
        }
        if (!id || !cur) return { error: "unknown_estimate", hint: "Use get_meal_estimate first." };
        if (tool === "correct_meal_estimate") {
          const v = await mp.correctMealEstimate(mctx, id, String(a["correction"] ?? ""));
          return {
            estimate_id: v.id,
            status: v.status,
            description: describeEstimate(v.estimate),
            note: (v as { note?: string }).note ?? null,
          };
        }
        if (cur.status === "logged")
          return {
            already_logged: true,
            message: "This meal is already in the food log; nothing new was added.",
          };
        if (cur.status === "cancelled") return { error: "estimate_cancelled" };
        const slot = ["breakfast", "lunch", "dinner", "snack"].includes(String(a["meal_slot"]))
          ? String(a["meal_slot"])
          : "snack";
        const { mealTotals, normaliseEstimate } = await import("./meal-photo");
        const t = mealTotals(normaliseEstimate(cur.estimate));
        let planRef: Record<string, unknown> = {};
        if (a["planned_slot"]) {
          const pl = await (
            await import("./meal-prep.server")
          ).currentPlan({ supabase: ctx.db, userId }, today);
          const pm =
            pl?.status === "approved"
              ? pl.plan.days
                  .find((x) => x.date === today)
                  ?.meals.find((x) => x.slot === a["planned_slot"])
              : null;
          if (pm && pm.state === "eaten") return { already_logged: true, meal: pm.name };
          if (pm) planRef = { plan_id: pl!.id, planned_slot: pm.slot };
        }
        return pend(
          ctx,
          "log_meal_estimate",
          `Log photo meal for ${slot}: ${fmtRange(t.kcal, " kcal")} (estimate)${planRef["plan_id"] ? " instead of the planned meal" : ""}`,
          { estimate_id: id, meal_slot: slot, date: today, ...planRef },
        );
      } catch (e) {
        return { error: (e as Error).message };
      }
    }
    case "explain_exercise": {
      const T = await import("./training");
      const D = await import("./exercise-demo");
      const { data: prog } = await db
        .from("training_programmes")
        .select("id,days_per_week,equipment")
        .eq("status", "active")
        .order("version", { ascending: false })
        .limit(1);
      const p = prog?.[0];
      let workout: {
        exercise_key: string;
        name: string;
        sets: number;
        rep_min: number;
        rep_max: number;
        rest_sec: number;
        load_kg: number | null;
      }[] = [];
      let which = "none";
      if (p) {
        const { data: ses } = await db
          .from("workout_sessions")
          .select("day_index,status,started_at")
          .eq("user_id", userId)
          .order("started_at", { ascending: false })
          .limit(20);
        const live = (ses ?? []).find((x: { status: string }) => x.status === "in_progress");
        const day = live
          ? live.day_index
          : T.nextTrainingDay((ses ?? []) as never, p.days_per_week, new Date()).dayIndex;
        which = live ? "current workout in progress" : "next workout";
        const { data: rx } = await db
          .from("programme_prescriptions")
          .select("exercise_key,sets,rep_min,rep_max,rest_sec,load_kg,order_index")
          .eq("programme_id", p.id)
          .eq("day_index", day ?? 0)
          .order("order_index");
        workout = (rx ?? []).map((r: { exercise_key: string }) => ({
          ...r,
          name: T.EX[r.exercise_key]?.name ?? r.exercise_key,
        })) as never;
      }
      const key = D.resolveExerciseRef(String(a["exercise"] ?? ""), workout, T.EXERCISES);
      if (!key)
        return {
          error: "exercise_not_found",
          workout: workout.map((w, i) => `${i + 1}. ${w.name}`),
          hint: "Ask which exercise they mean.",
        };
      const ex = T.EX[key]!;
      const rx = workout.find((w) => w.exercise_key === key);
      let demo = null;
      try {
        const { findExerciseDemo } = await import("./exercise-demo.server");
        const d = (await findExerciseDemo(ctx.admin, userId, key)).demo;
        demo = d
          ? {
              title: d.title,
              creator: d.creator,
              minutes: d.seconds ? Math.max(1, Math.round(d.seconds / 60)) : null,
              url: d.url,
            }
          : null;
      } catch (e) {
        demo = { unavailable: (e as Error).message };
      }
      ctx.actions.push({
        kind: "link",
        label: "Open Training",
        to: "/app/training",
        reason: "Your workout with the demonstration button on each exercise.",
      });
      return {
        exercise: ex.name,
        from: rx ? which : "exercise library",
        position: rx ? workout.indexOf(rx) + 1 : null,
        prescription: rx
          ? `${rx.sets} sets x ${rx.rep_min}-${rx.rep_max}${key === "plank" ? " seconds" : " reps"}, rest ${rx.rest_sec}s`
          : null,
        targets: ex.primary_muscles,
        setup: ex.setup_steps,
        cues: ex.execution_cues,
        common_errors: ex.common_errors,
        easier_options: ex.regressions.map((k) => T.EX[k]?.name ?? k),
        demonstration: demo,
        safety_note: `${D.DEMO_SAFETY} If they report pain, injury, surgery or dizziness, do not tell them to continue; suggest stopping and a professional.`,
      };
    }
    case "build_workout": {
      const T = await import("./training");
      const { data: prog } = await db
        .from("training_programmes")
        .select("*")
        .eq("status", "active")
        .order("version", { ascending: false })
        .limit(1);
      const p = (prog?.[0] ?? {}) as Record<string, unknown>;
      const focus = ["upper", "lower", "full"].includes(String(a["focus"]))
        ? (a["focus"] as "upper")
        : "full";
      // Never plan with kit the member hasn't mentioned (or set in their programme).
      const { allowedEquipment } = await import("./equipment");
      const history = await memberHistory(ctx);
      const asked = ["gym", "home", "bodyweight"].includes(String(a["equipment"]))
        ? String(a["equipment"])
        : ((p["equipment"] as string) ?? null);
      const equipment = allowedEquipment(
        asked,
        history,
        (p["equipment"] as string) ?? null,
      ) as never;
      const downgraded = asked != null && asked !== equipment;
      const minutes = clampInt(num(a["minutes"]) ?? Number(p["session_minutes"] ?? 30), 15, 120);
      const STYLE: Record<string, string> = {
        strength: "strength",
        muscle: "hypertrophy",
        general: "general",
        conditioning: "conditioning",
      };
      const style = STYLE[String(a["style"])];
      const rx = T.buildSession(
        {
          goal: (style ?? p["goal"] ?? "general") as never,
          experience: (p["experience"] ?? "novice") as never,
          equipment,
          sessionMinutes: minutes,
          limitations: (p["limitations"] as string[] | undefined) ?? [],
        },
        focus,
      );
      return {
        built_by: "Plexecute training engine",
        focus,
        minutes,
        equipment,
        exercises: rx.map((r, i) => ({
          n: i + 1,
          name: T.EX[r.exercise_key]!.name,
          sets: r.sets,
          reps: `${r.rep_min}-${r.rep_max}`,
          rest_sec: r.rest_sec,
          cue: T.EX[r.exercise_key]!.execution_cues[0],
        })),
        note: "Each exercise has an optional demonstration via explain_exercise; the workout is complete without watching.",
        ...(downgraded
          ? {
              equipment_rule: `The member has not said they have ${asked} equipment, so this uses ${equipment} only. Do not mention dumbbells or other kit; ask if they have any if it matters.`,
            }
          : {}),
        section: "Training",
      };
    }
    case "get_cardio_session":
    case "get_mobility_session": {
      const { getMovementPlan } = await import("./movement.functions");
      const isCardio = tool === "get_cardio_session";
      const region = ["hips", "hamstrings", "spine", "shoulders", "ankles", "full_body"].includes(
        String(a["region"]),
      )
        ? String(a["region"])
        : "full_body";
      const intensity = ["easy", "moderate", "vigorous"].includes(String(a["intensity"]))
        ? String(a["intensity"])
        : "moderate";
      const mp = await getMovementPlan({
        data: {
          intensity,
          region,
          minutes: clampInt(num(a["minutes"]) ?? 10, 5, 60),
          restrictions: [],
          goal: "health",
          experience: "some",
          intent: a["intent"] === "flexibility" ? "flexibility" : "mobility",
          pace: "steady",
          equipment: ["wall"],
        } as never,
      });
      if (isCardio) {
        ctx.actions.push({
          kind: "link",
          label: "Open cardio",
          to: "/app/training?section=cardio",
          reason: "Training > Cardio, with technique videos.",
        });
        return {
          section: "Training > Cardio",
          modality: a["modality"] ?? "running",
          minutes: mp.cardio.minutes,
          effort_rpe: mp.cardio.rpe,
          talk_test: mp.cardio.talk,
          why: mp.cardio.reason,
          recovery_note: mp.cardio.recoveryNote,
          weekly_active_minutes: { done: mp.weekly.done, target: mp.weekly.target },
        };
      }
      const sec = a["intent"] === "flexibility" ? "recovery" : "mobility";
      ctx.actions.push({
        kind: "link",
        label: sec === "recovery" ? "Open recovery" : "Open mobility",
        to: `/app/wellness?section=${sec}`,
        reason: "Wellness & Movement, with demonstration and follow-along videos.",
      });
      return {
        section: `Wellness & Movement > ${sec === "recovery" ? "Recovery" : "Mobility"}`,
        minutes: mp.mobility.estimatedMinutes,
        steps: mp.mobility.steps.map(
          (x: { name: string; amount: string; cue: string }) => `${x.name} (${x.amount}): ${x.cue}`,
        ),
        note: "Never force a stretch through pain.",
      };
    }
    case "get_training_programme": {
      const { data: prog } = await db
        .from("training_programmes")
        .select("id,goal,experience,equipment,days_per_week,session_minutes,version")
        .eq("status", "active")
        .order("version", { ascending: false })
        .limit(1);
      const p = prog?.[0];
      if (!p)
        return {
          programme: null,
          hint: "No active programme; change_training_programme can create one.",
        };
      const { data: rx } = await db
        .from("programme_prescriptions")
        .select("id,day_index,order_index,exercise_key,sets,rep_min,rep_max,load_kg,rir_target")
        .eq("programme_id", p.id)
        .order("day_index")
        .order("order_index");
      const { substitutes, EX } = await import("./training");
      return {
        programme: p,
        exercises: (rx ?? []).map((r) => ({
          ...r,
          name: EX[r.exercise_key]?.name ?? r.exercise_key,
          allowed_swaps: substitutes(r.exercise_key, p.equipment as never).map((e) => ({
            key: e.key,
            name: e.name,
          })),
        })),
      };
    }
    case "substitute_exercise": {
      const { substituteExercise } = await import("./training.functions");
      try {
        await substituteExercise({
          data: {
            prescriptionId: String(a["prescription_id"]),
            exerciseKey: String(a["exercise_key"]),
          },
        });
      } catch (e) {
        return {
          error: (e as Error).message,
          hint: "Use a key from allowed_swaps in get_training_programme.",
        };
      }
      await audit(ctx, "coach.exercise_substituted", String(a["prescription_id"]), {
        exercise_key: a["exercise_key"],
      });
      ctx.actions.push({
        kind: "link",
        label: "See training",
        to: "/app/training",
        reason: "Exercise swapped.",
      });
      return { swapped: true };
    }
    case "change_training_programme": {
      const pDays = weekdaysArg(a["days_of_week"]);
      const pStart = hmArg(a["start_time"]);
      const GOALS = ["strength", "hypertrophy", "general", "conditioning", "mixed"];
      const LIMS = ["knee_pain", "back_pain", "shoulder_pain", "wrist_pain"];
      const programme = {
        goal: GOALS.includes(String(a["goal"])) ? String(a["goal"]) : "general",
        experience: a["experience"] === "intermediate" ? "intermediate" : "novice",
        equipment: ["gym", "home", "bodyweight"].includes(String(a["equipment"]))
          ? String(a["equipment"])
          : "gym",
        days: clampInt(num(a["days"]) ?? 3, 2, 6),
        sessionMinutes: clampInt(num(a["session_minutes"]) ?? 45, 20, 120),
        limitations: ((a["limitations"] as unknown[]) ?? [])
          .map(String)
          .filter((l) => LIMS.includes(l))
          .slice(0, 4),
        ...(["morning", "midday", "evening", "any"].includes(String(a["preferred_time"]))
          ? { preferredTime: String(a["preferred_time"]) }
          : {}),
        ...(pDays ? { preferredDays: pDays } : {}),
        ...(pStart
          ? {
              preferredStart: pStart,
              ...(a["preferred_time"]
                ? {}
                : {
                    preferredTime:
                      Number(pStart.slice(0, 2)) < 12
                        ? "morning"
                        : Number(pStart.slice(0, 2)) < 17
                          ? "midday"
                          : "evening",
                  }),
            }
          : {}),
      };
      if (pDays) programme.days = clampInt(Math.min(pDays.length, 6), 2, 6);
      // Only the exercises changed: keep the member's existing days and start time.
      if (!pDays || !pStart) {
        const { data: tg } = await db
          .from("goals")
          .select("preferred_days,preferred_start,preferred_time")
          .eq("domain", "training")
          .eq("status", "active")
          .order("created_at")
          .limit(1)
          .maybeSingle();
        const keep = programme as Record<string, unknown>;
        if (!pDays && tg?.preferred_days?.length) {
          keep["preferredDays"] = tg.preferred_days;
          programme.days = clampInt(Math.min(tg.preferred_days.length, 6), 2, 6);
        }
        if (!pStart && tg?.preferred_start)
          keep["preferredStart"] = String(tg.preferred_start).slice(0, 5);
        if (!a["preferred_time"] && !pStart && tg?.preferred_time)
          keep["preferredTime"] = tg.preferred_time;
      }
      let unknownExercises: string[] = [];
      if (Array.isArray(a["exercises"]) && a["exercises"].length) {
        const { resolveExercises } = await import("./training");
        const r = resolveExercises(
          (a["exercises"] as unknown[]).map(String),
          programme.equipment as never,
        );
        unknownExercises = r.unknown;
        if (r.keys.length) (programme as Record<string, unknown>)["exercises"] = r.keys;
      }
      const res = (await pend(
        ctx,
        "change_training_programme",
        `New training programme: ${programme.goal}, ${programme.days} days a week, ${programme.sessionMinutes} min, ${programme.equipment}${(programme as { exercises?: string[] }).exercises ? `, exercises: ${(programme as { exercises?: string[] }).exercises!.join(", ")}` : ""}. Replaces the current one.`,
        { programme },
      )) as Record<string, unknown>;
      return {
        ...res,
        ...((programme as { exercises?: string[] }).exercises
          ? { exercises_in_every_session: (programme as { exercises?: string[] }).exercises }
          : {}),
        ...(unknownExercises.length ? { not_in_exercise_library: unknownExercises } : {}),
      };
    }
    case "log_mobility": {
      const { logMovement } = await import("./movement.functions");
      const REG = ["hips", "hamstrings", "spine", "shoulders", "ankles", "full_body"];
      const RES = ["knee", "back", "shoulder", "wrist"];
      const r = await logMovement({
        data: {
          kind: "mobility",
          region: (REG.includes(String(a["region"])) ? String(a["region"]) : "full_body") as never,
          minutes: clampInt(num(a["minutes"]) ?? 10, 1, 180),
          restrictions: ((a["restrictions"] as unknown[]) ?? [])
            .map(String)
            .filter((x) => RES.includes(x))
            .slice(0, 4) as never,
          tolerance: (["easy", "right", "hard"].includes(String(a["tolerance"]))
            ? String(a["tolerance"])
            : "right") as never,
          completed: a["completed"] !== false,
          pain: a["pain"] === true,
          note: str(a["note"], 500),
        },
      });
      ctx.actions.push({
        kind: "link",
        label: "See mobility",
        to: "/app/wellness?section=mobility",
        reason: "Logged under Wellness & Movement.",
      });
      return { logged: true, result: r };
    }
    case "get_routines": {
      const [{ data: prof }, { data: commits }, { data: wellness }, { data: habits }] =
        await Promise.all([
          db
            .from("profiles")
            .select("wake_time,sleep_time,work_start,work_end,work_days")
            .eq("id", userId)
            .maybeSingle(),
          db
            .from("commitments")
            .select("id,title,kind,recurrence,days,start_time,end_time")
            .eq("recurrence", "weekly")
            .eq("active", true),
          db
            .from("wellness_preferences")
            .select("enabled,sessions_per_week,preferred_time,min_minutes,max_minutes")
            .eq("user_id", userId)
            .maybeSingle(),
          db
            .from("goals")
            .select("id,title,sessions_per_week,status")
            .eq("status", "active")
            .not("sessions_per_week", "is", null),
        ]);
      return {
        daily_routine: prof,
        weekly_commitments: commits ?? [],
        meditation_routine: wellness,
        habit_goals: habits ?? [],
        how_to_change:
          "Wake/sleep/work routine: update_availability. Weekly commitments: update_commitment or schedule_commitment. Meditation: set_wellness_preferences. Habit frequency: update_goal sessions_per_week.",
      };
    }
    case "get_connected_devices": {
      // health_connections stays on COACH_DENIED_TABLES (it holds per-connection secrets), so phone-health
      // connections are not listed here; the member manages those on the Devices page.
      const { data } = await db
        .from("wearable_connections")
        .select("id,provider,status,last_sync_at,last_error")
        .in("status", ["active", "degraded", "revoked"]);
      return {
        wearables: data ?? [],
        note: "Phone-health connections are managed on the Devices page. New connections need the member to sign in to the provider there.",
      };
    }
    case "sync_connected_device": {
      const { syncWearableNow } = await import("./wearables.functions");
      try {
        const r = await syncWearableNow({ data: { id: String(a["connection_id"]) } });
        await audit(ctx, "coach.device_synced", String(a["connection_id"]), { status: r.status });
        return { synced: true, status: r.status };
      } catch (e) {
        return { error: (e as Error).message };
      }
    }
    case "disconnect_connected_device": {
      const { data: c } = await db
        .from("wearable_connections")
        .select("id,provider")
        .eq("id", String(a["connection_id"]))
        .maybeSingle();
      if (!c) return { error: "unknown_connection", hint: "Use an id from get_connected_devices." };
      const del = a["delete_data"] === true;
      return pend(
        ctx,
        "disconnect_device",
        `Disconnect ${c.provider}${del ? " and delete its imported data" : ""}`,
        { connection_id: c.id, delete_data: del },
      );
    }
  }
  return { error: "unknown_tool" };
}

async function moveCallsWithCommitment(
  ctx: ActionCtx,
  before: { id: string; on_date: string | null; start_time: string },
  patch: Record<string, unknown>,
) {
  if (!patch["start_time"] && !patch["on_date"]) return [];
  const out: unknown[] = [];
  const { toMin } = await import("./scheduler");
  const { data: calls } = await ctx.admin
    .from("scheduled_calls")
    .select("*")
    .eq("user_id", ctx.userId)
    .eq("commitment_id", before.id)
    .eq("status", "scheduled");
  const oldStart = zonedInstant(
    before.on_date ?? localDayKey(new Date(), ctx.tz),
    toMin(before.start_time) ?? 0,
    ctx.tz,
  ).getTime();
  const day = String(patch["on_date"] ?? before.on_date);
  const newStart = zonedInstant(
    day,
    toMin(String(patch["start_time"] ?? before.start_time)) ?? 0,
    ctx.tz,
  ).getTime();
  for (const c of calls ?? []) {
    const lead = oldStart - new Date(c.call_at).getTime();
    const at = new Date(newStart - lead);
    if (at.getTime() > Date.now()) {
      const r = await rebookCall(ctx, c, at, "coach.call_moved_with_commitment");
      out.push({ ...r, new_local_time: localHmOf(at, ctx.tz) });
    }
  }
  return out;
}
const localHmOf = (d: Date, tz: string | null) => {
  const m = zonedParts(d, tz).minutes;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

async function rebookCall(
  ctx: ActionCtx,
  call: Database["public"]["Tables"]["scheduled_calls"]["Row"],
  at: Date,
  action: string,
) {
  const key = `${call.dedupe_key.split(":call:")[0]}:call:${at.toISOString()}`;
  const { data: cancelled } = await ctx.admin
    .from("scheduled_calls")
    .update({ status: "cancelled", status_reason: "rescheduled" })
    .eq("id", call.id)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (!cancelled) return { error: "call_already_processed" };
  const { data: fresh } = await ctx.admin
    .from("scheduled_calls")
    .upsert(
      {
        user_id: ctx.userId,
        commitment_id: call.commitment_id,
        call_at: at.toISOString(),
        purpose: call.purpose,
        source: "coach",
        source_ref: ctx.messageId ?? null,
        dedupe_key: key,
        status: "scheduled",
        status_reason: null,
      },
      { onConflict: "user_id,dedupe_key" },
    )
    .select("id,call_at")
    .single();
  await audit(ctx, action, fresh?.id ?? call.id, {
    from: call.call_at,
    to: at.toISOString(),
    replaced: call.id,
  });
  return {
    rescheduled: true,
    call_id: fresh?.id,
    local_day: localDayKey(at, ctx.tz),
    local_time: localHmOf(at, ctx.tz),
  };
}

const OPEN = ["planned", "scheduled", "upcoming", "due", "contacting", "acknowledged", "snoozed"];
const REPLACEABLE = ["goal", "makeup", "recovery", "manual"];

/** Same proposal shape as proposeWeekPlan/proposeDayRepair; applied only by approveWeekPlan (applyProposal). */
async function proposePlanEdit(ctx: ActionCtx, a: Record<string, unknown>) {
  const { db, userId, tz } = ctx;
  const { toMin, commitmentBusy } = await import("./scheduler");
  const now = new Date();
  const nowIso = now.toISOString();
  const moves = (Array.isArray(a["moves"]) ? a["moves"] : []) as {
    session_id: string;
    day: string | null;
    time: string;
  }[];
  const removeIds = new Set(
    (Array.isArray(a["remove_session_ids"]) ? a["remove_session_ids"] : []).map(String),
  );
  const clearDay = a["clear_day"] ? await resolveDayExpr(a["clear_day"], ctx) : null;
  if (a["clear_day"] && !clearDay) return { error: "could_not_understand_day" };
  const rebuildDay = a["rebuild_day"] ? await resolveDayExpr(a["rebuild_day"], ctx) : null;
  if (a["rebuild_day"] && !rebuildDay) return { error: "could_not_understand_day" };
  const targetIds = [...removeIds, ...moves.map((m) => m.session_id)];
  // Work out the latest week touched so the proposal covers it (applyProposal replaces now → that week's end).
  const touchedDays: string[] = [clearDay, rebuildDay].filter(Boolean) as string[];
  const { data: rawTargets } = targetIds.length
    ? await db.from("plan_blocks").select("*").in("id", targetIds)
    : { data: [] };
  // Entries already replaced by a newer plan version are gone from the live plan: removing them is a no-op.
  const alreadyGone = (rawTargets ?? []).filter((t) =>
    ["rescheduled", "cancelled"].includes(t.status),
  );
  for (const g of alreadyGone) removeIds.delete(g.id);
  const targets = (rawTargets ?? []).filter((t) => !alreadyGone.includes(t));
  const goneMoves = moves.filter((m) => alreadyGone.some((g) => g.id === m.session_id));
  if (goneMoves.length)
    return {
      error: "session_already_replaced",
      session_ids: goneMoves.map((m) => m.session_id),
      hint: "Call get_plan for current session ids.",
    };
  if (alreadyGone.length && !removeIds.size && !moves.length && !clearDay && !rebuildDay)
    return {
      ok: true,
      already_removed: alreadyGone.length,
      note: "Those entries were old copies already replaced by the current plan; nothing left to remove.",
    };
  for (const t of targets) touchedDays.push(localDayKey(t.starts_at, tz));
  const resolvedMoves: { id: string; day: string; min: number }[] = [];
  for (const m of moves) {
    const t = (targets ?? []).find((x) => x.id === m.session_id);
    if (!t) return { error: "unknown_session", session_id: m.session_id };
    const day = m.day ? await resolveDayExpr(m.day, ctx) : localDayKey(t.starts_at, tz);
    const tm = hmOk(m.time);
    if (!day || !tm) return { error: "move_needs_valid_day_and_HH:MM", session_id: m.session_id };
    const min = toMin(tm);
    if (min == null) return { error: "move_needs_valid_day_and_HH:MM", session_id: m.session_id };
    resolvedMoves.push({ id: t.id, day, min });
    touchedDays.push(day);
  }
  for (const id of removeIds)
    if (!(targets ?? []).some((x) => x.id === id))
      return { error: "unknown_session", session_id: id };
  if (!touchedDays.length) return { error: "nothing_to_change" };
  const lastDay = touchedDays.sort().at(-1);
  if (!lastDay) return { error: "nothing_to_change" };
  const weekStartKey = weekKeyOf(zonedInstant(lastDay, 720, tz), tz);
  const weekEnd = zonedInstant(addDaysKey(weekStartKey, 7), 0, tz);
  const { data: blocks } = await db
    .from("plan_blocks")
    .select(
      "id,goal_id,title,domain,starts_at,duration_min,status,is_protected,source_type,commitment_id,note",
    )
    .gte("starts_at", zonedInstant(localDayKey(now, tz), 0, tz).toISOString())
    .lt("starts_at", weekEnd.toISOString());
  // Keep past blocks as collision constraints, but only explicitly requested, unstarted
  // moves may bring a late session into a proposal. Bulk repairs must not revive history.
  // Moved/cancelled copies from earlier plan versions are history, not live entries or collisions.
  const all = (blocks ?? []).filter((b) => !["rescheduled", "cancelled"].includes(b.status));
  for (const t of targets ?? []) if (!all.some((b) => b.id === t.id)) all.push(t);
  const moveIds = new Set(resolvedMoves.map((m) => m.id));
  const instructed =
    (await instructedNow(ctx)) || /^(?:please\s+)?swap\b/i.test(ctx.memberText?.trim() ?? "");
  const explicitIds = new Set(instructed ? targetIds : []);
  const changeable = all.filter(
    (b) =>
      (b.goal_id || explicitIds.has(b.id)) &&
      OPEN.includes(b.status) &&
      (!b.is_protected || explicitIds.has(b.id)) &&
      !b.commitment_id &&
      REPLACEABLE.includes(b.source_type) &&
      (b.starts_at >= nowIso || moveIds.has(b.id) || explicitIds.has(b.id)),
  );
  const blocked = (targets ?? [])
    .filter((t) => !changeable.some((c) => c.id === t.id))
    .map((t) => ({
      session_id: t.id,
      title: t.title,
      reason: t.is_protected
        ? "locked"
        : !OPEN.includes(t.status)
          ? t.status
          : !REPLACEABLE.includes(t.source_type)
            ? "managed_by_its_domain"
            : "not_an_eligible_session",
    }));
  if (blocked.length)
    return {
      error: "these_sessions_cannot_be_changed",
      sessions: blocked,
      hint: "Explain the returned reason exactly. Internal locks can be overridden by a direct member edit of a Plexecute item; fixed external commitments and finished/in-progress sessions stay unchanged.",
    };
  const overdueMoves = changeable
    .filter((b) => b.starts_at < nowIso && moveIds.has(b.id))
    .map((b) => ({ id: b.id, starts_at: b.starts_at, status: b.status }));
  const memberOverrides = changeable
    .filter((b) => explicitIds.has(b.id) && (b.is_protected || !b.goal_id || b.starts_at < nowIso))
    .map((b) => ({
      id: b.id,
      starts_at: b.starts_at,
      status: b.status,
      is_protected: b.is_protected,
      source_type: b.source_type,
    }));
  const { data: commits } = await db.from("commitments").select("*").eq("active", true);
  if (rebuildDay) {
    const { data: prof } = await db
      .from("profiles")
      .select("wake_time,sleep_time")
      .eq("id", userId)
      .maybeSingle();
    const { rebuildDaySlots } = await import("./coach-scheduling");
    const busy = commitmentBusy(commits as never, isoDow(rebuildDay), rebuildDay);
    const fixed = all
      .filter(
        (b) =>
          localDayKey(b.starts_at, tz) === rebuildDay && !changeable.some((c) => c.id === b.id),
      )
      .map(
        (b) =>
          [
            zonedParts(b.starts_at, tz).minutes,
            zonedParts(b.starts_at, tz).minutes + b.duration_min,
          ] as [number, number],
      );
    const nowMin = localDayKey(now, tz) === rebuildDay ? zonedParts(now, tz).minutes : 0;
    const dayBlocks = changeable.filter((b) => localDayKey(b.starts_at, tz) === rebuildDay);
    const placed = rebuildDaySlots(
      dayBlocks.map((b) => ({
        id: b.id,
        start: zonedParts(b.starts_at, tz).minutes,
        duration: b.duration_min,
      })),
      [...busy, ...fixed],
      Math.max(toMin(prof?.wake_time) ?? 420, nowMin),
      (toMin(prof?.sleep_time) ?? 1380) - 60,
    );
    for (const p of placed) {
      if (p.start == null) removeIds.add(p.id);
      else if (p.moved) resolvedMoves.push({ id: p.id, day: rebuildDay, min: p.start });
    }
  }
  const clashes: string[] = [];
  const proposed: {
    goal_id: string | null;
    title: string;
    domain: string;
    starts_at: string;
    duration_min: number;
    note?: string;
    is_protected?: boolean;
  }[] = [];
  const changes: { session: string; action: string; to?: string }[] = [];
  for (const b of changeable) {
    const day = localDayKey(b.starts_at, tz);
    if (removeIds.has(b.id) || (clearDay && day === clearDay)) {
      changes.push({ session: b.title, action: "removed" });
      continue;
    }
    const mv = resolvedMoves.find((m) => m.id === b.id);
    let startsAt = b.starts_at;
    if (mv) {
      const at = zonedInstant(mv.day, mv.min, tz);
      if (at.getTime() < now.getTime()) return { error: "new_time_has_passed", session: b.title };
      const busy = commitmentBusy(commits as never, isoDow(mv.day), mv.day);
      // Routines, locked/finished sessions and other blocks staying on the target day also block the slot.
      const fixed = all
        .filter(
          (x) =>
            x.id !== b.id &&
            localDayKey(x.starts_at, tz) === mv.day &&
            !removeIds.has(x.id) &&
            !(clearDay && mv.day === clearDay) &&
            !resolvedMoves.some((m) => m.id === x.id),
        )
        .map(
          (x) =>
            [
              zonedParts(x.starts_at, tz).minutes,
              zonedParts(x.starts_at, tz).minutes + x.duration_min,
            ] as [number, number],
        );
      if ([...busy, ...fixed].some(([s, e]) => mv.min < e && mv.min + b.duration_min > s))
        clashes.push(b.title);
      startsAt = at.toISOString();
      changes.push({
        session: b.title,
        action: "moved",
        to: `${mv.day} ${String(Math.floor(mv.min / 60)).padStart(2, "0")}:${String(mv.min % 60).padStart(2, "0")}`,
      });
    }
    proposed.push({
      goal_id: b.goal_id,
      title: b.title,
      domain: b.domain,
      starts_at: startsAt,
      duration_min: b.duration_min,
      ...(b.is_protected ? { is_protected: true } : {}),
      ...(b.note ? { note: b.note.slice(0, 200) } : {}),
    });
  }
  if (clashes.length)
    return {
      error: "clashes_with_a_fixed_commitment",
      sessions: clashes,
      hint: "Pick another time.",
    };
  if (!changes.length)
    return {
      no_change_needed: true,
      hint: "Every session on that day already fits around its commitments.",
    };
  const { data: versions } = await db
    .from("plan_versions")
    .select("version")
    .eq("week_start", weekStartKey)
    .order("version", { ascending: false })
    .limit(1);
  await ctx.admin
    .from("plan_versions")
    .update({ status: "superseded" })
    .eq("user_id", userId)
    .eq("week_start", weekStartKey)
    .eq("status", "proposed");
  const explanation = `Coach change: ${changes.map((c) => `${c.session} ${c.action}${c.to ? ` to ${c.to}` : ""}`).join("; ")}. Reason: ${String(a["reason"] ?? "").slice(0, 200)}. Finished sessions, untargeted locked items and fixed commitments left alone.`;
  const { data: proposal, error } = await ctx.admin
    .from("plan_versions")
    .insert({
      engine_versions: (await import("@/lib/versions")).PLAN_ENGINE_VERSIONS as never,
      user_id: userId,
      week_start: weekStartKey,
      version: (versions?.[0]?.version ?? 0) + 1,
      status: "proposed",
      trigger: "manual",
      feasibility: "feasible",
      explanation,
      diff_summary: {
        proposed_blocks: proposed,
        coach_edit: {
          changes,
          overdue_moves: overdueMoves.filter((b) => !memberOverrides.some((x) => x.id === b.id)),
          member_overrides: memberOverrides,
          reason: a["reason"] ?? null,
        },
        remove_count: changes.filter((c) => c.action === "removed").length,
        replace_count: changes.length,
        kept_count: proposed.length,
      } as never,
    })
    .select("id")
    .single();
  if (error || !proposal) return { error: "proposal_could_not_be_saved" };
  await audit(ctx, "plan.coach_edit_proposed", proposal.id, { changes });
  // The member's own instruction is the approval: apply through the same approveWeekPlan path (fresh status/lock checks).
  if (instructed) {
    try {
      const { approveWeekPlan } = await import("./planning.functions");
      await approveWeekPlan({
        data: { proposalId: proposal.id, mode: "permanent", trialDays: 14 },
      });
      await audit(ctx, "plan.coach_edit_instructed", proposal.id, { changes });
      // A session the member asked to move is pinned so a later rebuild cannot put it back.
      const movedStarts = proposed
        .filter((pb) =>
          resolvedMoves.some((m) => zonedInstant(m.day, m.min, tz).toISOString() === pb.starts_at),
        )
        .map((pb) => pb.starts_at);
      if (movedStarts.length)
        await (
          await import("./planning.functions")
        ).pinMemberMovedSessions(ctx.admin, userId, movedStarts);
      return { applied: true, authorised_by: "member_instruction", changes };
    } catch (e) {
      return { error: (e as Error).message || "could_not_apply", changes };
    }
  }
  ctx.actions.push({
    kind: "approve_plan",
    proposalId: proposal.id,
    label: `Approve: ${changes.length} change${changes.length > 1 ? "s" : ""}`,
    reason: explanation,
  });
  return { proposal_awaiting_approval: true, proposal_id: proposal.id, changes };
}

/** Runs a confirmed pending action with the member's own (RLS) client and the domain server functions. */
async function appointmentTool(
  ctx: ActionCtx,
  tool: CoachActionTool,
  a: Record<string, unknown>,
): Promise<unknown> {
  const ap = await import("./appointments.server");
  const db = ctx.admin;
  try {
    if (tool === "get_appointments") {
      await ap.expireStaleCheckouts(db, ctx.userId);
      const { data } = await ctx.db
        .from("appointment_bookings")
        .select(
          "id,kind,category,service,provider_name,status,payment_state,method,slot_date,start_time,end_time,reference,checkout_url,checkout_amount_minor,checkout_expires_at,failure_reason",
        )
        .order("created_at", { ascending: false })
        .limit(20);
      return { appointments: data ?? [] };
    }
    if (tool === "find_appointment") {
      if (ctx.memberText) {
        const { requestIntent } = await import("./life-intelligence");
        if (requestIntent(ctx.memberText) === "capability_question")
          return {
            not_started: true,
            reason: "capability_question",
            instruction:
              "The member asked whether Plexecute can do this, not for it to be done now. Nothing was started. Answer the question (yes, how it works, what you need), offer to do it, and do not mention any search.",
          };
      }
      const key = `coach:${ctx.messageId ?? ""}:${String(a["service"]).toLowerCase()}:${a["date_from"]}:${a["date_to"]}`;
      const started = await ap.startBooking(db, ctx.userId, ctx.tz, {
        service: String(a["service"] ?? "appointment"),
        request_text: str(a["request_text"], 400),
        constraints: {
          date_from: String(a["date_from"]),
          date_to: String(a["date_to"] ?? a["date_from"]),
          earliest: hmOk(a["earliest"]) ?? "09:00",
          latest: hmOk(a["latest"]) ?? "17:00",
          duration_min: clampInt(num(a["duration_min"]) ?? 30, 10, 240),
          travel_min: num(a["travel_min"]),
          max_price_minor:
            num(a["max_price"]) != null ? Math.round(num(a["max_price"])! * 100) : null,
          location: str(a["location"], 120),
        },
        provider_name: str(a["provider_name"], 100),
        provider_url: str(a["provider_url"], 500),
        provider_phone: str(a["provider_phone"], 30),
        use_usual: !!a["use_usual"],
        preauthorised: !!a["preauthorised"],
        preauthorisation_text: str(a["request_text"], 400),
        kind:
          (["appointment", "reservation", "order"] as const).find((k) => k === a["kind"]) ?? null,
        category: str(a["category"], 30),
        details: (a["details"] && typeof a["details"] === "object" ? a["details"] : null) as Record<
          string,
          unknown
        > | null,
        idempotency_key: key,
      });
      // Wording only: starting a booking is not finding availability.
      return {
        ...(started as object),
        schedule_rule:
          "A member-chosen booking time takes priority over their internal Plexecute sessions. Do not remove sessions merely to start a booking. Fixed external obligations still block times. A separate or additional booking never authorises cancellation or deletion of an existing reservation; continue the new booking only. After confirmation, report any session clash and offer to move it.",
        wording_rule:
          "Only say you found options, tables or availability if this result lists real named options or slots that suit the member's location. If the member has not given a location, or the options are not near them, do not mention any options, slots or search at all. Slot times are the member's own free times, never the business's availability. If details such as area or cuisine are still missing, say what you need (e.g. 'I can help with that. What area and what type of food are you looking for?') and imply nothing was found.",
      };
    }
    let id = String(a["booking_id"] ?? "");
    // A wrong/missing id resolves to the member's only open booking; otherwise the model must pick one.
    {
      const { data: mine } = await ctx.db
        .from("appointment_bookings")
        .select("id")
        .eq("id", /^[0-9a-f-]{36}$/i.test(id) ? id : "00000000-0000-0000-0000-000000000000")
        .maybeSingle();
      if (!mine) {
        const { data: open } = await ctx.db
          .from("appointment_bookings")
          .select("id,service,provider_name,status")
          .in(
            "status",
            tool === "cancel_appointment" || tool === "reschedule_appointment"
              ? ["confirmed"]
              : ["awaiting_confirmation", "booking_in_progress", "checkout_ready", "expired"],
          )
          .order("created_at", { ascending: false })
          .limit(5);
        if ((open ?? []).length === 1) id = open![0]!.id;
        else
          return {
            error: "unknown_booking",
            message: "Which booking? Use one of these booking_id values.",
            open_bookings: open ?? [],
          };
      }
    }
    if (tool === "choose_appointment") {
      const slot = {
        date: String(a["date"]),
        start: hmOk(a["start"]) ?? "",
        end: hmOk(a["end"]) ?? "",
      };
      const method = a["method"] === "phone" ? "phone" : "online";
      if (method === "phone") {
        const { data: b } = await ctx.db
          .from("appointment_bookings")
          .select("preauthorised,service,provider_name")
          .eq("id", id)
          .maybeSingle();
        if (!b) return { error: "unknown_booking" };
        if (!b.preauthorised)
          return pend(
            ctx,
            "book_appointment_by_phone",
            `Phone ${b.provider_name ?? "the business"} to book ${b.service} on ${slot.date} at ${slot.start}`,
            {
              booking_id: id,
              provider_index: num(a["provider_index"]),
              slot,
              provider_phone: str(a["provider_phone"], 30),
            },
          );
      }
      const r = await ap.chooseOption(db, ctx.userId, {
        booking_id: id,
        provider_index: num(a["provider_index"]),
        slot,
        method,
        provider_phone: str(a["provider_phone"], 30),
        origin: "",
      });
      const url = (r as { provider_url?: string }).provider_url;
      if (url)
        ctx.actions.push({
          kind: "link",
          label: "Open booking page",
          to: url,
          reason: "Book this time, then tell me the reference.",
        });
      return r;
    }
    if (tool === "prepare_checkout") {
      const m = (v: unknown) => (num(v) != null ? Math.round(num(v)! * 100) : null);
      const d = str(a["date"], 10),
        st = hmOk(a["start"]);
      const r = await ap.prepareCheckout(db, ctx.userId, {
        booking_id: id,
        checkout_url: str(a["checkout_url"], 1000),
        amount_minor: m(a["amount"]),
        deposit_minor: m(a["deposit"]),
        fee_minor: m(a["fee"]),
        cancellation_terms: str(a["cancellation_terms"], 300),
        expires_at: num(a["expires_in_min"])
          ? new Date(Date.now() + num(a["expires_in_min"])! * 60e3).toISOString()
          : null,
        slot: d && st ? { date: d, start: st, end: hmOk(a["end"]) ?? st } : null,
        source: "coach",
      });
      if ("checkout_url" in r && r.checkout_url)
        ctx.actions.push({
          kind: "link",
          label: "Pay on their secure page",
          to: r.checkout_url,
          reason: "You pay the business directly. Send me the confirmation afterwards.",
        });
      return r;
    }
    if (tool === "confirm_appointment") {
      const money = (v: unknown) => (num(v) != null ? Math.round(num(v)! * 100) : null);
      const r = await ap.confirmBooking(db, ctx.userId, {
        booking_id: id,
        slot: { date: String(a["date"]), start: hmOk(a["start"]) ?? "", end: hmOk(a["end"]) ?? "" },
        reference: str(a["reference"], 80),
        confirmation_text: str(a["confirmation_text"], 400),
        price_minor: money(a["price"]),
        deposit_minor: money(a["deposit"]),
        cancellation_terms: str(a["cancellation_terms"], 300),
        prep_notes: str(a["prep_notes"], 300),
        address: str(a["address"], 200),
        source: "member_online",
        accept_terms: !!a["accept_terms"],
      });
      if ((r as { status?: string }).status === "confirmed")
        ctx.actions.push({
          kind: "link",
          label: "See it in Calendar",
          to: "/app/calendar",
          reason: "Your appointment is in your calendar.",
        });
      return r;
    }
    if (tool === "cancel_appointment") {
      const r = await ap.requestCancel(db, ctx.userId, id);
      if ((r as { status?: string }).status === "cancellation_requested")
        return {
          ...r,
          ...(await pend(
            ctx,
            "cancel_appointment",
            "I've cancelled it with the business: remove it from my calendar and reminders",
            { booking_id: id },
          )),
        };
      return r;
    }
    if (tool === "reschedule_appointment") {
      const { data: b } = await ctx.db
        .from("appointment_bookings")
        .select("constraints")
        .eq("id", id)
        .maybeSingle();
      if (!b) return { error: "unknown_booking" };
      const c = b.constraints as Record<string, unknown>;
      return ap.startReschedule(
        db,
        ctx.userId,
        ctx.tz,
        id,
        {
          date_from: String(a["date_from"]),
          date_to: String(a["date_to"]),
          earliest: hmOk(a["earliest"]) ?? String(c["earliest"]),
          latest: hmOk(a["latest"]) ?? String(c["latest"]),
          duration_min: num(c["duration_min"]) ?? 30,
          travel_min: num(c["travel_min"]),
          max_price_minor: num(c["max_price_minor"]),
          location: str(c["location"], 120),
        },
        `coach-move:${id}:${a["date_from"]}:${a["date_to"]}:${a["earliest"]}`,
      );
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "booking_failed" };
  }
  return { error: "unknown_tool" };
}

async function journeyTool(
  ctx: ActionCtx,
  tool: CoachActionTool,
  a: Record<string, unknown>,
): Promise<unknown> {
  const jf = await import("./journeys.functions");
  const db = ctx.admin;
  try {
    if (tool === "get_journeys") {
      const { data } = await ctx.db
        .from("journeys")
        .select(
          "id,origin_label,dest_label,dest_address,mode,arrive_by,leave_at,duration_min,buffer_min,status,traffic_aware",
        )
        .order("leave_at", { ascending: true })
        .limit(20);
      // Never expose full saved home/work addresses to the model — short place names only.
      const rows = (data ?? []).map((r) => ({
        ...r,
        origin_address: undefined,
        dest_address: r.dest_label ? undefined : String(r.dest_address).split(",")[0],
      }));
      return { journeys: rows };
    }
    if (tool === "plan_journey") {
      const r = await jf.planJourneyCore(db, ctx.userId, {
        destination: String(a["destination"] ?? ""),
        origin: str(a["origin"], 200) ?? null,
        mode: a["mode"] === "transit" || a["mode"] === "walk" ? a["mode"] : "drive",
        arrive_by: String(a["arrive_by"]),
        buffer_min: num(a["buffer_min"]) ?? undefined,
        appointment_id: str(a["appointment_id"], 40) ?? null,
      });
      if (r["status"] === "planned")
        ctx.actions.push({
          kind: "link",
          label: "See it in Calendar",
          to: "/app/calendar",
          reason: "The travel time is reserved in your plan.",
        });
      return r;
    }
    if (tool === "change_journey") {
      return jf.changeJourneyCore(db, ctx.userId, {
        journey_id: String(a["journey_id"] ?? ""),
        mode:
          a["mode"] === "transit" || a["mode"] === "walk"
            ? a["mode"]
            : a["mode"] === "drive"
              ? "drive"
              : undefined,
        origin: str(a["origin"], 200) ?? undefined,
        buffer_min: num(a["buffer_min"]) ?? undefined,
      });
    }
    if (tool === "cancel_journey") {
      return jf.cancelJourneyCore(db, ctx.userId, String(a["journey_id"] ?? ""));
    }
    if (tool === "journey_leave_call") {
      return jf.scheduleLeaveCallCore(db, ctx.userId, String(a["journey_id"] ?? ""));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "journey_failed";
    if (msg.includes("Pro and Execute")) return { error: msg };
    return { error: msg };
  }
  return { error: "unknown_tool" };
}

export async function runPending(
  supabase: Db,
  admin: Db,
  userId: string,
  row: { id: string; kind: string; payload: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const p = row.payload;
  const tzRow = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  const actx = { admin, userId, messageId: undefined };
  switch (row.kind as PendingKind) {
    case "book_appointment_by_phone": {
      const ap = await import("./appointments.server");
      return (await ap.chooseOption(admin, userId, {
        booking_id: String(p["booking_id"]),
        provider_index: (p["provider_index"] as number | null) ?? null,
        slot: p["slot"] as never,
        method: "phone",
        provider_phone: (p["provider_phone"] as string | null) ?? null,
        origin: "",
      })) as Record<string, unknown>;
    }
    case "cancel_appointment": {
      const ap = await import("./appointments.server");
      return (await ap.completeCancel(admin, userId, String(p["booking_id"]))) as Record<
        string,
        unknown
      >;
    }
    case "delete_goal":
    case "delete_plan": {
      const d = await import("./deletion.server");
      const r =
        row.kind === "delete_goal"
          ? await d.deleteGoal(admin, userId, String(p["goal_id"]), String(p["token"]), "coach")
          : await d.deletePlan(
              admin,
              userId,
              String(p["week_start"]),
              (tzRow.data?.timezone as string | null) ?? null,
              String(p["token"]),
              "coach",
            );
      if (r.error)
        throw new Error(
          "Something linked to it changed since you were asked. Ask again to see the up-to-date list before deleting.",
        );
      return r as unknown as Record<string, unknown>;
    }
    case "remove_commitments": {
      const ids = (p["commitment_ids"] as string[]) ?? [];
      await admin
        .from("scheduled_calls")
        .update({ status: "cancelled", status_reason: "commitment_removed" })
        .eq("user_id", userId)
        .in("commitment_id", ids)
        .eq("status", "scheduled");
      const { data, error } = await supabase
        .from("commitments")
        .delete()
        .in("id", ids)
        .select("id");
      if (error) throw new Error("Those commitments could not be removed.");
      await audit(actx, "coach.commitments_removed", null, { ids, pending: row.id });
      return { removed: data?.length ?? 0 };
    }
    case "update_recurring_commitment": {
      const { error } = await supabase
        .from("commitments")
        .update(p["patch"] as never)
        .eq("id", String(p["commitment_id"]));
      if (error) throw new Error("The commitment could not be changed.");
      await audit(actx, "coach.commitment_updated", String(p["commitment_id"]), {
        patch: p["patch"],
        pending: row.id,
      });
      return { updated: true };
    }
    case "update_goal": {
      const { error } = await supabase
        .from("goals")
        .update(p["patch"] as never)
        .eq("id", String(p["goal_id"]));
      if (error) throw new Error(error.message);
      await audit(actx, "coach.goal_updated", String(p["goal_id"]), {
        patch: p["patch"],
        pending: row.id,
      });
      return { updated: true, replan_suggested: true };
    }
    case "update_availability": {
      const { error } = await supabase
        .from("profiles")
        .update(p["patch"] as never)
        .eq("id", userId);
      if (error) throw new Error(error.message);
      await audit(actx, "coach.availability_updated", userId, {
        patch: p["patch"],
        pending: row.id,
      });
      return { updated: true, replan_suggested: true };
    }
    case "set_wellness_preferences": {
      const { saveWellnessPrefs } = await import("./wellness.functions");
      await saveWellnessPrefs({ data: p["prefs"] as never });
      await audit(actx, "coach.wellness_preferences_updated", userId, { pending: row.id });
      return { updated: true };
    }
    case "add_wellness_practice": {
      const { addPracticeGoal } = await import("./guided-video.server");
      const r = await addPracticeGoal(supabase, userId, p as never);
      await audit(actx, "coach.wellness_practice_added", r.id, { pending: row.id, ...p });
      return { added: true, title: r.title, replan_suggested: true };
    }
    case "accept_meal_prep": {
      const mp = await import("./meal-prep.server");
      const r = await mp.acceptPlan({ supabase, userId }, String(p["plan_id"]), "coach");
      return { accepted: true, already: r.already };
    }
    case "log_planned_meal": {
      const mp = await import("./meal-prep.server");
      const r = await mp.logPlannedMeal(
        { supabase, userId },
        String(p["plan_id"]),
        String(p["date"]),
        p["slot"] as never,
        { factor: Number(p["factor"] ?? 1), actor: "coach" },
      );
      return { logged: true, ...r };
    }
    case "log_meal_estimate": {
      const mp = await import("./meal-photo.server");
      if (p["planned_slot"] && p["plan_id"]) {
        const mpr = await import("./meal-prep.server");
        const r = await mpr.logPlannedMeal(
          { supabase, userId },
          String(p["plan_id"]),
          String(p["date"]),
          p["planned_slot"] as never,
          { photoEstimateId: String(p["estimate_id"]), actor: "coach" },
        );
        return { logged: true, replaced_planned_meal: true, ...r };
      }
      const r = await mp.logMealEstimate(
        { supabase, userId },
        String(p["estimate_id"]),
        String(p["meal_slot"]),
        String(p["date"]),
      );
      await audit(actx, "coach.meal_photo_logged", userId, {
        pending: row.id,
        estimate: p["estimate_id"],
        duplicate: r.already_logged,
      });
      return { logged: true, already_logged: r.already_logged };
    }
    case "log_food": {
      if (Array.isArray(p["items"])) {
        const { logFood } = await import("./nutrition.functions");
        const date = String(p["date"] ?? localDayKey(new Date(), tzRow.data?.timezone ?? null));
        const logged = [];
        for (const [i, it] of (
          p["items"] as { food: Record<string, unknown>; grams: number }[]
        ).entries()) {
          const f = it.food;
          const food = {
            source: f["source"],
            source_ref: f["source_ref"] ?? null,
            name: f["name"],
            brand: f["brand"] ?? null,
            barcode: f["barcode"] ?? null,
            kcal_100g: f["kcal_100g"],
            protein_100g: f["protein_100g"],
            carbs_100g: f["carbs_100g"],
            fat_100g: f["fat_100g"],
            fibre_100g: f["fibre_100g"] ?? null,
            serving_g: f["serving_g"] ?? null,
            serving_label: f["serving_label"] ?? null,
            allergens: f["allergens"] ?? [],
          };
          logged.push(
            await logFood({
              data: {
                food: food as never,
                grams: Number(it.grams),
                meal_slot: p["meal_slot"] as never,
                date,
                method: "text",
                clientOpId: `coach-${row.id}-${i}`,
              },
            }),
          );
        }
        return { logged: true, count: logged.length, result: logged as never };
      }
      const { data: food } = await supabase
        .from("user_foods")
        .select("*")
        .eq("id", String(p["food_id"]))
        .maybeSingle();
      if (!food) throw new Error("That saved food no longer exists.");
      const { logFood } = await import("./nutrition.functions");
      const r = await logFood({
        data: {
          food: {
            source: food.source as never,
            source_ref: food.source_ref,
            name: food.name,
            brand: food.brand,
            barcode: food.barcode,
            kcal_100g: food.kcal_100g,
            protein_100g: food.protein_100g,
            carbs_100g: food.carbs_100g,
            fat_100g: food.fat_100g,
            fibre_100g: food.fibre_100g,
            serving_g: food.serving_g,
            serving_label: food.serving_label,
            allergens: food.allergens,
          },
          grams: Number(p["grams"]),
          meal_slot: p["meal_slot"] as never,
          date: String(p["date"] ?? localDayKey(new Date(), tzRow.data?.timezone ?? null)),
          method: "search",
          clientOpId: `coach-${row.id}`,
        },
      });
      return { logged: true, result: r as never };
    }
    case "change_training_programme": {
      const { createProgramme } = await import("./training.functions");
      const r = await createProgramme({ data: p["programme"] as never });
      // Earlier fixed "gym session" entries the Coach saved would block the programme's own slots: retire them.
      const { isOwnTrainingSession } = await import("./coach-tools.server");
      const { data: fixed } = await actx.admin
        .from("commitments")
        .select("id,title,note")
        .eq("user_id", actx.userId)
        .eq("source", "coach")
        .eq("active", true);
      const retire = (fixed ?? [])
        .filter((c) => isOwnTrainingSession(c.title, c.note))
        .map((c) => c.id);
      if (retire.length) {
        await actx.admin
          .from("scheduled_calls")
          .update({ status: "cancelled", status_reason: "training_now_on_plan" })
          .eq("user_id", actx.userId)
          .in("commitment_id", retire)
          .eq("status", "scheduled");
        await actx.admin
          .from("commitments")
          .update({ active: false })
          .eq("user_id", actx.userId)
          .in("id", retire);
      }
      await audit(actx, "coach.training_programme_changed", null, {
        programme: p["programme"],
        pending: row.id,
        retired_training_commitments: retire.length,
      });
      return { changed: true, result: r as never };
    }
    case "disconnect_device": {
      const { disconnectWearableFn } = await import("./wearables.functions");
      await disconnectWearableFn({
        data: { id: String(p["connection_id"]), deleteData: p["delete_data"] === true },
      });
      await audit(actx, "coach.device_disconnected", String(p["connection_id"]), {
        delete_data: p["delete_data"] === true,
        pending: row.id,
      });
      return { disconnected: true };
    }
  }
  throw new Error("Unknown action.");
}

const WEEKDAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
async function mealPrepTool(
  ctx: ActionCtx,
  tool: CoachActionTool,
  a: Record<string, unknown>,
): Promise<unknown> {
  const mp = await import("./meal-prep.server");
  const m = { supabase: ctx.db, userId: ctx.userId };
  const day = async (v: unknown) => (v ? await resolveDayExpr(v, ctx) : null);
  const slotOf = (v: unknown) =>
    ["breakfast", "lunch", "dinner", "snack"].includes(String(v)) ? (String(v) as "lunch") : null;
  const summary = (pl: NonNullable<Awaited<ReturnType<typeof mp.currentPlan>>>) => ({
    plan_id: pl.id,
    status: pl.status,
    targets: pl.plan.context.targets,
    targets_source: pl.plan.context.targetsSource,
    notes: pl.plan.notes,
    days: pl.plan.days.map((d) => ({
      date: d.date,
      day: d.label,
      total_kcal: d.totals.kcal,
      protein_g: Math.round(d.totals.protein_g),
      carbs_g: Math.round(d.totals.carbs_g),
      fat_g: Math.round(d.totals.fat_g),
      meals: d.meals.map((x) => ({
        slot: x.slot,
        name: x.name,
        kcal: x.kcal,
        protein_g: Math.round(x.protein_g),
        state: x.state,
        from_prep: !!x.batch,
      })),
    })),
    shopping_need_to_buy: pl.shopping.buy.map((b) => `${b.name} ${b.label}`),
    already_have: pl.shopping.have.map((h) => h.name),
    prep_sessions: pl.prep.map((s) => ({
      date: s.date,
      day: s.label,
      minutes: s.minutes,
      prepare: s.cook.map((c) => `${c.name} ${c.grams} g`),
      makes: s.creates,
    })),
  });
  try {
    switch (tool) {
      case "get_nutrition_status": {
        const d = (await day(a["day"])) ?? undefined;
        const st = await mp.nutritionStatus(m, d);
        const plan = st.plannedDay ? null : await mp.currentPlan(m, st.date);
        const planned =
          st.plannedDay?.meals ??
          (plan?.status === "approved"
            ? plan.plan.days.find((x) => x.date === st.date)?.meals
            : undefined) ??
          [];
        return {
          date: st.date,
          eaten_from_food_log: st.consumed,
          targets: st.target,
          remaining: st.remaining,
          planned_meals: planned.map((x) => ({
            slot: x.slot,
            name: x.name,
            kcal: x.kcal,
            protein_g: Math.round(x.protein_g),
            state: x.state,
          })),
          note: "Planned meals are not counted as eaten until logged.",
        };
      }
      case "get_meal_prep": {
        const [inv, pl] = await Promise.all([mp.listInventory(m), mp.currentPlan(m)]);
        return {
          inventory: inv.items.map((i) => ({
            name: i.name,
            grams: i.grams,
            amount: i.quantity_status,
          })),
          needs_quantity: inv.needsQuantity.map((n) => n.name),
          plan: pl ? summary(pl) : null,
        };
      }
      case "add_food_inventory": {
        const text = String(a["text"] ?? "").slice(0, 1500);
        const key = `coach:${ctx.messageId ?? ""}:${text.length}:${text.slice(0, 40)}`.slice(0, 80);
        const r = await mp.addInventoryText(m, text, "coach", key);
        ctx.actions.push({
          kind: "link",
          label: "Review food list",
          to: "/app/nutrition",
          reason: "Same list as Nutrition.",
        });
        return {
          added: r.parsed,
          duplicate: r.duplicate,
          inventory: r.items.map(
            (i) => `${i.name}${i.grams ? ` ${i.grams} g` : ""} (${i.quantity_status})`,
          ),
          needs_quantity: r.needsQuantity.map((n) => n.name),
        };
      }
      case "update_food_inventory": {
        const inv = await mp.listInventory(m);
        const want = String(a["name"] ?? "").toLowerCase();
        const it = inv.items.find(
          (i) =>
            i.name.toLowerCase().includes(want) ||
            want.includes(i.name.toLowerCase().split(" (")[0]!),
        );
        if (!it) return { error: "not_in_inventory", inventory: inv.items.map((i) => i.name) };
        const r = await mp.updateInventoryItem(m, it.id, {
          ...(num(a["grams"]) != null ? { grams: num(a["grams"]) } : {}),
          ...(a["as_needed"] === true ? { as_needed: true } : {}),
          ...(a["remove"] === true ? { remove: true } : {}),
          ...(a["rename_to"] ? { name: String(a["rename_to"]) } : {}),
        });
        return { updated: it.name, needs_quantity: r.needsQuantity.map((n) => n.name) };
      }
      case "plan_meal_prep": {
        if (a["unknown_as_needed"] === true) await mp.confirmInventory(m, "as_needed");
        // No calories given: never fall back to old saved targets for a body-change request; use the nutrition engine for this goal.
        let autoTarget: { kcal: number; protein_g: number } | null = null;
        if (num(a["kcal"]) == null) {
          const txt = String(ctx.memberText ?? "").toLowerCase();
          const ft = /(\d{2,3}(?:\.\d)?)\s*kg?\s*(?:to|->|-)\s*(\d{2,3}(?:\.\d)?)\s*kg/.exec(txt);
          const goal = ft
            ? Number(ft[2]) > Number(ft[1])
              ? "gain"
              : Number(ft[2]) < Number(ft[1])
                ? "lose"
                : "maintain"
            : /\b(gain|bulk|put on|build muscle|bigger)\b/.test(txt)
              ? "gain"
              : /\b(lose|cut|drop|slim)\b/.test(txt)
                ? "lose"
                : null;
          if (goal) {
            const { estimateEnergy } = await import("./coach-tools.server");
            const e = (await estimateEnergy(ctx as never, {
              goal,
              strength_training: /train|gym|lift|muscle/.test(txt),
              ...(ft ? { weight_kg: Number(ft[1]) } : {}),
            })) as { target_kcal?: number; protein_g?: number };
            if (e.target_kcal)
              autoTarget = {
                kcal: e.target_kcal,
                protein_g: e.protein_g ?? Math.round((ft ? Number(ft[1]) : 70) * 1.8),
              };
          }
        }
        const r = await mp.buildPlan(m, {
          start: await day(a["start_day"]),
          days: num(a["days"]) ?? 7,
          onlyExisting: a["only_existing"] === true,
          kcal: num(a["kcal"]) ?? autoTarget?.kcal ?? null,
          protein_g: num(a["protein_g"]) ?? autoTarget?.protein_g ?? null,
          prepWeekday: a["prep_day"] ? WEEKDAY.indexOf(String(a["prep_day"])) : null,
          actor: "coach",
        });
        if ("message" in r)
          return { needs_quantity: r.needsQuantity.map((n) => n.name), ask: r.message };
        // Asked for in the member's own words: the plan is theirs straight away, no separate accept step.
        if (await instructedNow(ctx)) {
          const askedPrep = /\b(meal[- ]?prep|batch[- ]?cook|prep (session|day|time))/i.test(
            String((ctx as { memberText?: string }).memberText ?? ""),
          );
          const acc = await mp.acceptPlan(m, (r as { id: string }).id, "coach", {
            prepSessions: askedPrep,
          });
          ctx.actions.push({
            kind: "link",
            label: "See meal plan",
            to: "/app/nutrition",
            reason: "Your accepted meal plan, recipes and shopping list.",
          });
          return {
            accepted: true,
            authorised_by: "member_instruction",
            prep_sessions_on_plan: askedPrep,
            note: askedPrep
              ? undefined
              : "No batch-prep sessions were put on the plan (the member did not ask for them); do not say the plan includes prep sessions.",
            next: "Now call schedule_meals with from_meal_plan true so each day's meals are on the daily plan.",
            ...summary(acc as never),
          };
        }
        ctx.actions.push({
          kind: "link",
          label: "Review meal plan",
          to: "/app/nutrition",
          reason: "Review, change and accept it on Nutrition.",
        });
        return { proposal_awaiting_acceptance: true, ...summary(r as never) };
      }
      case "edit_meal_prep": {
        const pl = await mp.currentPlan(m);
        if (!pl) return { error: "no_meal_prep_plan", hint: "Call plan_meal_prep first." };
        const d = await day(a["day"]);
        const s = slotOf(a["slot"]);
        const arr = (v: unknown) =>
          Array.isArray(v) ? v.map((x) => String(x).slice(0, 40)).slice(0, 10) : undefined;
        const act = String(a["action"]);
        let edit: Record<string, unknown>;
        if (act === "swap")
          edit = {
            type: "swap",
            a: { date: d, slot: s },
            b: { date: await day(a["day2"]), slot: slotOf(a["slot2"]) ?? s },
          };
        else if (act === "adjust_kcal")
          edit = {
            type: "adjust_kcal",
            date: d,
            kcal: clampInt(num(a["kcal"]) ?? -200, -800, 800),
          };
        else if (act === "more_protein")
          edit = { type: "more_protein", date: d, grams: clampInt(num(a["grams"]) ?? 20, 5, 80) };
        else if (act === "remove") edit = { type: "remove", date: d, slot: s };
        else if (act === "replace_from")
          edit = {
            type: "replace_days",
            from: d,
            ...(s ? { slot: s } : {}),
            ...(arr(a["avoid"]) ? { avoid: arr(a["avoid"]) } : {}),
            ...(arr(a["prefer"]) ? { prefer: arr(a["prefer"]) } : {}),
          };
        else
          edit = {
            type: "replace",
            date: d,
            slot: s,
            ...(arr(a["avoid"]) ? { avoid: arr(a["avoid"]) } : {}),
            ...(arr(a["prefer"]) ? { prefer: arr(a["prefer"]) } : {}),
            ...(a["vegetarian"] === true ? { vegetarian: true } : {}),
            ...(a["quick"] === true ? { quick: true } : {}),
          };
        if (!d || (["replace", "swap", "remove"].includes(act) && !s))
          return { error: "need_day_and_slot" };
        const r = await mp.editPlan(m, pl.id, edit as never, "coach");
        return { changed: r.changed, ...summary(r as never) };
      }
      case "accept_meal_prep": {
        const pl = await mp.currentPlan(m);
        if (!pl) return { error: "no_meal_prep_plan" };
        if (pl.status === "approved") return { already_accepted: true, plan_id: pl.id };
        return pend(
          ctx,
          "accept_meal_prep",
          `Make this ${pl.plan.days.length}-day meal plan (from ${pl.plan.days[0]!.label} ${pl.plan.days[0]!.date}) your plan`,
          { plan_id: pl.id },
        );
      }
      case "log_planned_meal": {
        const d = (await day(a["day"])) ?? localDayKey(new Date(), ctx.tz);
        const s = slotOf(a["slot"]);
        if (!s) return { error: "need_slot" };
        const pl = await mp.currentPlan(m, d);
        const meal =
          pl?.status === "approved"
            ? pl.plan.days.find((x) => x.date === d)?.meals.find((x) => x.slot === s)
            : null;
        if (!pl || !meal)
          return {
            error: "no_planned_meal",
            hint: "Log the food with search_food/log_food instead.",
          };
        if (meal.state === "eaten") return { already_logged: true, meal: meal.name };
        const factor = Math.max(0.25, Math.min(3, num(a["factor"]) ?? 1));
        return pend(
          ctx,
          "log_planned_meal",
          `Log ${s}: ${meal.name}, about ${Math.round(meal.kcal * factor)} kcal`,
          { plan_id: pl.id, date: d, slot: s, factor },
        );
      }
      case "set_meal_preferences": {
        const r = await mp.setPreferences(m, {
          ...(Array.isArray(a["dislikes"])
            ? {
                dislikes: (a["dislikes"] as unknown[])
                  .map((x) => String(x).slice(0, 40))
                  .slice(0, 30),
              }
            : {}),
          ...(a["prep_day"]
            ? { prep_weekday: Math.max(0, WEEKDAY.indexOf(String(a["prep_day"]))) }
            : {}),
          ...(typeof a["quick_breakfasts"] === "boolean"
            ? { quick_breakfasts: a["quick_breakfasts"] as boolean }
            : {}),
        });
        return {
          saved: true,
          preferences: {
            dislikes: r.dislikes,
            prep_day: WEEKDAY[r.prep_weekday],
            quick_breakfasts: r.quick_breakfasts,
          },
        };
      }
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
  return { error: "unknown_tool" };
}

async function pathwayTool(
  ctx: ActionCtx,
  tool: CoachActionTool,
  a: Record<string, unknown>,
): Promise<unknown> {
  const pf = await import("./pathway.functions");
  const n = (k: string) =>
    a[k] == null || a[k] === "" ? null : Number.isFinite(Number(a[k])) ? Number(a[k]) : null;
  const d = (k: string) =>
    typeof a[k] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a[k] as string)
      ? (a[k] as string)
      : null;
  try {
    if (tool === "update_pathway_milestone") {
      const act = String(a["action"] ?? "");
      if (!["complete", "block", "fail", "unblock"].includes(act))
        return { error: "action_must_be_complete_block_fail_or_unblock" };
      return pf.updateMilestoneCore(ctx.db, ctx.userId, {
        milestone_id: String(a["milestone_id"] ?? ""),
        action: act as "complete",
        evidence: str(a["evidence"], 300) ?? null,
        reason: str(a["reason"], 300) ?? null,
      });
    }
    if (!(tool === "draft_goal_pathway")) return { error: "unknown_tool" };
    const input = {
      goal: String(a["goal"] ?? "").slice(0, 400),
      deadline: d("deadline"),
      jurisdiction: str(a["jurisdiction"], 60) ?? null,
      budget: n("budget"),
      monthly_saving: n("monthly_saving"),
      current: n("current"),
      feedback: str(a["feedback"], 600) ?? null,
    };
    // One pathway per mission: a goal that already has a saved pathway from this mission is reused, never rebuilt;
    // a mission goal saved without a pathway gets the pathway attached to it.
    let attachTo: string | null = null;
    if (!input.feedback) {
      const { data: missions } = await ctx.db
        .from("goal_missions")
        .select("goal_id,title,state")
        .not("goal_id", "is", null)
        .neq("state", "ACHIEVED");
      const words = (t: string) =>
        new Set(
          t
            .toLowerCase()
            .split(/[^a-z]+/)
            .filter((w) => w.length > 3),
        );
      const want = words(input.goal);
      for (const m of missions ?? []) {
        const { data: g } = await ctx.db
          .from("goals")
          .select("id,title,status,pathway")
          .eq("id", m.goal_id)
          .maybeSingle();
        if (
          g?.pathway &&
          ["active", "proposed"].includes(g.status) &&
          [...words(`${g.title} ${m.title}`)].filter((w) => want.has(w)).length >= 2
        )
          return {
            status: "already_saved",
            goal_id: g.id,
            goal: g.title,
            goal_status: g.status,
            note: "This goal already has its pathway. Do not draft again: use get_mission / request_replan, or pass feedback to revise it.",
          };
        if (
          g &&
          !g.pathway &&
          ["active", "proposed"].includes(g.status) &&
          [...words(`${g.title} ${m.title}`)].filter((w) => want.has(w)).length >= 2
        )
          attachTo = g.id;
      }
    }
    const r = await pf.draftPathwayCore(ctx.db, ctx.userId, input);
    if (r.status !== "draft") return r;
    if (r.errors.length) return { status: "needs_revision", errors: r.errors };
    if (r.assessment.level === "infeasible")
      return {
        status: "infeasible",
        assessment: r.assessment,
        goal: r.draft.goal_title,
        note: "Explain the reasons and alternatives; nothing was saved.",
      };
    // A refined draft in the same conversation replaces the member's earlier unconfirmed Coach proposal for the same aim (no duplicate proposals).
    const { data: earlier } = await ctx.db
      .from("goals")
      .select("id,title,domain,created_at")
      .eq("status", "proposed")
      .not("pathway", "is", null)
      .gte("created_at", new Date(Date.now() - 6 * 3600e3).toISOString());
    const activeNow = await instructedNow(ctx);
    const saved = await pf.acceptPathwayCore(ctx.db, ctx.userId, {
      goal_id: attachTo,
      draft: r.draft,
      deadline: input.deadline,
      budget: input.budget,
      monthly_saving: input.monthly_saving,
      current: input.current,
      status: activeNow ? "active" : "proposed",
    });
    if (saved.status === "saved") {
      const words = (t: string) =>
        new Set(
          t
            .toLowerCase()
            .replace(/\bcompany\b|\bfirm\b/g, "business")
            .split(/[^a-z]+/)
            .filter(
              (w) =>
                w.length > 3 &&
                ![
                  "start",
                  "your",
                  "with",
                  "launch",
                  "build",
                  "become",
                  "into",
                  "england",
                  "kingdom",
                  "united",
                  "states",
                ].includes(w),
            ),
        );
      const now = words(`${r.draft.goal_title} ${input.goal}`);
      const replaced = (earlier ?? [])
        .filter(
          (g) =>
            g.domain === r.draft.domain &&
            ([...words(g.title)].some((w) => now.has(w)) ||
              Date.now() - Date.parse(g.created_at) < 30 * 60e3),
        )
        .map((g) => g.id);
      if (replaced.length)
        await ctx.db.from("goals").update({ status: "superseded" }).in("id", replaced);
    }
    if (saved.status === "saved" && !activeNow)
      ctx.actions.push({
        kind: "link",
        label: "Review and confirm the goal",
        to: "/app/goals",
        reason: "It only joins your plan when you confirm it.",
      });
    if (saved.status === "saved" && activeNow)
      Object.assign(saved, {
        goal_status: "active",
        authorised_by: "member_instruction",
        next: "Call request_replan so its first sessions go on the plan.",
      });
    return {
      ...saved,
      pathway: {
        goal: r.draft.goal_title,
        done_when: r.draft.success.definition,
        route: r.draft.options.find((o) => o.key === r.draft.chosen_option)?.title ?? null,
        options: r.draft.options.map((o) => o.title),
        milestones: r.draft.milestones.map((m) => ({
          title: m.title,
          stage: m.stage,
          who: m.capability,
        })),
        prerequisites: r.draft.prerequisites,
        assumptions: r.draft.assumptions,
        risks: r.draft.risks,
        sources: r.draft.sources
          .filter((s) => s.fact)
          .map((s) => ({ title: s.title, publisher: s.publisher, url: s.url })),
        research_confidence: r.draft.research_confidence,
      },
      boundary: r.boundary,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
/** ["monday","friday"] / [1,5] / "weekdays" -> ISO weekdays 1..7, or null. */
export function weekdaysArg(v: unknown): number[] | null {
  if (v == null) return null;
  const raw = Array.isArray(v) ? v : [v];
  const out = new Set<number>();
  for (const x of raw) {
    const t = String(x).toLowerCase().trim();
    if (/^weekdays?$/.test(t)) [1, 2, 3, 4, 5].forEach((d) => out.add(d));
    else if (/^weekends?$/.test(t)) [6, 7].forEach((d) => out.add(d));
    else if (/^[1-7]$/.test(t)) out.add(Number(t));
    else {
      const i = DAY_NAMES.findIndex((n) => n.startsWith(t.slice(0, 3)));
      if (i >= 0 && t.length >= 3) out.add(i + 1);
    }
  }
  return out.size ? [...out].sort() : null;
}
export function hmArg(v: unknown): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(String(v ?? "").trim());
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (m[3]?.toLowerCase() === "pm" && h < 12) h += 12;
  if (m[3]?.toLowerCase() === "am" && h === 12) h = 0;
  return h < 24 && mi < 60 ? `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` : null;
}
