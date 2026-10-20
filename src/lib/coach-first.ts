// Coach-first routing: a broad personal goal, struggle or intention ("I need to quit smoking", "I keep
// procrastinating") gets coaching first: member context, Plexecute knowledge, reasoning and 1-2 questions.
// No live research and no plan/goal/mission creation until the member asks for external facts or execution.
// Pure and deterministic so the routing is testable.

const PERSONAL =
  /\b(i (really )?(need|want|would like|'d like|wanna|have) to|i want|i need help|i keep|i can't|i cannot|i struggle|i'm struggling|i am struggling|i'm (always|never|so|too|really|not)|i feel|i've been|i don't know (how|where|what)|i wish|i'm trying to|i am trying to|i'd love to)\b/;

// The member asked for something external, current or located: research is legitimate.
const EXTERNAL =
  /\b(find|near me|nearby|local|current(ly)?|latest|right now|recent|today's|price|prices|cost|costs|how much is|available|availability|where can|search|look up|research|courses?|jobs?|vacanc\w*|qualifications?|employers?|services?|providers?|websites?|links?|sources?|compare|vs|versus|reviews?|opening|news)\b/;

// The member asked Plexecute to build, schedule or do something: execution is legitimate.
const EXECUTE =
  /\b(build|make|create|draw up|put together|set up|write|design|schedule|plan (it|this|that|me|my)|book|reserve|call me|ring me|remind|put it|add it|add (a|an|this|that)|go ahead|do it|start now|let's (do|go|start)|today|tonight|tomorrow|this (morning|afternoon|evening|week|weekend)|right now|appointment|dentist|taxi|table|a plan|my plan|meal plan|workout|programme|program|routine for me)\b/;

// The member asked Coach to change an item already on their plan ("move one of them to 8.30pm",
// "push my study session back", "change one to 8.30"): always an execution request, never coaching.
const PLAN_EDIT =
  /\b(move|moving|reschedule|push|shift|swap|switch|change|cancel|delete|remove|drop|shorten|extend|pause|bring forward|put back)\b[^.?!]{0,60}?(\b(sessions?|blocks?|items?|workouts?|class(es)?|lessons?|study|meetings?|appointments?|one of (them|those|these)|both of (them|those)|(my|the|today'?s|tomorrow'?s|this) (plan|schedule|calendar))\b|\b(to|at|until|till|for) \d{1,2}([:.]\d{2})?\b|\b\d{1,2}([:.]\d{2})? ?(am|pm)\b)/;

/** True when the message asks Coach to change something already on the member's plan. */
export function isPlanEditRequest(text: string | null | undefined): boolean {
  return PLAN_EDIT.test(norm(text));
}

/** True when this turn should coach first: no web research, no goals/plans/missions/tasks created. */
export function isCoachFirst(text: string | null | undefined, opts: { learning?: boolean } = {}) {
  const t = String(text ?? "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 220 || opts.learning) return false;
  if (!PERSONAL.test(t)) return false;
  if (EXTERNAL.test(t) || EXECUTE.test(t) || PLAN_EDIT.test(t)) return false;
  // Several separate requests in one message use the multi-intent route.
  if ((t.match(/[.?!;]\s+\S/g) ?? []).length > 1) return false;
  return true;
}

/** Tools a coach-first turn may not use: live research and anything that creates or changes plans/goals. */
export const COACH_FIRST_BLOCKED =
  /^(research_topic|propose_|draft_goal_pathway|accept_goal_pathway|advance_mission|request_replan|schedule_|edit_plan|update_goal|add_milestone|update_milestone|change_training_programme|build_learning_pathway|plan_meal_prep|accept_meal_prep|add_wellness_practice|protect_recurring_time|triage_tonight|fix_repeated_misses|find_appointment|choose_appointment|start_phone_verification|give_call_consent|update_availability|add_learning_item|log_|record_|add_|update_|delete_|remove_)/;

export const COACH_FIRST_NOTE = `COACH FIRST (internal, overrides the execution and mission instructions above for this turn): the member has shared a personal goal, struggle or intention, not a request for a plan or for outside information. Coach them like a skilled professional life coach: 1) use what Plexecute already knows about them (read relevant saved context first if it changes your answer; never ask for facts already known such as country, work pattern, goals or availability); 2) apply the supplied Plexecute knowledge for this area (behaviour change, training, nutrition, career, finance...) as your own expertise in plain words; 3) reply naturally and briefly: acknowledge, give one or two genuinely useful insights from that expertise, then ask the ONE or TWO most useful questions to understand their situation (current pattern, triggers or barriers, previous attempts, constraints, what they want help with). Do not interrogate, do not give a long generic programme, and do not search online, create goals, missions, plans, tasks or calls this turn. Do not show citations, source names or links. End by saying what you will do once you know (e.g. build a realistic route around their routine).`;

/** Removes internal citation labels like "[NICE, 2014]" or "[Plexecute, 2026]" from a normal coaching reply. */
export function stripInternalCitations(reply: string): string {
  return reply
    .replace(/\s?\[[A-Z][^[\]\n]{0,80}?,\s*(19|20)\d{2}[a-z]?\]/g, "")
    .replace(/\s?\[[a-z0-9_-]{3,}\](?!\()/g, "")
    .replace(/[ \t]+([.,;:])/g, "$1");
}

/** The member wants sources/evidence shown. */
export function asksForSources(text: string | null | undefined): boolean {
  return /\b(sources?|evidence|citations?|references?|studies|study|research says|proof|links?|where (is|does) (that|this) come from)\b/i.test(
    String(text ?? ""),
  );
}

// ---------------------------------------------------------------------------------------------------------
// Conversation continuity: once Coach opens a coaching conversation, follow-up turns inherit it instead of
// being re-routed from zero. State is saved on the assistant reply (coach_messages.contract.conversation).
// ---------------------------------------------------------------------------------------------------------

export type ConversationMode =
  "COACHING" | "LEARNING" | "RESEARCH" | "PLANNING" | "EXECUTION" | "REVIEW";

export type ConversationState = {
  mode: ConversationMode;
  /** The member's opening words for this coaching topic. */
  topic: string;
  /** Questions Coach asked in its latest reply. */
  questions: string[];
  /** The member's answers so far in this flow (latest last). */
  answers: string[];
  stage: "UNDERSTANDING" | "GUIDING";
  turn: number;
  updated_at: string;
  /** A coaching flow paused for an explicit research detour; plain follow-ups resume it. */
  parent?: ConversationState | null;
};

export type ContinuityReason =
  "continue" | "external" | "execute" | "topic_change" | "complete" | "expired" | "none";

/** Coaching conversations older than this are not continued. */
export const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;

// Explicit, outward-facing requests only. Words that commonly appear inside answers ("currently", "cost",
// "available", "today") do not count unless they ask for outside information.
const EXPLICIT_EXTERNAL =
  /\b(find|search|look up|google|near me|nearby|in my area|local (services?|support|clinics?|groups?|pharmac\w*)|show me (the )?(current|latest|official|nhs|government)|(current|latest|official) (nhs |government )?(guidance|guidelines|services?|support|options|prices?|rules|products|research|studies|figures|statistics|data)|currently (available|on sale|offered)|what('s| is| are) (currently )?available|links?|sources?|websites?|apps? (for|to|that)|courses? (near|in|for)|vacanc\w*|job adverts?|news)\b/;

// Explicit build/schedule/do requests directed at Coach.
const EXPLICIT_EXECUTE =
  /\b((make|build|create|write|draw up|put together|set up|design) (me |us )?(a|an|my|the|this|that|it)\b|schedule|book|reserve|remind me|call me|ring me|plan (it|this|that) (out|in)|put (it|this|that|them) (on|in|into)|add (it|this|that|them) to|(add|put)\b[^.?!]{0,40}\b(to|on|in|into) my (plan|schedule|calendar|day|week|routine)\b|go ahead|do it|let'?s (do|start|go)|start (it|now|today|tomorrow)|get (it|this) (going|started))/;

const TOPIC_CHANGE =
  /^(anyway|by the way|btw|on another note|different (question|topic|subject)|unrelated|new (question|topic)|something else|change of subject|forget (that|it)|moving on)\b/;

const COMPLETE =
  /^(thanks|thank you|cheers|great,? thanks|perfect,? thanks|that'?s (all|everything|it)|got it,? thanks|ok(ay)?,? thanks)\b[^?]*$/;

// Signals the message is an answer or follow-up within the flow, not an unrelated general question.
const ANSWER_SIGNAL =
  /\b(i|i'm|i've|i'd|i'll|me|my|mine|we|our|us|that|this|it|those|them|these|next|yes|no|yeah|yep|nope|maybe|usually|mostly|sometimes|never|always)\b/;

function norm(text: string | null | undefined) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reads the saved state from the last assistant reply; drops anything unrecognised or expired. */
export function readConversation(
  row: { contract?: unknown; created_at?: string | null } | null | undefined,
  now = Date.now(),
): ConversationState | null {
  const c = (row?.contract as { conversation?: ConversationState } | null)?.conversation;
  if (!c || typeof c !== "object" || typeof c.mode !== "string") return null;
  const at = Date.parse(row?.created_at ?? c.updated_at ?? "");
  if (!Number.isFinite(at) || now - at > CONVERSATION_TTL_MS) return null;
  return c;
}

/** The coaching flow a follow-up could continue: the active one, or one paused for a research detour. */
export function activeCoaching(prev: ConversationState | null): ConversationState | null {
  if (!prev) return null;
  if (prev.mode === "COACHING") return prev;
  if (prev.mode === "RESEARCH" && prev.parent?.mode === "COACHING") return prev.parent;
  return null;
}

/**
 * Decides whether this message continues the active coaching conversation. Only an explicit external
 * request, an explicit build/schedule request, a clear topic change, a learning intent or a sign-off ends it.
 * "What should I do next?", "What would you recommend?", "How do I handle that?" continue it.
 */
export function continueConversation(
  prev: ConversationState | null,
  text: string | null | undefined,
  opts: { learning?: boolean } = {},
): { continue: boolean; reason: ContinuityReason } {
  const flow = activeCoaching(prev);
  if (!flow) return { continue: false, reason: "none" };
  const t = norm(text);
  if (!t) return { continue: false, reason: "none" };
  if (EXPLICIT_EXECUTE.test(t) || PLAN_EDIT.test(t)) return { continue: false, reason: "execute" };
  if (EXPLICIT_EXTERNAL.test(t)) return { continue: false, reason: "external" };
  if (opts.learning || TOPIC_CHANGE.test(t)) return { continue: false, reason: "topic_change" };
  if (COMPLETE.test(t)) return { continue: false, reason: "complete" };
  // A fresh, short opener about something else ("I want to get fit.") starts a new coaching topic.
  // A fresh, short opener ("I want to get fit.", or "I need to quit smoking." said again) starts a new
  // coaching flow rather than being read as an answer.
  if (isCoachFirst(t) && t.length <= 80 && !/\?/.test(t))
    return { continue: false, reason: "topic_change" };
  // A general question with no reference to the member or the conversation is a new request.
  if (!ANSWER_SIGNAL.test(t) && t.split(" ").length > 6)
    return { continue: false, reason: "topic_change" };
  return { continue: true, reason: "continue" };
}

const STOP = new Set(
  "i me my to a an the and or of in on for with want need would like really have get be more less help keep can't cannot so too not am is are it this that".split(
    " ",
  ),
);
export function sameTopic(a: string, b: string) {
  const words = (s: string) =>
    new Set(
      norm(s)
        .replace(/[^a-z0-9 ]/g, " ")
        .split(" ")
        .filter((w) => w.length > 2 && !STOP.has(w))
        .map((w) => w.replace(/(ing|ed|s)$/, "")),
    );
  const A = words(a);
  return [...words(b)].some((w) => A.has(w));
}

/** Questions Coach asked in a reply (sentences ending in "?"), trimmed for storage. */
export function questionsIn(reply: string): string[] {
  return (reply.match(/[^.?!\n]*\?/g) ?? [])
    .map((q) => q.trim())
    .filter((q) => q.length > 8)
    .slice(0, 4)
    .map((q) => q.slice(0, 200));
}

/** State saved after a coaching turn: a new flow, or the continued one with this answer appended. */
export function nextCoachingState(
  prev: ConversationState | null,
  continued: boolean,
  memberText: string,
  reply: string,
  now = new Date(),
): ConversationState {
  const flow = continued ? activeCoaching(prev) : null;
  return {
    mode: "COACHING",
    topic: flow?.topic ?? memberText.slice(0, 200),
    questions: questionsIn(reply),
    answers: flow ? [...flow.answers, memberText.slice(0, 600)].slice(-4) : [],
    stage: flow ? "GUIDING" : "UNDERSTANDING",
    turn: (flow?.turn ?? 0) + 1,
    updated_at: now.toISOString(),
    parent: null,
  };
}

/** A continuing coaching turn may only read the member's saved context or Plexecute knowledge: no research,
 * no old research dumps, no plan/journey/booking actions. */
export function coachContinueAllows(tool: string): boolean {
  return (
    (/^get_/.test(tool) && tool !== "get_research_findings") ||
    tool === "explain_plan_item" ||
    tool === "explain_exercise" ||
    tool === "brief_my_day" ||
    tool === "review_my_week"
  );
}

export function coachContinueNote(flow: ConversationState): string {
  const asked = flow.questions.length
    ? flow.questions.map((q) => `"${q}"`).join(" ")
    : "(none saved)";
  return `COACHING CONTINUES (internal, overrides the execution, mission and information instructions above for this turn): this message is the member's answer or follow-up inside the SAME coaching conversation you started about "${flow.topic}". It is not a new request, so do not restart routing, re-ask what they already told you, or treat it as a generic query. Your last questions were: ${asked}. 1) Name back the specific facts they just gave you (numbers, times, triggers, barriers, previous attempts, what went wrong) and the pattern they reveal, in plain words. 2) Apply the supplied Plexecute knowledge for this area as your own expertise to reason from THOSE facts. 3) Give one realistic, personalised next step (what to do, when, how to handle the hardest moment they named), not a generic article or a long programme. 4) If something important is still missing, ask ONE focused question; otherwise offer to build it into their plan when they are ready. Do not search online, do not show links, source names, "sources checked" or citation labels, and do not create goals, missions, plans, tasks or calls unless they ask.`;
}

/** A research request that leans on the active topic ("support near me") rather than naming a new subject. */
export function leansOnTopic(text: string | null | undefined): boolean {
  const t = String(text ?? "").toLowerCase();
  const words = t.split(/\s+/).filter(Boolean).length;
  return (
    words <= 12 &&
    /\b(near me|nearby|local|for (this|that|it)|about (this|that|it)|support|help|services?|options)\b/.test(
      t,
    )
  );
}
