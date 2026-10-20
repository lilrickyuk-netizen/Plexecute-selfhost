import {
  stylePrompt,
  styleViolations,
  STYLE_FALLBACK,
  MESSAGE_FORMAT,
  plainMessage,
  dropRepeatedDraft,
} from "@/lib/coaching-style";
import { startOfLocalDay } from "./tz";
import { retainResearchLinks } from "./research";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const FREE_DAILY_TURNS = 5;
const PAID_DAILY_TURNS = 200;

// Daily limits reset at local midnight in the user's own time zone.

async function fallbackFor(
  supabase: any,
  userId: string,
  reason: "paused" | "busy" | "unavailable",
) {
  const { fallbackReply } = await import("@/lib/ai-fallback");
  const { localDayRange, zonedParts } = await import("@/lib/tz");
  const { data: prof } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  const tz = prof?.timezone ?? null;
  const [, end] = localDayRange(new Date(), tz);
  const { data: b } = await supabase
    .from("plan_blocks")
    .select("title,starts_at")
    .eq("user_id", userId)
    .in("status", ["planned", "scheduled", "upcoming", "due", "snoozed"])
    .gte("starts_at", new Date().toISOString())
    .lt("starts_at", end.toISOString())
    .order("starts_at")
    .limit(1)
    .maybeSingle();
  const next = b
    ? (() => {
        const z = zonedParts(b.starts_at, tz);
        return {
          title: b.title,
          startsLocal: `${String(z.h).padStart(2, "0")}:${String(z.mi).padStart(2, "0")}`,
        };
      })()
    : null;
  return {
    ok: false as const,
    error: reason,
    reply: null,
    safety: null,
    fallback: fallbackReply(reason, next),
  };
}

async function startOfUserDay(supabase: { from: (t: "profiles") => any }, userId: string) {
  const { data } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  return startOfLocalDay(new Date(), data?.timezone).toISOString();
}

export const getCoachUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("tier")
      .eq("id", userId)
      .single();
    const limit = profile?.tier === "free" || !profile ? FREE_DAILY_TURNS : PAID_DAILY_TURNS;
    const { count } = await supabase
      .from("coach_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("role", "user")
      .gte("created_at", await startOfUserDay(supabase, userId));
    return { ended: (count ?? 0) >= limit, tier: profile?.tier ?? "free" };
  });

/** Clears the member's whole Coach conversation; the AI context starts fresh on the next message. */
export const clearCoachChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("coach_messages").delete().eq("user_id", userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, error: null };
  });

export const sendCoachMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        message: z.string().trim().min(1).max(2000),
        mode: z.enum(["EXPERT", "COACH", "EXECUTION", "REVIEW"]).default("COACH"),
        mealEstimateId: z.string().uuid().nullable().optional(),
        stream: z.boolean().optional(),
        sessionId: z.string().uuid().optional(),
        location: z
          .object({
            lat: z.number().min(-90).max(90),
            lng: z.number().min(-180).max(180),
            accuracy: z.number().min(0).max(100000),
          })
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Live progress: the stage Coach is on, streamed to the chat so long turns never sit silent.
    const TB0 = await import("./coach-turn-budget");
    let stage = TB0.STAGE_START;
    const setStage = (s: string) => {
      stage = s;
    };
    const run = (async () => {
      const turnStarted = Date.now();
      const { supabase, userId } = context;
      // Plexecute never handles payment credentials: card numbers/codes are removed before storage or AI.
      data = {
        ...data,
        message: (await import("./appointments")).redactPaymentCredentials(data.message),
      };
      // An attached meal photo arrives as its saved estimate (the photo itself is never kept).
      let content = data.message;
      if (data.mealEstimateId) {
        const { data: est } = await supabase
          .from("meal_photo_estimates")
          .select("id,estimate")
          .eq("id", data.mealEstimateId)
          .maybeSingle();
        if (est) {
          const { describeEstimate, normaliseEstimate } = await import("@/lib/meal-photo");
          content = `${data.message}\n\n[Meal photo estimate ${est.id}: ${describeEstimate(normaliseEstimate(est.estimate))}]`;
        }
      }

      // Phone GPS the member chose to share with this message: turned into a street address for pickups.
      if (data.location) {
        const { describeLocation } = await import("@/lib/geolocation.server");
        content = `${content}\n\n${await describeLocation(data.location)}`;
      }

      // Asked from inside a session: Coach answers from that exact session's brief.
      if (data.sessionId) {
        const { data: blk } = await supabase
          .from("plan_blocks")
          .select("id,title")
          .eq("id", data.sessionId)
          .maybeSingle();
        if (blk) {
          // The brief is loaded here and handed over directly, so Coach never has to copy the id back correctly.
          const { loadSessionBrief } = await import("@/lib/session-brief.server");
          const { briefForCoach } = await import("@/lib/session-brief");
          const brief = await loadSessionBrief(supabase, userId, blk.id).catch(() => null);
          content = brief
            ? `${content}\n\n[Member is asking from inside the session "${blk.title}" (block_id ${blk.id}). Its session brief (answer from it: "what do I do first" = first_step; "why" = why_chain; resources only from its list): ${JSON.stringify(briefForCoach(brief))}]`
            : `${content}\n\n[Member is asking from inside the session "${blk.title}" (block_id ${blk.id}). Call get_session_brief with this block_id and answer from it.]`;
        }
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();
      // V3 §74: 30 coach turns a minute; crisis screening below still runs first for any message that gets through.
      if (!(await (await import("@/lib/security.server")).rateLimit("coach_turn", userId)))
        return { ok: false as const, error: "rate_limited", reply: null, safety: null };
      // V3 §60 restriction: no AI processing of this person's data while restricted.
      if (profile?.processing_restricted)
        return { ok: false as const, error: "restricted", reply: null, safety: null };
      // §62 pre-generation safety: crisis and red flags never reach the model and are never rate limited.
      const { screenText, recordSafety } = await import("@/lib/safety.server");
      const { safetyMessage, outputViolations } = await import("@/lib/safety");
      const pre = await screenText(userId, "ai_input", data.message);
      const preMsg =
        pre.stopOrdinaryCoaching || pre.intervention === "neutral_support_refer"
          ? safetyMessage(pre, profile?.timezone)
          : null;
      if (preMsg && pre.signals.length) {
        const { supabaseAdmin: adm } = await import("@/integrations/supabase/client.server");
        const { detectSignals } = await import("@/lib/safety");
        if (detectSignals(data.message).length) {
          await adm.from("coach_messages").insert([
            { user_id: userId, role: "user", content, mode: data.mode },
            {
              user_id: userId,
              role: "assistant",
              content: preMsg,
              mode: data.mode,
              contract: { safety_state: pre.state, intervention: pre.intervention } as never,
            },
          ]);
          return { ok: true as const, error: null, reply: preMsg, safety: pre.state };
        }
      }
      // V3 §92: an admin kill switch pauses AI replies; safety screening above still ran.
      const flags = await import("@/lib/flags.server");
      if (!(await flags.flagOn("coach_ai"))) return fallbackFor(supabase, userId, "paused");
      const limit = (await import("@/lib/flags")).applyCap(
        profile?.tier === "free" || !profile ? FREE_DAILY_TURNS : PAID_DAILY_TURNS,
        await flags.flagCap("coach_daily_turn_cap"),
      );
      const { count } = await supabase
        .from("coach_messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("role", "user")
        .gte("created_at", await startOfUserDay(supabase, userId));
      if ((count ?? 0) >= limit) {
        return { ok: false as const, error: "limit", reply: null, safety: null };
      }
      // V3 §5.2: Free also has a daily AI token budget, enforced before the provider call.
      const budget = await import("@/lib/ai-budget.server");
      if (!(await budget.reserveFreeAiBudget(userId, profile?.tier, 4000, 800))) {
        return { ok: false as const, error: "limit", reply: null, safety: null };
      }

      const faults = await (
        await import("@/lib/fault-injection.server")
      ).armFaults(userId, data.message);
      // Drill only: an invalid key makes the real provider refuse, so the real outage path below runs.
      const apiKey = faults.has("ai")
        ? "fault-injected-invalid-key"
        : process.env["OPENAI_API_KEY"];
      if (!apiKey) return fallbackFor(supabase, userId, "unavailable");

      const { TOOL_DEFS, runTool } = await import("@/lib/coach-tools.server");
      const { MODE_PROMPT, deriveContract } = await import("@/lib/coach-tools");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: savedUser } = await supabaseAdmin
        .from("coach_messages")
        .insert({ user_id: userId, role: "user", content, mode: data.mode })
        .select("id")
        .single();
      const msgId = savedUser?.id;

      const { data: history } = await supabase
        .from("coach_messages")
        .select("role,content")
        .order("created_at", { ascending: false })
        .limit(13);
      const safetyNote =
        pre.state === "NORMAL"
          ? ""
          : `\nSafety state ${pre.state} (signals: ${pre.signals.join(", ")}). Do not set calorie deficits, progressive training or push accountability. Use neutral supportive language and suggest a qualified professional where relevant. Never mention upgrades.`;
      const ctx = {
        db: supabase,
        userId,
        tier: profile?.tier ?? "free",
        tz: profile?.timezone ?? null,
        actions: [],
        evidenceRefs: [],
        safety: [],
        messageId: msgId,
      } as Parameters<typeof runTool>[0];

      // Selective knowledge: cheap lexical match on this message only (no extra model call); deeper lookups use get_knowledge_evidence.
      const { coachingBrief } = await import("@/lib/coaching-brief");
      // Life Intelligence routing: pick only the knowledge domains this message touches, and what Plexecute can actually do.
      const LI = await import("@/lib/life-intelligence");
      const route = LI.routeDomains(content);
      const capability = LI.capabilityFor(content, ctx.tier);
      const intent = LI.requestIntent(data.message);
      // Coach first, search second: broad personal goals/struggles get coaching, not research or a new plan.
      const CF = await import("./coach-first");
      const learningIntent = (await import("@/lib/learning-subject")).isLearningIntent(
        data.message,
      );
      // Conversation continuity: an answer/follow-up inside an active coaching flow inherits it
      // instead of being re-routed from zero (no research, no new plan).
      const { data: lastConvRow } = await supabase
        .from("coach_messages")
        .select("contract,created_at")
        .eq("role", "assistant")
        .order("created_at", { ascending: false })
        .limit(1);
      const prevConversation = CF.readConversation((lastConvRow ?? [])[0]);
      const continuity = CF.continueConversation(prevConversation, data.message, {
        learning: learningIntent,
      });
      const coachContinue = continuity.continue;
      const coachingFlow = coachContinue ? CF.activeCoaching(prevConversation) : null;
      const researchFromFlow =
        continuity.reason === "external" && CF.leansOnTopic(data.message)
          ? CF.activeCoaching(prevConversation)
          : null;
      const informationOnly =
        !coachContinue && (await import("./research")).isInformationOnly(data.message);
      const personalContext = (await import("./research")).needsMemberContext(data.message);
      const coachFirst =
        coachContinue ||
        (!informationOnly && CF.isCoachFirst(data.message, { learning: learningIntent }));
      // A research detour inside a coaching flow searches for that topic ("quit smoking ... support near me").
      (ctx as { memberText?: string }).memberText = researchFromFlow
        ? `${researchFromFlow.topic.replace(/[.!?\s]+$/, "")}. ${data.message}`
        : data.message;
      (ctx as { turnStarted?: number }).turnStarted = turnStarted;
      setStage(TB0.STAGE_THINKING);
      void coachingBrief;
      // Plexecute knowledge: the message's areas plus every routed specialist's areas, semantic + lexical.
      const KR = await import("@/lib/knowledge-routing");
      const MI0 = await import("@/lib/mission");
      // A continuing coaching answer ("mornings and stress are hardest") is read with its topic for knowledge.
      const kText = coachingFlow ? `${coachingFlow.topic}. ${content}` : content;
      const kRoute = coachingFlow ? LI.routeDomains(kText) : route;
      const kDomains = KR.knowledgeDomains(kRoute.domains, MI0.routeExperts(kText, kRoute.domains));
      const KS = await import("@/lib/knowledge.server");
      const turnKnowledge = await KS.retrieveForTurn(supabaseAdmin as never, kText, {
        domains: kDomains,
        today: new Date().toISOString().slice(0, 10),
        userId,
      });
      const brief = { text: KS.knowledgeBlock(turnKnowledge) };
      ctx.evidenceRefs.push(...turnKnowledge.evidence.map((e) => e.chunk_id));
      (ctx as { turnKnowledge?: unknown }).turnKnowledge = turnKnowledge;
      if (route.multiDomain)
        ctx.areas = [
          ...route.domains.filter((d) => d !== "goals").map((d) => d.replace(/_/g, " ")),
          ...(route.context.includes("work_schedule") ? ["the work pattern"] : []),
        ];
      if (route.multiDomain) {
        const { supabaseAdmin: intelAdmin } = await import("@/integrations/supabase/client.server");
        void intelAdmin
          .from("intelligence_events")
          .insert({ user_id: userId, kind: "multi_domain", detail: { n: route.domains.length } })
          .then(
            () => {},
            () => {},
          );
      }
      const actionClass =
        informationOnly || coachFirst
          ? { execution: false, actions: ["ANSWER"], loop: null }
          : LI.classifyActions(data.message);
      // Workout difficulty feedback is applied deterministically before the model replies, so it is never only promised.
      let effortNote = "";
      if (
        (await import("@/lib/training")).effortFeedback(data.message) &&
        /\b(workout|session|training|circuit|it|that)\b/i.test(data.message)
      ) {
        const { supabaseAdmin: eAdmin } = await import("@/integrations/supabase/client.server");
        const { data: tzp } = await eAdmin
          .from("profiles")
          .select("timezone")
          .eq("id", userId)
          .maybeSingle();
        const r = await (
          await import("@/lib/execution-queue.server")
        )
          .updateExecutionTask(
            { db: supabase, userId, tz: tzp?.timezone ?? null, memberText: data.message },
            { status: "done", outcome_note: data.message.slice(0, 300) },
          )
          .catch((e: unknown) => ({ error: String((e as Error)?.message ?? e) }));
        const st = (r as { status?: string }).status;
        if (st)
          effortNote = `\nWorkout feedback (internal, already applied, do not call update_execution_task, change_training_programme or edit_plan for it): ${JSON.stringify(r).slice(0, 1500)}. Tell the member in one or two lines exactly what changed (exercise, old → new) and when the next workout is.`;
      }
      // Learning intent goes into the real Learning system, never a generic study plan.
      const LS = await import("@/lib/learning-subject");
      const intents = LS.splitIntents(data.message);
      const multiIntent = intents.length > 1 || intents.some((p) => p.text.includes(" and "));
      const learnPart = intents.find((p) => p.system === "learning");
      const learnNote = LS.isLearningIntent(data.message)
        ? `\nLearning intent (internal, never mention it): the member wants to learn a subject${learnPart?.subject ? ` ("${learnPart.subject}")` : ""}. This overrides the mission clarify step: your FIRST tool call this turn must be build_learning_pathway (do not ask what success looks like or where they are starting from first; do not call advance_mission before it). Call build_learning_pathway with ONLY the subject being learned in their own words (include context such as "for my app"; never include the other requests in the message), the level if stated, and any stated study time/length. Do not give generic advice or your own syllabus instead. From its result: "I've built this in Learning for you", the real resources it found (by name), the first study session and its time, and that they can open it in Learning or continue here. If it reports reused, say the existing pathway was used. If it fails, say so plainly.`
        : "";
      const multiNote = multiIntent
        ? `\nMULTIPLE REQUESTS (internal, never mention it): this one message contains several requests (${intents.length} area(s)) and EVERY one must be handled with real tools this same turn, not just the first:\n${intents
            .map(
              (p, i) =>
                `${i + 1}. "${p.text}" -> ${
                  p.system === "learning"
                    ? "build_learning_pathway (Learning system)"
                    : p.system === "nutrition"
                      ? "nutrition (a direct request: this overrides the mission clarify step; do NOT call advance_mission or ask what success looks like first): get_nutrition_context, then plan_meal_prep EXACTLY ONCE (the meal engine; works with no saved meals or inventory, pass kcal and protein_g from their saved targets or sensible healthy defaults stated as assumptions; never use propose_meal_plan for this), then schedule_meals EXACTLY ONCE with from_meal_plan true so the meals are on their daily plan. The saved meal plan is the result: do not create a goal (propose_new_goal) for it, and do not call request_replan, propose_meal_plan or a second plan_meal_prep/schedule_meals unless they asked for it. Afterwards offer at most one optional refinement question"
                      : "research_topic for exactly this request, then read its exact research_id with get_research_findings. Answer with useful source-backed options, verified facts and unknown details. Finding options alone does not authorise tasks: schedule only when the member also requested execution; never create a duplicate goal"
                }`,
            )
            .join(
              "\n",
            )}\nAfter one tool finishes, continue to the next request's tools; do not end the turn until every request has its tool result. Never create a second goal, pathway or duplicate task for the same subject (reuse what get_goals / earlier tool results return). Reply ONCE, combined, with a short section per request in this order, each stating only what its tool result shows was saved or found; if one failed, say which one plainly.`
        : "";
      const execNote =
        learnNote +
        multiNote +
        (!actionClass.execution
          ? ""
          : actionClass.loop === "outcome"
            ? `\nExecution loop (internal): the member is reporting on the task they are working on. Call update_execution_task straight away (for a workout too; do not also call log_movement for the same session; put feedback like "too easy" in outcome_note; the tool itself makes the next workout harder or easier and returns progression — tell the member exactly what changed from progression, and if it says NO_NEXT_WORKOUT build the next one harder now; never just promise a change) (status done, partial, skipped or blocked; metric_label/metric_value for numbers like "15 signups"; reason for a failure such as "promotion not allowed"). The tool rolls the result up to the mission (and to the goal once it is active) itself, so do not also call record_progress for the same number; if it returns ALREADY_RECORDED, do not count it again. Then: one line acknowledging the real result, how it changes the remaining queue (move similar destinations earlier after a strong result; drop or reword similar ones after a removal), and hand them next_task in full (where, link, rule, prepared copy, done when). Never reply with only praise.`
            : actionClass.loop === "pause"
              ? `\nExecution loop (internal): the member is stopping for now. Call update_execution_task with status pause_rest (resume_time if they said one), and if a mission exists call advance_mission with a checkpoint of where they stopped. Reply with what moved to tomorrow and the first task they will resume with. No lecture.`
              : `\nExecution escalation (internal, never mention it): this message is EXECUTION INTENT, not a request for advice. Required response: ${actionClass.actions.join(" -> ")}${actionClass.loop === "now" ? " (immediate execution mode: they want to start now)" : ""}. Do NOT reply with general advice, generic tips, a generic checklist or questions about facts already given. First extract every fact already stated in this conversation (time available e.g. "all day today" or "an hour now", budget e.g. "free" = zero budget, stage e.g. "pre-launch", channel e.g. "organic", product description) and treat them as known; never ask for them again. Then in this same turn: 1) get_goals (and get_mission) and reuse the existing matching goal/mission (advance_mission with its mission_id, the new facts as contract, to_state moving forward e.g. SCHEDULED); create a goal only if none matches, and never for a one-off day of work on an existing goal. 2) If RESEARCH is listed and current outside facts matter (places, channels, requirements, providers), call research_topic and then get_research_findings; name only places the findings support and say "check the rules before posting" where a rule was not found; never claim promotion is allowed without evidence. For fitness use the training tools (build_workout); for learning use the learning context and real resources. 3) Call schedule_execution_queue (with mission_id when a mission exists; all_day true for "all day"; window_end for the stated end) for the stated window, using the whole window (an otherwise free all-day = roughly now until 21:00 with breaks, never stopping mid-afternoon without a reason), with execution-ready tasks (exact title, destination, link only if real, rule, exact action, first step, prepared copy ready to paste, done when, what to record). 4) Reply following this order: what you understood (one line with the facts), what you have set up (the queue times and destinations the tool returned), then start the FIRST task now in full: where, link, rule, the prepared copy, and "tell me done (and any result) and I'll record it and give you the next one". Never schedule work that rests on a guessed fact that decides what the work is (e.g. revenue reviews for a company whose stage you do not know): if such a fact is unknown and the conversation does not give it, ask that one question instead of scheduling. When new facts make already-queued tasks wrong, call schedule_execution_queue with replace_open true. When the message names several areas (e.g. train, study and business tonight), schedule every area now in one queue around the real schedule with no overlaps, reusing existing sessions for those areas, and never hold the whole evening back for a detail about one area. For job applications, RESEARCH is required: call research_topic for the role's current requirements before writing CV or application tasks, and use the findings in them. Ask at most ONE question, only for a genuinely critical missing fact (e.g. their signup link), while still doing everything else now; put the placeholder [your link] in prepared copy until they give it. Only say scheduled, researched or created if the tool result shows it.`);
      const intelNote = `Internal routing (never mention it): areas ${route.domains.join(", ") || "general"}${route.context.length ? `; also consider ${route.context.join(", ")}` : ""}. ${route.multiDomain ? `This request spans several areas: in your reply, address each relevant one in plain words (e.g. ${route.domains.map((d) => d.replace(/_/g, " ")).join(", ")}${route.context.includes("work_schedule") ? ", and how it fits the work pattern" : ""}) as one joined-up plan. ` : ""}Capability for this request: ${capability.cls} (${capability.note})${capability.nextStep ? ` Next step to offer: ${capability.nextStep}` : ""}.${intent === "capability_question" ? " Intent: the member is asking WHETHER Plexecute can do this, not asking for it now. Answer the question directly and confidently (what Plexecute does, how it works, what it needs from them), then offer to do it. Do not call find_appointment, choose_appointment, schedule a call or any other action tool this turn, and never say you started something." : ""}
Life intelligence rules: for goals spanning several areas, give ONE joined-up pathway, not separate answers per area; even when you save or propose a goal, briefly say how each relevant area fits together around their real constraints (for example food, training and sleep around a shift pattern). Before advising on progress, priorities, focus, competing goals, repeated misses or the 5-year direction, call get_life_intelligence and use only what it returns: if it lists a conflict, name it with the numbers and follow its reconciliation: for ask_member, end by asking that question; for suggest_only, give the suggestion and its reasons and let them choose; never assume both are funded or fit. Never schedule or describe downstream steps as if open prerequisites were done. Say "on track" or "behind" only from its projections; if it says not enough data, say so plainly and never invent patterns or trends. State confidence (High/Medium/Low) and what is assumed or unknown only when it changes the member's decision. Use explain_plan_item for "why is this on my plan?", brief_my_day for "brief me on my day", review_my_week for "how did my week go?". When the member agrees to change the plan because of a repeated-miss pattern or the weekly review, call request_replan (the planner already avoids proven failure times), or edit_plan for specific moves; do not use request_calendar_change for this. You are always the Coach; every tool (research, planner, learning, training, nutrition, finance, bookings, calls, missions) works for you, and its result is raw material, never your answer: interpret it, check it against Plexecute knowledge and what you know about the member, then reply in your own voice with what it means for them, what happens first and what Plexecute has handled. Never paste tool output, lists of links, repeated domains, search snippets or source blocks; link only the one to three sources that back a specific claim, inline. Report an action as done only when its result shows it happened. Hobbies, rest and social time need no link to the 5-year direction. When advice can become an action Plexecute supports, offer that step (add as goal and build the pathway, fit sessions around commitments, book, schedule a call); if the capability is MEMBER_MUST_ACT, PROFESSIONAL_REQUIRED or UNSUPPORTED, say so honestly and offer what Plexecute can do instead.`;
      // Goal Mission: hidden expert routing + any proactive mission note saved by the hourly scan.
      const MI = await import("@/lib/mission");
      const bc = String(
        (profile as { billing_country?: string | null } | null)?.billing_country ?? "",
      )
        .trim()
        .toUpperCase();
      const memberCountry =
        bc === "GB" ? "the United Kingdom" : bc === "US" ? "the United States" : bc || null;
      const experts = MI.routeExperts(content, route.domains);
      const mTier = MI.tierFor(experts);
      let missionSignals = "";
      try {
        const { supabaseAdmin: mAdmin } = await import("@/integrations/supabase/client.server");
        const sigs = await (await import("@/lib/mission.server")).pendingSignals(mAdmin, userId);
        if (sigs.length)
          missionSignals = ` Proactive mission notes to raise briefly if relevant (real, from saved data): ${sigs.map((x: { message: string }) => x.message).join(" ")}`;
      } catch {
        // Mission notes are optional context; the reply goes ahead without them.
      }
      const missionNote = `
Mission rules (internal, never name experts, stages or tools): every substantial goal or dream is a Goal Mission. Specialists relevant here: ${experts.join(", ") || "none"}; depth ${mTier}. ${mTier === "complex" ? "Run an internal council: reason from each listed specialist in turn (career, business, finance, time, risk...), note where they disagree, reconcile into ONE plan, and save it with advance_mission council (views with binding constraints and urgency, selected_route, alternatives, assumptions). Present one coherent plan, never several competing answers. " : mTier === "moderate" ? "Combine the two or three relevant specialisms into one plan. " : "Use the single relevant specialism; keep it light. "}For a new substantial goal call advance_mission (title, member_text) first. If it returns clarifying_questions and the member gave a vague dream, ask only those (max 3) and do not build a plan yet; never define the dream for them. If it returns start_now true, follow its instruction instead: start the session now and ask at most one question at the end. For an existing company or product, its stage (pre-launch, or launched with users/revenue) decides what the work is: until the member has said it, do not call propose_new_goal, draft_goal_pathway, request_replan or schedule anything; save what they told you (advance_mission contract) and ask only for the stage in one short question. As they answer, save facts with advance_mission contract. When next_needed includes research_topic, research before planning (research_topic, then get_research_findings) and never invent requirements or links. Where real alternative routes exist, give 2-3 options to advance_mission options with member_factors, recommend its top-ranked route and say why in plain words. Label blockers via advance_mission blockers and offer the route around them. Before building or rebuilding any plan, save every recurring boundary the member stated (job hours, weekends with family, children's bedtime routine, care duties) with protect_recurring_time, so the planner cannot place work there (and when the member offers specific days or times FOR the goal, e.g. "Monday, Wednesday and Thursday evenings", set them on the saved goal with update_goal days_of_week/start_time/sessions_per_week before the rebuild — never protect them); e.g. "kids' bedtime 7:30pm" protects roughly 17:30-19:45 on those days unless they gave the window, and "weekends are family time" protects days 6 and 7 all day. Then build the pathway (draft_goal_pathway / accept_goal_pathway or the domain tools), schedule it, and advance the stage (PATHWAY_READY, then SCHEDULED). Every scheduled action must be execution-ready: objective, exact action, first step, minutes, what counts as done, evidence, next action; never "work on X". For "what next / why this way / what's blocking me / am I on track / what changed / find another route / I can't afford it / I only have N hours now / what tonight", call get_mission first and answer from it (for "why did you plan it this way?" use its decision_basis (by source: member facts, Plexecute knowledge ids, research, planning rules), decision_record, plan_rationale, knowledge_basis and adaptations only, naming each reason's source in plain words; never invent a reason); for changed time, money or dates, update the contract (advance_mission to_state ADAPTING), then request_replan. For "I have too much to do tonight", overwhelm about today or "sort out my evening", call triage_tonight FIRST (it reads tonight's plan, commitments, priorities and deadlines, calculates real free time and reorganises); never open by asking what is due. Only if it returns NOTHING_PLANNED_TONIGHT ask one question about what is due. Then say "I checked what you already have tonight and reorganised it", list free time, what stays (times), what moved to tomorrow and why, and start the first action. For "why did you plan it this way?" about tonight, answer from that result's basis. For "why do I keep missing this?" or repeated misses, call fix_repeated_misses (it reads the history, the cause and the Plexecute knowledge and applies the change when the member agrees); fix the cause (shorter sessions, new time, prerequisite first) instead of just moving sessions. Never call a mission achieved without a completed goal.${missionSignals}`;
      const system = `You are the Plexecute coach, one persistent coach across every area. Plexecute's line: "Plan your life. Execute the plan."
Coaching style: ${stylePrompt(profile?.coaching_style)}
${MODE_PROMPT[data.mode]}
Sections: TRAINING covers strength, bodyweight, cardio and conditioning (build_workout, get_cardio_session, explain_exercise); WELLNESS & MOVEMENT covers yoga, mobility, stretching/recovery, meditation and breathing (get_mobility_session, find_guided_videos, log_wellness). Never send a workout, run or bodyweight request to Wellness, nor yoga, mobility, stretching or meditation to Training; name the section in your reply. Rules: use the tools to read real data and run real engines; never invent the member's data, plans, sessions or saved targets. Standard evidence-based coaching figures (energy needs from estimate_energy_needs, protein per kg, surplus for lean gain, sets and progression) are expected expertise: state them as your recommendation. You execute what the user asks through the action tools, never just advise: commitments (schedule_commitment, update_commitment, remove_commitments), calls (reschedule_scheduled_call, cancel_scheduled_call, get_call_readiness; set up calls right here in chat with start_phone_verification, confirm_phone_code and give_call_consent, never sending the member to another page), sessions and days (edit_plan to move, remove or clear; request_replan to rebuild), goals and milestones (propose_new_goal, update_goal, delete_goal, add_milestone, update_milestone), deleting a week plan (delete_plan), journal (add_reflection, record_progress, add_checkin, add_daily_log), availability (update_availability), movement, wellness, meals, learning and food (log_movement, log_wellness, set_wellness_preferences, guided yoga or meditation videos to follow now via find_guided_videos (list each returned title, creator, minutes and why it fits; never invent links), recurring yoga or meditation practices via add_wellness_practice, propose_meal_plan (saved-meal plans), meal prep from the food they have (add_food_inventory, update_food_inventory, plan_meal_prep, edit_meal_prep, accept_meal_prep, log_planned_meal, set_meal_preferences; always use plan_meal_prep for meal plans and never invent meals or numbers), calories and macros eaten, left or planned on any day (get_nutrition_status, which counts only logged food), add_learning_item, log_food after search_food; meal photos: get_meal_estimate, correct_meal_estimate when the member corrects it, log_meal_estimate only when they say to log it, always calling the result an estimate with ranges and passing on any open question), research (get_research_findings), strength training (build_workout for any workout request, never a video search; explain_exercise for how-to, "exercise 2" or demonstration questions, sharing only the returned link; get_training_programme, substitute_exercise, change_training_programme), mobility (log_mobility), routines and habits (get_routines, then the tool it names), and connected devices (get_connected_devices, sync_connected_device, disconnect_connected_device). Look up real ids first with get_plan, get_today, get_goals or get_schedule_context; never invent ids. The member's own instruction in chat is their confirmation: when they tell you to do something, the tools apply it at once (authorised_by member_instruction, applied, accepted, done). Never ask them to confirm, accept or approve again, and never send them to another page (Goals, Nutrition, Plan, Training) to finish something you can do here. Only if a tool returns awaiting_member_confirmation (permanent deletions, or when they had not actually asked) say that one press of Confirm below does it. For "clear and rebuild" requests, save any new commitment first, then call request_replan. To put a diet or meal plan onto the daily plan (meal times, eating reminders, reminder calls to eat), call schedule_meals with the planned meals and times; never say meals cannot go on the daily plan. When the user mentions a dated appointment, meeting, exam, deadline or asks to be called or rung before something, call schedule_commitment (pass the day words exactly as said, e.g. "tomorrow", "friday", "next monday"); it saves for real, so confirm exactly what the tool returned (day, time, call time) and if the call result says calls_will_ring is false, name each blocker honestly and fix the member-side ones in chat; never say calls are switched on unless calls_will_ring is true. Call get_schedule_context before answering about the user's schedule. When the user asks for a brand-new goal, call propose_new_goal (never propose_goal_change with an invented id); use update_goal for concrete changes to an existing goal. If a tool returns an error, say what went wrong instead of claiming success. Equipment: only plan with kit the member has told you they have (or their programme records); otherwise use bodyweight and never mention dumbbells, kettlebells, bands or a gym. Context: before asking what a goal means (e.g. what "fitter" means), read the mission contract, goal title and earlier messages; if they already say it, use it and never ask again. One task per real action: never add two near-identical tasks for the same place. Workout difficulty feedback ("too easy", "too hard") goes to update_execution_task status done with the feedback in outcome_note, which records the workout and changes the programme; never rebuild the programme with change_training_programme for it. Execution over advice; end with one concrete next action tied to the plan. Never use guilt, shame or pressure. No medical diagnosis; for health concerns suggest a professional. Do not use em dashes. Keep replies under 220 words. Format like a friendly expert: open with one short warm line, and when you give a plan, steps or options use a numbered list where each item is a **short bold title** followed on the same line by a dash-free short sentence after a colon.
Finish every part in this same turn, never half: for training on set days/times (e.g. "7am Monday to Friday") call change_training_programme (or update_goal for an existing training goal) with days_of_week and start_time, then request_replan with call_for_sessions "training" when they want calls for sessions (it plans this and next week and books a call per session); for a body-change diet call estimate_energy_needs then plan_meal_prep with that kcal and protein_g, then schedule_meals with from_meal_plan true. Report the days, times and calls the tools returned.
Expert voice: speak like a top personal coach and nutritionist who has just done the work: confident, specific, decisive. Lead with what is now set up and on their plan (days, times, meals, calories, protein, sessions), then the expert reasoning in one or two lines, then one next step. Never narrate internal mechanics or limitations (no "engine", "tool", "proposal", "calendar reminders", "default targets", "I haven't changed", "I can't honestly call this") and never list things you did not do or facts that don't matter to this request (such as an unset five-year direction); if something genuinely failed, say it in one plain sentence and what you did instead. If a key fact is missing (for example weight), make a sensible expert assumption, say it in a few words, act on it and offer to fine-tune.
Whole-plan requests: when the member asks for a diet and/or training plan put on their daily and weekly plan, do all of it in this turn, in this order: 1) estimate_energy_needs and change_training_programme for the training they described with preferred_time (morning for 'when I wake up'); the programme is their training goal, so do not also create a training goal; 2) plan_meal_prep with kcal and protein_g; 3) schedule_meals with from_meal_plan true (omit the breakfast time when they train before breakfast so it is placed after the session; call_reminders if they want reminder calls); 4) request_replan last so sessions land on the plan around the meals. If they give a weight, also log_user_statement weight_kg. Report the real session times request_replan placed; if some could not fit, say which and offer the fix (e.g. an earlier wake time).
Execute until the goal: a plan is not one week. request_replan keeps planning every following week (keep_going, with goal_id) and keeps booking the session calls; a diet for a body change uses schedule_meals with until_goal true, goal_id and target_weight_kg (e.g. 75 for "65kg to 75kg") so the meals and their calls roll on weekly until they reach it. Say plainly that it continues until the goal is reached. Never save the member's own training (gym, circuits, workouts) with schedule_commitment: it would block the plan's own training slot; training always comes from change_training_programme + request_replan. When they name exercises ("pull ups, dips, push ups, squats, burpees and abs") pass them in change_training_programme exercises (keep their days and time) and report the exercises_in_every_session it returns. Days they can't train (e.g. "not Saturday and Sunday, my sons' football") go in days_of_week; "starts tomorrow" needs nothing extra, the planner never places sessions in the past. Never end by asking whether to fix something you could fix yourself now: fix it in this turn, then report.
Plan clean-up: get_plan and get_today list only live entries; older copies replaced by a newer plan are history and are never duplicates. For "remove duplicates", "clean up" or "remove/delete these": pause or complete true duplicate goals with update_goal (two goals for the same thing, e.g. two active training goals; the training programme is not a goal and never duplicates the goal marked holds_training_programme, which must stay active), remove unwanted single sessions with edit_plan, then request_replan once and report the real times it returned. You can always change the plan: never say you lack access or that plan editing is unavailable. If an exact time still can't be placed, name the real clash from get_schedule_context (work hours, a commitment, wake-up time) and fix what the member asked for (e.g. update_availability for an earlier wake time) in the same turn.
Format: ${MESSAGE_FORMAT}
Coaching method: you are a life coach across personal development, motivation, goals, habits, productivity, career, money, nutrition, exercise, sports mindset, wellbeing, sleep, relationships, learning, decisions and life transitions. Move the member through understand, guide, goal, plan, action, follow-up. Before advising on their life (missed sessions, overload, balance, consistency), read their real data first (get_plan, get_execution_history, get_schedule_context, get_goals, get_journal_context, get_behaviour_patterns) and name the specific pattern you see. Ask one or two sharp questions when the request is vague instead of lecturing. Give specific guidance, not generic encouragement. Never hand back work Plexecute can do itself (finding places, researching, writing the copy, building the checklist, tracking): do it. When the member states an actionable intention, set the work up now; for mere suggestions they have not chosen, offer them. Use evidence_kind honestly: call research "studies suggest", official guidance by its body, and coaching techniques "a technique that helps many people", never as science. Money: general education and budgeting or savings goals only; never recommend specific investments, pensions, credit, insurance or mortgages, and point to a regulated adviser or free guidance for those. Never claim to be a psychologist, doctor, dietitian or financial adviser. For current career requirements, qualifications or licences, use get_research_findings or say you will need to check; never invent them.
Life direction rule: the member's 5-year life direction is the Life Twin fact five_year_vision (get_life_twin). Quote only its current objectives. It is long-term direction, not active goals: when relating it to their goals or week, name a link only where an active goal or session genuinely serves an objective, and say plainly which objectives have nothing active yet (never present those as already in progress). If it is absent or has no objectives, say they haven't set one and never invent ambitions. When they want to start on an objective, use draft_goal_pathway (ask its clarify questions if it returns any) rather than writing your own plan.
Booking rule (Execute): first tell a question from a request. "Can you book taxis?", "Are you able to…", "If I give you the details could you…" are questions about what Plexecute can do: answer them, offer to do it, and start nothing. Only start a booking when they actually ask for one ("book me a taxi to the station now", "yes, go ahead"). anything a business will book by phone or online — any appointment, reservation, taxi, ticket, tradesperson, takeaway or order, listed or not — goes through find_appointment (one call per booking). Never tell the member a booking type is unsupported. For taxis with no pickup given, ask them to tap the location pin to share where they are, and use the shared address as pickup; if no payment is needed it is booked by call with no checkout. Taxis are ordered, not negotiated: the request itself is the authorisation, so call find_appointment with preauthorised true (today, from now or their pickup time), then straight away choose_appointment with method phone. Do not ask the member to approve a wait time; tell them Plexecute is ringing the taxi company now and will tell them how long the car will be. Every phone booking (tables, appointments, taxis, tradespeople, anything) follows one flow: if they haven't given a time range, ask once "Between what times would you like it?" (and the day if unclear). Their answer is the authorisation: call find_appointment with preauthorised true and earliest/latest set to that range, then straight away choose_appointment with method phone and the start of the range. Never ask them to pick or approve a specific time; tell them Plexecute is ringing now and will tell them the booked time. Only come back to them if nothing in their range is available, or payment, a deposit or a fee is needed. If payment, a deposit or a fee is needed, use prepare_checkout with the business's own https checkout page and tell them the amount, deposit, fees and terms; they pay themselves. Never accept, ask for or repeat card details. For a booking request call find_appointment first (it tells you if the member's plan includes booking; if it says Execute is needed, say so plainly) and never search for venues instead. Never say you found options, tables or availability until a tool result lists them; while details are missing, just ask for them. Never say booked, ordered or paid until confirm_appointment succeeds with a real confirmation; an opened or expired checkout is not a booking.
Status wording rule: call a goal or session "active" only when its status is active. Describe proposed goals as proposals awaiting confirmation and paused goals as paused, and never include either in a count of active goals (say e.g. "two active goals and one proposal").
Knowledge rule: for specialist advice use the supplied Plexecute knowledge (or get_knowledge_evidence) as your own expertise; cite it inline like [WHO, 2020] only when the member asks for evidence or sources. Never prefer a T3/T4 source over T1/T2. If it returns uncertainty or nothing, say plainly you are not certain. Safety evidence overrides everything else. If a tool says it needs Pro/Execute or an allowance is used, tell the user plainly.
Current time: ${new Date().toISOString()} UTC; the member's local time is ${new Date().toLocaleString("en-GB", { timeZone: profile?.timezone || "Europe/London", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} (${profile?.timezone ?? "Europe/London"}). Always speak and calculate in their local time.${memberCountry ? ` The member is in ${memberCountry}: use it as their jurisdiction for services, rules and research, and never ask what country they are in.` : ""} For "in N minutes/hours" calls or reminders, pass in_minutes to schedule_commitment instead of working out a clock time.
${intelNote}${effortNote || execNote}${missionNote}${coachingFlow ? `\n${CF.coachContinueNote(coachingFlow)}` : coachFirst ? `\n${CF.COACH_FIRST_NOTE}` : ""}${safetyNote}
Universal answering rules (override execution/mission instructions for information questions): understand EVERY request first: advice, factual information, current information, research, learning, planning, comparison, execution or mixed. Use relevant supplied Plexecute knowledge AND your general reasoning; an absent library passage never means no useful answer exists. Automatically call research_topic when needed for current, external, changing, location-specific or library-uncovered factual information (jobs, qualifications, courses, businesses, prices, regulations, products/services, travel, support services, websites/communities, opening times, recent information). Do not require the member to ask for internet search. For stable concepts or general behaviour advice, library knowledge plus reasoning normally suffice: do not search unnecessarily. Use relevant saved context only where it changes the answer; a general conceptual question needs no personal-state reads. For repeated study misses read learning/schedule/execution history selectively, not unrelated nutrition, finances or family data. Synthesize knowledge, member facts, reasoning and research into one useful answer, not raw passages or a search-result dump. Name real research sources with their returned links, distinguish verified facts, partially checked discoveries and unknown details; never invent prices, eligibility, availability, posting rules or employer demand. Research already retries weak discovery once; missing verified quotes alone is not a reason to discard its real sources. If research genuinely fails, say what failed and still use reliable knowledge/context/reasoning without pretending you checked current facts. Do not redundantly call get_knowledge_evidence when supplied passages already support the answer. ${informationOnly ? "THIS TURN IS INFORMATION/ADVICE/DISCOVERY ONLY: answer all parts; use live research when needed, but DO NOT create goals, missions, pathways, plans, tasks, commitments or calls. 'Find options' authorises research, not scheduling. No mission clarification before answering. End with a useful next step, not a claim that work was scheduled." : "Only run actions for the parts the member requested execution on; questions within mixed messages remain questions."}`;

      type Msg = {
        role: string;
        content: string | null;
        tool_calls?: unknown;
        tool_call_id?: string;
      };
      const convo = (history ?? []).reverse().map((m) => ({ role: m.role, content: m.content }));
      // This turn's knowledge sits right before the member's message so earlier turns (e.g. a past lookup
      // failure) or long tool output cannot displace it.
      const messages: Msg[] = [
        {
          role: "system",
          content: informationOnly
            ? `You are Plexecute's expert Coach across all life subjects. Answer this information/advice/discovery question, all parts, in under 220 words. ${memberCountry ? `The member is in ${memberCountry}; use that jurisdiction and never ask their country. ` : ""}${stylePrompt(profile?.coaching_style)} ${MESSAGE_FORMAT}. Use the supplied existing knowledge when relevant, and reason rather than repeating passages. Live research is required for current/external/changing/location-specific facts or factual gaps; general behaviour advice and stable definitions normally need no search. No library match is not proof that no information exists. Call research_topic automatically when needed using a concise focused query (roughly 8–18 words), no long instruction paragraphs, no assumed stage/audience. Split distinct external questions into focused searches rather than one overlong query. If results miss an important part, retry ONCE with an alternative focused query for that missing part. Read exact research_id, or use the sources/interpretation already returned; never repeatedly read unrelated history. Retain useful partially checked discoveries and explicitly mark unknown details; verify fees, availability and eligibility before claiming them. Distinguish library sources, general reasoning, member facts and current external sources; cite only sources actually provided. Combine sources into a useful answer and concrete next step. Do not create missions, goals, tasks, plans or calls. No clarification-first mission flow for questions. ${personalContext ? "Selectively read only records relevant to this question. For missed study sessions use learning context, schedule and execution history, not a whole-life snapshot. Never infer a miss cause or adherence pattern from absent records alone." : "This is a general question: do not read member records or refer to personal goals. Answer it directly using knowledge/reasoning/research as appropriate."} If research fails, say it failed, use reliable information still available and never claim current facts were checked. ${safetyNote}`
            : system,
        },
        // A research request made inside a coaching flow keeps that conversation, so "support near me" means
        // support for the topic being coached.
        ...(informationOnly && !personalContext && !researchFromFlow ? [] : convo.slice(0, -1)),
        ...(researchFromFlow
          ? [
              {
                role: "system",
                content: `This request comes inside the coaching conversation about "${researchFromFlow.topic}". Research for that topic and the facts the member gave (use them in a focused query); do not ask what kind of help they mean when the conversation already says.`,
              },
            ]
          : []),
        { role: "system", content: brief.text },
        ...convo.slice(-1),
      ];
      // "Yes, change it" right after a missed-session diagnosis applies that exact fix (cause, knowledge, rebuild,
      // saved rationale) instead of an ad-hoc goal edit.
      const preTrace: { tool: string; ok: boolean }[] = [];
      {
        const { data: lastA } = await supabase
          .from("coach_messages")
          .select("tool_trace")
          .eq("role", "assistant")
          .order("created_at", { ascending: false })
          .limit(1);
        const prevTools = (((lastA ?? [])[0]?.tool_trace ?? []) as { tool: string }[]).map(
          (t) => t.tool,
        );
        if (
          prevTools.includes("fix_repeated_misses") &&
          /^\s*(yes|yeah|yep|ok(ay)?|sure|do it|go ahead|please do|change it|apply it|fix it)\b/i.test(
            data.message,
          )
        ) {
          const r = await runTool(ctx, "fix_repeated_misses", { apply: true });
          preTrace.push({ tool: "fix_repeated_misses", ok: !(r as { error?: string })?.error });
          messages.push({
            role: "system",
            content: `The member agreed, so the diagnosed fix was applied now. Result: ${JSON.stringify(r).slice(0, 5000)}. Report exactly what changed and the new session times from this result; do not call update_goal or fix_repeated_misses again.`,
          });
        }
      }
      const tools = TOOL_DEFS.filter(
        (t) =>
          !informationOnly ||
          (t.name.startsWith("get_") &&
            (personalContext ||
              t.name === "get_research_findings" ||
              t.name === "get_knowledge_evidence") &&
            t.name !== "get_life_intelligence") ||
          t.name === "research_topic" ||
          t.name === "explain_plan_item" ||
          // Read-only how-to for the member's own exercises ("How do I do exercise 2?").
          t.name === "explain_exercise" ||
          t.name === "get_knowledge_evidence",
      )
        .filter((t) => !coachFirst || !CF.COACH_FIRST_BLOCKED.test(t.name))
        .filter((t) => !coachingFlow || CF.coachContinueAllows(t.name))
        .map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      const offeredTools = new Set<string>(tools.map((t) => t.function.name));
      // Recurring boundaries stated in plain words (work hours, family weekends, children's bedtime) are saved
      // before any planning so the deterministic planner can never place work over them.
      {
        const bs =
          informationOnly || coachFirst
            ? []
            : (await import("./boundaries")).extractBoundaries(data.message);
        const saved: string[] = [];
        for (const b of bs) {
          const r = await runTool(ctx, "protect_recurring_time", b as never);
          preTrace.push({ tool: "protect_recurring_time", ok: !(r as { error?: string })?.error });
          if (!(r as { error?: string })?.error)
            saved.push(`${b.title} (${b.start_time}-${b.end_time})`);
        }
        if (saved.length)
          messages.push({
            role: "system",
            content: `Already saved as protected time from the member's words (the planner keeps work out of it): ${saved.join("; ")}. Do not save them again.`,
          });
      }
      const trace: { tool: string; ok: boolean }[] = [...preTrace];
      const researchAudit: unknown[] = [];
      let reply = "";
      // Life Twin inference only reads the member's message, so it runs alongside the reply instead of after it.
      const twinP =
        msgId && !informationOnly
          ? (async () => {
              try {
                const { inferTwinFacts, recordTwinObservation } = await import("@/lib/twin.server");
                for (const o of await inferTwinFacts(apiKey, data.message, msgId, userId))
                  await recordTwinObservation(supabaseAdmin, userId, o);
              } catch (e) {
                console.error("twin inference skipped", e);
              }
            })()
          : Promise.resolve();
      try {
        // Changes that alter what should be on the week; when the member instructed them, the week is rebuilt before replying.
        const RESHAPES = new Set([
          "propose_new_goal",
          "update_goal",
          "change_training_programme",
          "schedule_commitment",
          "draft_goal_pathway",
          "protect_recurring_time",
        ]);
        // Meal plans place their own meals (schedule_meals); a week rebuild would add unrequested prep/routine entries.
        const instructed = (await import("./life-intelligence")).memberInstructed(data.message);
        let autoReplanned = false;
        // Missions (research → goal → pathway → schedule) need a few more rounds than ordinary requests.
        const MAX_ROUNDS = 11;
        let extra = 0;
        let autoPathway = false;
        let autoTasks = false;
        // Time budget: research only early in the turn, and after the reply deadline Coach answers with what it has.
        const TB = await import("./coach-turn-budget");
        let budgetNoted = false;
        const overBudget = () => TB.turnPhase(Date.now() - turnStarted).mustReply;
        for (let round = 0; round < MAX_ROUNDS + extra; round++) {
          const turnBudget = TB.turnPhase(Date.now() - turnStarted);
          if (turnBudget.mustReply && !budgetNoted) {
            budgetNoted = true;
            messages.push({
              role: "system",
              content:
                "Reply to the member now using only the tool results you already have. Do not promise to come back later. If something is still unchecked, say so briefly and offer to look into it next.",
            });
          }
          const out = await callTools(
            apiKey,
            messages,
            turnBudget.researchAllowed
              ? tools
              : tools.filter(
                  (t) => (t as { function: { name: string } }).function.name !== "research_topic",
                ),
            round === MAX_ROUNDS + extra - 1 || turnBudget.mustReply,
            userId,
            AbortSignal.timeout(TB.msLeft(turnStarted, TB.COACH_CALL_DEADLINE_MS) ?? 1_000),
          );
          if (!out.tool_calls?.length) {
            // "Go ahead and build it" with a mission open but nothing built: build the pathway now (the member's
            // instruction is the confirmation) rather than ending the turn with an unsaved plan.
            if (
              /\b(go ahead|build it|build (me )?the plan|set it up|do it|put it (all )?on my plan|make it happen)\b/i.test(
                data.message,
              ) &&
              !autoPathway &&
              !overBudget() &&
              trace.some((t) => t.tool === "advance_mission") &&
              !trace.some(
                (t) =>
                  t.ok &&
                  [
                    "draft_goal_pathway",
                    "propose_new_goal",
                    "change_training_programme",
                    "schedule_execution_queue",
                    "schedule_meals",
                    "triage_tonight",
                    "fix_repeated_misses",
                  ].includes(t.tool),
              )
            ) {
              const { data: om } = await supabaseAdmin
                .from("goal_missions")
                .select("id,title,goal_id,state")
                .eq("user_id", userId)
                .is("goal_id", null)
                .neq("state", "ACHIEVED")
                .gte("updated_at", new Date(Date.now() - 15 * 60000).toISOString())
                .order("updated_at", { ascending: false })
                .limit(1);
              const m = (om ?? [])[0];
              if (m) {
                autoPathway = true;
                extra += 2;
                const r = await runTool(ctx, "draft_goal_pathway", {
                  goal: `${m.title} — ${data.message}`.slice(0, 400),
                });
                trace.push({ tool: "draft_goal_pathway", ok: !(r as { error?: string })?.error });
                messages.push({ role: "assistant", content: out.content ?? "" });
                messages.push({
                  role: "user",
                  content: `[System: the member told you to build it, so the pathway was built now. Result: ${JSON.stringify(r).slice(0, 6000)}. If it saved a goal, continue: schedule it (request_replan) and give the first executable step. If it returned clarify questions or infeasible, say so truthfully.]`,
                });
                continue;
              }
            }
            // "Find places to promote my waiting list" is an execution request: research alone is not the result.
            if (
              !autoTasks &&
              !overBudget() &&
              !informationOnly &&
              intents.some(
                (p) => p.system === "research_execution" && LS.isActionableResearch(p.text),
              ) &&
              trace.some((t) => t.ok && t.tool === "research_topic") &&
              !trace.some((t) => t.ok && t.tool === "schedule_execution_queue")
            ) {
              autoTasks = true;
              extra += 2;
              messages.push({ role: "assistant", content: out.content ?? "" });
              messages.push({
                role: "user",
                content: `[System: the member asked you to DO this ("${intents.find((p) => p.system === "research_execution" && LS.isActionableResearch(p.text))?.text}"), so research alone is not enough. Call schedule_execution_queue now with day "tomorrow" and 2-4 tasks for the best-fitting channels the findings support, ranked by fit to the product and its audience, never just because they are free, and no local business directories for an online product (each: title, start_time between 09:00 and 18:00, minutes, destination, link from the findings, rule (known posting rule, or "check the community rules before posting"), action, done_when), linked to the same goal as the related request (goal_id from earlier tool results; never create a new goal). Then write one combined reply stating the real task times it returned.]`,
              });
              continue;
            }
            const reshaped = trace.some((t) => t.ok && RESHAPES.has(t.tool));
            if (
              !informationOnly &&
              (instructed || trace.some((t) => t.ok && t.tool === "advance_mission")) &&
              reshaped &&
              !autoReplanned &&
              !trace.some((t) => t.tool === "request_replan")
            ) {
              extra += 1;
              // Days the member offered for this goal become the new goal's preferred days before the rebuild.
              {
                const av = (await import("./boundaries")).extractAvailability(data.message);
                if (av) {
                  const { data: fresh } = await supabaseAdmin
                    .from("goals")
                    .select("id,preferred_days")
                    .eq("user_id", userId)
                    .eq("status", "active")
                    .gte("created_at", new Date(Date.now() - 15 * 60000).toISOString());
                  for (const g of (fresh ?? []) as {
                    id: string;
                    preferred_days: number[] | null;
                  }[])
                    if (!g.preferred_days?.length)
                      await supabaseAdmin
                        .from("goals")
                        .update({
                          preferred_days: av.days,
                          ...(av.part ? { preferred_time: av.part } : {}),
                        } as never)
                        .eq("id", g.id)
                        .eq("user_id", userId);
                }
              }
              // The member asked for it to be on their plan: rebuild the week now so the reply reports real session times.
              autoReplanned = true;
              const result = await runTool(ctx, "request_replan", {
                reason: "Member asked for these changes on their plan",
              });
              trace.push({ tool: "request_replan", ok: !(result as { error?: string })?.error });
              messages.push({
                role: "user",
                content: `[System: the week was rebuilt with these changes. Result: ${JSON.stringify(result).slice(0, 6000)}. Now write your reply to the member using these real session times.]`,
              });
              continue;
            }
            reply = out.content ?? "";
            break;
          }
          // Run at most 6 calls per round, and only send back the calls that were run: the provider rejects unanswered tool_call ids.
          const calls = out.tool_calls.slice(0, 6);
          setStage(TB0.stageFor(calls.map((c) => c.function.name)));
          messages.push({
            role: "assistant",
            content: out.content ?? null,
            tool_calls: calls,
          });
          // Run in dependency phases (goals/programme/meal plan, then dated entries, then the week rebuild); calls within a phase run in parallel.
          const phase = (n: string) =>
            n === "request_replan"
              ? 2
              : n === "schedule_meals" || n === "schedule_commitment" || n === "edit_plan"
                ? 1
                : 0;
          const results: unknown[] = new Array(calls.length);
          for (const ph of [0, 1, 2]) {
            await Promise.all(
              calls.map(async (tc, i) => {
                if (phase(tc.function.name) !== ph) return;
                let args: Record<string, unknown> = {};
                try {
                  args = JSON.parse(tc.function.arguments || "{}");
                } catch {
                  /* empty */
                }
                // Only tools offered this turn may run: a name the model recalls from history is refused.
                results[i] = offeredTools.has(tc.function.name)
                  ? await runTool(ctx, tc.function.name as never, args)
                  : { error: "This action isn't available in this reply." };
              }),
            );
          }
          calls.forEach((tc, i) => {
            const result = results[i];
            if (tc.function.name === "research_topic") {
              const r = result as {
                search?: unknown;
                sources?: { url: string }[];
                findings?: number;
                dropped?: number;
                reused?: boolean;
                error?: string;
                research_id?: string;
              };
              researchAudit.push({
                ...JSON.parse(tc.function.arguments || "{}"),
                search: r.search ?? null,
                sources: r.sources?.map((s) => s.url) ?? [],
                findings: r.findings ?? null,
                dropped: r.dropped ?? null,
                reused: r.reused ?? false,
                error: r.error ?? null,
                research_id: r.research_id ?? null,
              });
            }
            trace.push({ tool: tc.function.name, ok: !(result as { error?: string })?.error });
            if ((result as { error?: string })?.error)
              console.error(
                "coach tool error",
                tc.function.name,
                String((result as { error?: string }).error).slice(0, 300),
              );
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(result).slice(0, 12000),
            });
          });
        }
      } catch (e) {
        const status = (e as { status?: number }).status ?? 500;
        console.error("coach gateway error", e);
        const timedOut = /TimeoutError|AbortError/.test(String((e as Error)?.name));
        // Step 97: a provider content-filter refusal is a safety decline, not an outage — answer with a safe refusal.
        if (
          status === 400 &&
          /content (management|filter)|content_filter|responsible ai/i.test(
            String((e as Error)?.message ?? e),
          )
        ) {
          reply =
            "I can't help with that. I won't give very low calorie targets, medication doses or anything that could hurt you. I'm happy to help you build a safe plan towards the same goal instead.";
          ctx.safety.push("provider_content_filter");
        } else if (timedOut) {
          // Out of time inside the request: save an honest reply (research is already saved) instead of nothing.
          reply =
            (reply && reply.trim()) ||
            'I ran out of time finishing this one. What I found so far is saved — send "carry on" and I\'ll pick up from there.';
          ctx.safety.push("turn_time_limit");
        } else {
          if (msgId) await supabaseAdmin.from("coach_messages").delete().eq("id", msgId);
          return fallbackFor(supabase, userId, status === 429 ? "busy" : "unavailable");
        }
      }
      reply = dropRepeatedDraft(plainMessage(reply)) || "I couldn't form a reply just now.";
      // Research result presentation only: preserve checked source links without changing routing or claims.
      reply = retainResearchLinks(
        reply,
        researchAudit.flatMap((a) => {
          const audit = a as { sources?: string[] };
          return audit.sources ?? [];
        }),
      );
      // Normal coaching replies keep provenance internal: no "[NICE, 2014]" labels unless sources were asked for.
      if (!trace.some((t) => t.tool === "research_topic") && !CF.asksForSources(data.message))
        reply = CF.stripInternalCitations(reply);
      const violations = styleViolations(reply);
      if (violations.length) {
        ctx.safety.push(...violations.map((v) => `style_${v}`));
        reply = STYLE_FALLBACK;
      }
      const outBad = outputViolations(reply);
      if (outBad.length) {
        ctx.safety.push(...outBad.map((v) => `output_${v}`));
        reply = outBad.includes("regulated_finance")
          ? "I can't recommend specific financial products. That is regulated advice, so a regulated financial adviser or free government-backed guidance (MoneyHelper in the UK, consumerfinance.gov in the US) is the right place. I can help you set a budget or savings goal and schedule the steps."
          : "I can't give medical advice like that. A GP or qualified professional is the right person for this. I can help with your plan around it.";
      }
      await recordSafety(
        userId,
        "ai_output",
        "output",
        [],
        [...violations.map((v) => `style_${v}`), ...outBad.map((v) => `output_${v}`)],
      );
      const used = trace.filter((t) => t.ok).map((t) => t.tool) as never[];
      const contract = {
        ...deriveContract(data.mode, used, ctx.evidenceRefs, ctx.actions, ctx.safety),
        // Owner/debug routing record: ids, scores and tool names only, never reasoning or member text.
        routing: {
          intent: informationOnly
            ? /\b(compare|difference|versus| vs )\b/i.test(data.message)
              ? "comparison"
              : /\b(find|current|now|search|research)\b/i.test(data.message)
                ? "research"
                : /\b(advice|change|missing)\b/i.test(data.message)
                  ? "advice"
                  : "factual_information"
            : intent,
          information_only: informationOnly,
          coach_first: coachFirst,
          research_audit: researchAudit,
          response_ms: Date.now() - turnStarted,
          action_class: actionClass.loop ?? (actionClass.execution ? "execution" : "advice"),
          message_domains: route.domains,
          specialists: experts,
          knowledge_domains: turnKnowledge.domains,
          knowledge_status: turnKnowledge.status,
          evidence_state: KS.evidenceState(turnKnowledge),
          decision_sources: [
            ...(KS.evidenceState(turnKnowledge) === "KNOWLEDGE_FOUND"
              ? ["PLEXECUTE_KNOWLEDGE"]
              : []),
            ...(used.some((t: string) => /research/.test(t)) ? ["CURRENT_EXTERNAL_RESEARCH"] : []),
            ...(used.some((t: string) =>
              /plan|schedule|rebuild|programme|workout|meal|fix_repeated|triage/.test(t),
            )
              ? ["DETERMINISTIC_PLANNING_RULE"]
              : []),
            ...(used.some(
              (t: string) => /^get_|list_|brief/.test(t) && !/knowledge|research/.test(t),
            )
              ? ["MEMBER_FACT"]
              : []),
            "MODEL_INFERENCE",
          ],
          knowledge_method: turnKnowledge.method,
          retrieved: turnKnowledge.evidence.map((e) => ({
            id: e.chunk_id,
            score: Math.round(e.score * 100) / 100,
          })),
          tool_evidence_refs: ctx.evidenceRefs.filter(
            (r) => !turnKnowledge.evidence.some((e) => e.chunk_id === r),
          ),
          research_invoked: trace.some((t) => t.tool === "research_topic"),
          final_sources_used: [...reply.matchAll(/https?:\/\/[^\s)\]]+/g)].map((m) => m[0]),
          tools: used,
          mission_changed: used.some((t: string) => t === "advance_mission"),
          continuity: continuity.reason,
        },
        // Active conversation mode, inherited by the next turn (coach-first.ts continueConversation).
        conversation: ((): import("./coach-first").ConversationState | null => {
          const nowIso = new Date().toISOString();
          if (coachFirst)
            return CF.nextCoachingState(prevConversation, coachContinue, data.message, reply);
          const researched = used.some((t: string) => t === "research_topic");
          const mode = learningIntent
            ? "LEARNING"
            : actionClass.execution || continuity.reason === "execute"
              ? "EXECUTION"
              : researched || continuity.reason === "external"
                ? "RESEARCH"
                : data.mode === "REVIEW"
                  ? "REVIEW"
                  : null;
          if (!mode) return null;
          // An explicit research detour keeps the coaching flow so plain follow-ups resume it.
          const parent = mode === "RESEARCH" ? CF.activeCoaching(prevConversation) : null;
          return {
            mode,
            topic: (parent?.topic ?? data.message).slice(0, 200),
            questions: CF.questionsIn(reply),
            answers: [],
            stage: "GUIDING",
            turn: 1,
            updated_at: nowIso,
            parent,
          };
        })(),
      };

      await supabaseAdmin.from("coach_messages").insert({
        user_id: userId,
        role: "assistant",
        content: reply,
        mode: data.mode,
        actions: ctx.actions as never,
        tool_trace: trace as never,
        contract: contract as never,
      });
      await twinP;
      return { ok: true as const, error: null, reply, safety: pre.state };
    })();
    if (!data.stream) return run;
    // Keep the turn running if the phone briefly drops the connection; the reply is saved and shown on refetch.
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const req = getRequest() as Request & { waitUntil?: (p: Promise<unknown>) => void };
      req.waitUntil?.(run.catch(() => undefined));
    } catch {
      /* not available in this runtime */
    }
    return TB0.progressStream(run, () => stage);
  });

type ToolCall = { id: string; function: { name: string; arguments: string } };
/** Tool-calling turn via the AI gateway; Luna by default, Gemini Flash on provider failure (V3 §58). */
async function callTools(
  apiKey: string,
  messages: unknown[],
  tools: unknown[],
  final: boolean,
  userId: string | null = null,
  signal?: AbortSignal,
): Promise<{ content?: string; tool_calls?: ToolCall[] }> {
  const body = (model: string) =>
    JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: final ? "none" : "auto",
      ...(model.startsWith("openai/") ? { reasoning_effort: "none" } : {}),
    });
  const go = async (model: string) =>
    (await import("./metered-ai.server")).meteredAiFetch(
      userId,
      "coach_chat",
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Lovable-AIG-SDK": "fetch",
          "Content-Type": "application/json",
        },
        body: body(model),
        ...(signal ? { signal } : {}),
      },
    );
  const { recordAiUsage } = await import("./usage.server");
  let model = "openai/gpt-6-luna";
  let res = await go(model);
  // A provider content-filter 400 on a message that already passed our own §62 safety checks is a
  // false positive (e.g. smoking + anger flagged as self-harm): retry on the other provider before refusing.
  const filtered =
    res.status === 400 &&
    /content_filter|content management|ResponsibleAI/i.test(
      await res
        .clone()
        .text()
        .catch(() => ""),
    );
  if (res.status >= 500 || filtered) {
    await recordAiUsage(userId, "coach_chat", model, null, false);
    model = "google/gemini-3.8-flash";
    res = await go(model);
  }
  if (!res.ok) {
    await recordAiUsage(userId, "coach_chat", model, null, false);
    throw new GatewayError(res.status, await res.text());
  }
  const j = await res.json();
  await recordAiUsage(userId, "coach_chat", model, j);
  return j.choices?.[0]?.message ?? {};
}

class GatewayError extends Error {
  constructor(
    public status: number,
    msg: string,
  ) {
    super(msg);
  }
}

async function readSse(res: Response, onEvent: (ev: Record<string, unknown>) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        onEvent(JSON.parse(payload));
      } catch {
        /* partial */
      }
    }
  }
}

async function callResponses(
  apiKey: string,
  model: string,
  instructions: string,
  input: { role: string; content: string }[],
) {
  const res = await (await import("./ai-gateway.server")).aiFetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      stream: true,
      store: false,
      reasoning: { effort: "low" },
    }),
  });
  if (!res.ok) throw new GatewayError(res.status, await res.text());
  let text = "";
  await readSse(res, (ev) => {
    if (ev["type"] === "response.output_text.delta" && typeof ev["delta"] === "string")
      text += ev["delta"];
  });
  return text;
}

async function callChat(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
) {
  const res = await (await import("./ai-gateway.server")).aiFetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Lovable-AIG-SDK": "fetch",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok) throw new GatewayError(res.status, await res.text());
  let text = "";
  await readSse(res, (ev) => {
    const c = (ev as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
    if (c) text += c;
  });
  return text;
}
