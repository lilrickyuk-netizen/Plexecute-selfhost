// Life Intelligence Layer: deterministic reasoning that sits under the one Coach.
// Pure functions only (no DB, no model calls). Everything here works from real member data and
// says "not enough data" rather than inventing patterns, links, projections or certainty.
import type { Domain } from "./knowledge";
import { goalTrajectory, type TrajectoryGoal } from "./progress";
import { orderMilestones } from "./pathway";

export const LIFE_INTELLIGENCE_VERSION = "life_intel_v1";

/* ------------------------------------------------------------------ */
/* 1. Domain routing                                                   */
/* ------------------------------------------------------------------ */

/** Keyword routes into the existing knowledge-base domains. Order = tie-break priority. */
const ROUTES: { domain: Domain; re: RegExp }[] = [
  {
    domain: "business",
    re: /\b(business|startup|start[- ]?up|entrepreneur|self[- ]employed|sole trader|limited company|side hustle|my (own )?(company|app|product|brand)|first customers?|mvp)\b/i,
  },
  {
    domain: "career",
    re: /\b(careers?|project manag\w*|move into|job|promotion|profession|surveyor|electrician|engineer|manager|interview|cv|resume|employ|business|company|self[- ]employed|start(ing)? (my|a) (own )?(business|company)|entrepreneur|client|customers?|trade)\b/i,
  },
  {
    domain: "learning",
    re: /\b(learn\w*|spanish|french|german|language|study|studying|course|qualif\w*|degree|university|college|exam|module|certif\w*|apprentice\w*|nvq|hnc|hnd|diploma|revision|revise)\b/i,
  },
  {
    domain: "finance",
    re: /\b(money|save|saving|savings|budget|debt|afford|cost|£|\$|pay for|fund|deposit|house|mortgage|income|salary|spend)\b/i,
  },
  { domain: "nutrition", re: /\b(eat|eating|diet|food|meal|calorie|protein|nutrition|cook)\b/i },
  { domain: "weight", re: /\b(lose|losing|weight|kg|lbs?|stone|fat)\b/i },
  {
    domain: "resistance_training",
    re: /\b(gym|strength|lift|lifting|workout|train|training|muscle)\b/i,
  },
  { domain: "activity", re: /\b(run|running|cardio|walk|steps|fitness|fit|active|exercise)\b/i },
  {
    domain: "sleep",
    re: /\b(sleep|tired|exhausted|night shifts?|shift work|rotating shifts?|insomnia|rest)\b/i,
  },
  {
    domain: "productivity",
    re: /\b(productiv\w*|procrastinat\w*|putting off|put off|too much to do|to-?do list|workload|deadlines?|focus|time management|overwhelm\w*|busy|schedule|organis\w*|organiz\w*)\b/i,
  },
  {
    domain: "habits",
    re: /\b(habit|routine|consistent|consistency|keep missing|missed|streak)\b/i,
  },
  { domain: "motivation", re: /\b(motivat\w*|discipline|give up|giving up|lazy|stuck)\b/i },
  {
    domain: "relationships",
    re: /\b(family|partner|wife|husband|kids|children|friend|relationship|communicat\w*)\b/i,
  },
  {
    domain: "decisions",
    re: /\b(decide|decision|choose|choice|should i|not sure whether|unsure whether|whether to)\b/i,
  },
  {
    domain: "behaviour",
    re: /\b(putting off|put off|procrastinat\w*|keep (missing|skipping|avoiding)|self[- ]sabotag\w*|bad habits?|change my behaviou?r)\b/i,
  },
  {
    domain: "transitions",
    re: /\b(change careers?|career change|moving|move house|new baby|retire\w*|transition|redundan\w*)\b/i,
  },
  {
    domain: "wellbeing",
    re: /\b(stress\w*|anxious|anxiety|wellbeing|burn ?out|mental health|mood)\b/i,
  },
  { domain: "mindfulness", re: /\b(meditat\w*|mindful\w*|breath\w*|yoga)\b/i },
  {
    domain: "sports_psychology",
    re: /\b(match|confidence|nerves|competition|performance anxiety)\b/i,
  },
  {
    domain: "personal_development",
    re: /\b(confidence|leader\w*|better person|grow|self[- ]improvement)\b/i,
  },
  {
    domain: "goals",
    re: /\b(goal|goals|five[- ]year|5[- ]year|on track|plan|pathway|priority|priorities)\b/i,
  },
];

/** Planning context that is not a knowledge domain but changes how the answer must be built. */
const CONTEXT: { key: "work_schedule" | "family_time" | "budget"; re: RegExp }[] = [
  {
    key: "work_schedule",
    re: /\b(shift|shifts|night|rota|work(ing)? (long|full[- ]time|hours)|full[- ]time|overtime)\b/i,
  },
  { key: "family_time", re: /\b(family|kids|children|partner|wife|husband)\b/i },
  { key: "budget", re: /£\s?\d|\$\s?\d|\bbudget\b|\bafford\b/i },
];

export type Route = { domains: Domain[]; context: string[]; multiDomain: boolean };

/** Picks the few knowledge domains a message actually touches (max 4). No model call. */
export function routeDomains(text: string, max = 4): Route {
  const t = text.slice(0, 2000);
  const hits = ROUTES.filter((r) => r.re.test(t)).map((r) => r.domain);
  // Goals that always involve other areas (e.g. weight change is driven by food and activity).
  const IMPLIES: Partial<Record<Domain, Domain[]>> = {
    weight: ["nutrition", "activity"],
    transitions: ["decisions"],
  };
  for (const h of [...hits])
    for (const x of IMPLIES[h] ?? []) if (!hits.includes(x)) hits.splice(hits.indexOf(h) + 1, 0, x);
  const domains = [...new Set(hits)].slice(0, max);
  const context = CONTEXT.filter((c) => c.re.test(t)).map((c) => c.key);
  // "goals" alone is generic; only count real subject domains when deciding multi-domain.
  const subject = domains.filter((d) => d !== "goals");
  return {
    domains,
    context,
    multiDomain: subject.length + (context.includes("work_schedule") ? 1 : 0) >= 2,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Capability awareness                                             */
/* ------------------------------------------------------------------ */

export const CAPABILITY_CLASSES = [
  "PLEXECUTE_CAN_EXECUTE",
  "PLEXECUTE_CAN_ASSIST",
  "PLEXECUTE_CAN_RESEARCH",
  "PLEXECUTE_CAN_PLAN",
  "PLEXECUTE_CAN_SCHEDULE",
  "PLEXECUTE_CAN_CALL",
  "PLEXECUTE_CAN_BOOK",
  "PLEXECUTE_CAN_PREPARE_CHECKOUT",
  "MEMBER_MUST_ACT",
  "PROFESSIONAL_REQUIRED",
  "UNSUPPORTED",
] as const;
export type CapabilityClass = (typeof CAPABILITY_CLASSES)[number];

export type CapabilityVerdict = { cls: CapabilityClass; note: string; nextStep: string | null };

export type RequestIntent = "capability_question" | "action_request";

/**
 * Is the member asking WHETHER Plexecute can do something, or asking it to do it now?
 * Deterministic: imperatives and concrete details (time, "now", "please", party size) are requests;
 * hypotheticals ("if I give you…") and bare "can you / are you able to…" questions are capability questions.
 */
export function requestIntent(text: string): RequestIntent {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  const lead = String.raw`^(?:(?:so|ok|okay|and|but|hey|hi|right|just|also|then|coach|plexecute|quick question)[,!.]?\s+)*`;
  if (
    new RegExp(
      `${lead}(?:please\\s+)?(?:book|order|get|call|ring|phone|reserve|find|send|sort)\\b`,
    ).test(t)
  )
    return "action_request";
  const hypothetical =
    /\b(if i (give|gave|tell|told|share|shared|send|sent|provide|wanted|want|asked|ask|needed|need)|if you (had|have|got|were given)|hypothetically|in (the )?future|one day|next time|in general|generally|ever be able|is that something|would that work)\b/.test(
      t,
    );
  if (hypothetical) return "capability_question";
  // "Can you build me a diet plan / put my meals on my plan" names a concrete thing to make or change: a request.
  if (
    new RegExp(
      `${lead}(?:can|could|will|would) you (?:please )?(?:build|make|create|put|add|set|change|update|move|log|schedule|write|design|draw up|give|turn|fit|rebuild|replace|switch|plan) (?:me|my|it|this|that|them|the|a|an|our|everything)\\b`,
    ).test(t)
  )
    return "action_request";
  const capability =
    new RegExp(`${lead}(can|could|would|will|are|do|does|is) (you|plexecute|coach|it)\\b`).test(
      t,
    ) ||
    /\b(are you able|are you capable|capable of|is it possible|do you have the ability|what can you|what are you able|how (do|does|would|will) (you|plexecute|it|this|coach)\b|how (does|would|do) [a-z ]{1,40} work\b|can plexecute|does plexecute|your capabilit\w*|what (things|kind of things) can)\b/.test(
      t,
    );
  if (!capability) return "action_request";
  const concrete =
    /\b(now|asap|right now|right away|straight away|tonight|today|tomorrow|this (morning|afternoon|evening)|at \d|\d ?(am|pm)\b|in \d+ ?(min|mins|minutes|hours?)|please|for \d+ ?(people|of us|adults?)|for (my|me and)|go ahead|do it)\b/.test(
      t,
    );
  return concrete ? "action_request" : "capability_question";
}

/**
 * Did the member's own words this turn directly tell Coach to make a change? If so, that instruction is the
 * confirmation: Coach applies it at once instead of asking them to confirm again (here or on another page).
 * Statements of fact, feelings and questions ("why is this on my plan?") are not instructions.
 */
export type ActionType =
  | "ANSWER"
  | "CLARIFY"
  | "RESCHEDULE"
  | "VERIFY"
  | "RESEARCH"
  | "PLAN"
  | "PREPARE"
  | "SCHEDULE"
  | "EXECUTE"
  | "CALL"
  | "BOOK"
  | "MEASURE"
  | "ADAPT";

/**
 * Universal action classification. A stated actionable intention ("I'm going to spend all day marketing my waitlist",
 * "I need to find customers", "I want to start learning Spanish") is execution intent, not a question for advice.
 * Deterministic so routing can be tested; the model still chooses the concrete tools.
 */
export type ExecutionLoop = "start" | "now" | "outcome" | "pause" | null;

export function classifyActions(text: string | null | undefined): {
  execution: boolean;
  actions: ActionType[];
  loop: ExecutionLoop;
} {
  const t = String(text ?? "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  const none = { execution: false, actions: ["ANSWER"] as ActionType[], loop: null };
  if (!t) return none;
  if (requestIntent(t) === "capability_question") return none;
  // Execution-loop messages during active work: pausing, and reporting what happened.
  if (
    /\b(i need to stop|i have to stop|i've got to stop|stop (now|for (now|today))|continue (it )?tomorrow|carry on tomorrow|pick (this|it) up tomorrow|finish (it|this) tomorrow)\b/.test(
      t,
    )
  )
    return { execution: true, actions: ["ADAPT", "RESCHEDULE", "SCHEDULE"], loop: "pause" };
  if (
    /^(done|finished|completed|did it|posted( it)?|sent( it)?)\b/.test(t) ||
    /^(i('ve| have)? (just )?(finished|completed|done|did) (it|the|my|that|this|today's|tonight's))\b/.test(
      t,
    ) ||
    /^i (found|got|sent|applied (for|to)|remembered|scored|saved|submitted) \d+\b/.test(t) ||
    /\bi remembered \d+ (out of|of) \d+\b/.test(t) ||
    /\b(got (me )?\d+ ?(signups?|sign ?ups|replies|leads|views|users)|\d+ (signups?|sign ?ups) from|(post|it) (was|got) (removed|deleted|taken down|banned)|removed my post|they removed|didn't allow|wasn't allowed)\b/.test(
      t,
    )
  )
    return { execution: true, actions: ["VERIFY", "MEASURE", "ADAPT", "EXECUTE"], loop: "outcome" };
  const acts = new Set<ActionType>();
  const window =
    /\b(i (have|'ve got|got) (an? |\d+ |half an? |the )?(hour|hours|minutes|mins|evening|afternoon|morning|day|tonight|all day)( free| now| tonight| today)?|i have tonight|tonight (is )?free|got all day|all day today|right now|start now|let's do it)\b/.test(
      t,
    );
  const intention =
    window ||
    /\b(i'm going to|i am going to|i'm gonna|i'll be|i will be|i'm planning to|i plan to|i want to (start|launch|build|grow|find|get|learn|prepare|sort|market|promote|scale|save|pay off|become|apply)|i need to (find|get|sort|prepare|launch|build|grow|market|promote|scale|learn|book|organise|organize|plan|start|train|study|apply)|i've got to|i have to (find|get|sort|prepare|launch|market)|help me (plan|execute|do|get|find|launch|grow|market|sort)|let's (do|get|start|plan|go)|today i('m| am| will)|spend (all|the whole|the) (day|morning|afternoon|evening|week)|i need (resources|customers|users|signups|sign ?ups|clients|a plan|a dentist|an appointment)|sort it( out)?|organise my|organize my)\b/.test(
      t,
    );
  const complaint =
    /\b(supposed to be helping|just (giving|give) me (generic )?advice|generic advice|you're not (helping|doing)|do it for me|actually (do|help|plan))\b/.test(
      t,
    );
  if (!intention && !complaint) return none;
  acts.add("PLAN");
  if (
    /\b(market|promot|waitlist|waiting list|customers?|users?|signups?|sign ?ups|clients|audience|launch|scale|grow|online places|communit|channels?|find|research|resources|learn|qualif|course|exam|jobs?|apply|applying|company|business)\w*/.test(
      t,
    )
  )
    acts.add("RESEARCH");
  if (
    /\b(today|tomorrow|tonight|this (morning|afternoon|evening|week|weekend)|all day|every day|saturday|sunday|monday|tuesday|wednesday|thursday|friday|weekly|hours?|now)\b/.test(
      t,
    ) ||
    intention
  )
    acts.add("SCHEDULE");
  acts.add("PREPARE");
  acts.add("EXECUTE");
  if (/\b(book|reserve|appointment|dentist|table)\b/.test(t)) acts.add("BOOK");
  if (/\b(call me|ring me|accountability call)\b/.test(t)) acts.add("CALL");
  if (/\b(signups?|sign ?ups|track|results?|how many)\b/.test(t)) acts.add("MEASURE");
  if (complaint) acts.add("ADAPT");
  const now = window || /\b(now|today|tonight|this (morning|afternoon|evening))\b/.test(t);
  return { execution: true, actions: [...acts], loop: now ? "now" : "start" };
}

export function memberInstructed(text: string | null | undefined): boolean {
  const t = String(text ?? "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return false;
  if (
    /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|confirm(ed)?|approved?|accept(ed)?|plan accepted|sounds good|perfect|great|please do|that's fine|fine)\b/.test(
      t,
    )
  )
    return true;
  if (requestIntent(t) === "capability_question") return false;
  // A stated actionable intention ("I'm going to spend all day today marketing it") authorises Coach to set up that work.
  if (classifyActions(t).execution && !/\b(don't|do not|dont)\b/.test(t)) return true;
  if (
    /\b(don't|do not|dont)\b.{0,25}\b(change|add|put|move|delete|remove|book|schedule|touch|save)\b/.test(
      t,
    )
  )
    return false;
  // A changed life constraint stated to Coach ("I only have 3 hours a week now", "I can't afford that course") is an instruction to adapt the plan.
  if (
    /\b(i only have|i've only got|i only get|i now (work|have|only)|i can'?t afford|i cannot afford|i no longer|from now on i)\b/.test(
      t,
    ) &&
    !/\b(don't|do not|dont) (change|touch)\b/.test(t)
  )
    return true;
  // A question followed by an instruction ("Is my call on? If not put it on.") is an instruction.
  const afterQ = t
    .split("?")
    .slice(1)
    .join("?")
    .trim()
    .replace(/^(and |if not,? |if it isn'?t,? |if they aren'?t,? |if not then |otherwise,? )/, "");
  if (afterQ && afterQ !== t && memberInstructed(afterQ)) return true;
  if (
    /^(why|what|how|when|where|who|which|am i|is it|is my|are my|have i|did i)\b/.test(t) &&
    !/\b(please|can you|could you)\b/.test(t)
  )
    return false;
  return /\b(i want you to|i need you to|i'd like you to|can you|could you|will you|please|make|build|create|put|add|set|change|update|move|log|record|accept|approve|schedule|replace|switch|start|activate|save|cancel|remove|clear|book|ring|call|remind|sort|fix|rebuild|reschedule|turn|give me|let's|i will need|i'll need|i want (?!to\b)|i need (?!to\b)|i'd like (?!to\b))/.test(
    t,
  );
}

/** What Plexecute can really do for a request, given the member's plan (mirrors entitlements.ts). */
export function capabilityFor(text: string, tier: string): CapabilityVerdict {
  const t = text.toLowerCase();
  const paid = tier === "pro" || tier === "execute";
  const execute = tier === "execute";
  if (
    /\b(diagnos\w*|prescri\w*|what medication|is this (a )?(tumou?r|cancer|infection)|legal advice|sue |lawsuit|which (stocks?|shares|funds?)|invest (my|in)|pension advice|mortgage advice)\b/.test(
      t,
    )
  )
    return {
      cls: "PROFESSIONAL_REQUIRED",
      note: "Needs a qualified professional; Plexecute gives general support only.",
      nextStep: "Offer to book or plan time to see the right professional.",
    };
  if (
    /\b(transfer money|send money|buy (shares|stocks|crypto)|file my tax\w*|sign (the|a) contract|post (it )?on (instagram|facebook|twitter|x)|send (an )?email to|text my|whatsapp|order (me )?an? uber|book (me )?an? uber)\b/.test(
      t,
    )
  )
    return {
      cls: "UNSUPPORTED",
      note: "Plexecute can't do this itself.",
      nextStep: "Plan or remind the member to do it.",
    };
  if (/\b(pay (the|my|a)? ?(deposit|bill|balance|fee)|checkout|pay for (it|the))\b/.test(t))
    return execute
      ? {
          cls: "PLEXECUTE_CAN_PREPARE_CHECKOUT",
          note: "Plexecute prepares the business's secure checkout; the member pays there themselves.",
          nextStep: "Prepare the checkout handoff.",
        }
      : {
          cls: "MEMBER_MUST_ACT",
          note: "Payment handoff is part of Execute; the member pays the business directly.",
          nextStep: null,
        };
  if (
    /\b(book|reserve|reservation|table for|make an appointment|get an appointment|taxi|minicab|cab|airport transfer|takeaway)\b/.test(
      t,
    )
  )
    return execute
      ? {
          cls: "PLEXECUTE_CAN_BOOK",
          note: "Execute can book online or by phone.",
          nextStep: "Start the booking.",
        }
      : {
          cls: "MEMBER_MUST_ACT",
          note: "Booking for you is part of Execute; Plexecute can still add the appointment to your plan once booked.",
          nextStep: "Offer to add it once they've booked.",
        };
  if (/\b(call me|ring me|phone me|wake[- ]up call|accountability call)\b/.test(t))
    return paid
      ? {
          cls: "PLEXECUTE_CAN_CALL",
          note: "Pro and Execute can get calls.",
          nextStep: "Schedule the call.",
        }
      : {
          cls: "MEMBER_MUST_ACT",
          note: "Calls are part of Pro and Execute; in-app reminders are available.",
          nextStep: "Offer an in-app reminder.",
        };
  if (
    /\b(schedule|fit (it|them|this|those|sessions?)|add (it )?to my (plan|calendar|week)|move (my|the)|reschedule|put (it )?in my)\b/.test(
      t,
    )
  )
    return {
      cls: "PLEXECUTE_CAN_SCHEDULE",
      note: "Plexecute schedules around fixed commitments.",
      nextStep: "Fit it into the plan.",
    };
  if (
    /\b(requirements?|entry requirements|eligib\w*|what qualifications?|how (long|much) does (it|the course)|application process|deadline for)\b/.test(
      t,
    )
  )
    return {
      cls: "PLEXECUTE_CAN_RESEARCH",
      note: "Plexecute can research current requirements and records sources.",
      nextStep: "Run research and say what stays unverified.",
    };
  if (
    /\b(plan|pathway|roadmap|become|i want to|how do i get|help me (get|become|start|build))\b/.test(
      t,
    )
  )
    return {
      cls: "PLEXECUTE_CAN_PLAN",
      note: "Plexecute builds a pathway and fits it into the week.",
      nextStep: "Offer to add it as a goal and build the pathway.",
    };
  if (/\b(log|record|mark|tick|done|completed)\b/.test(t))
    return {
      cls: "PLEXECUTE_CAN_EXECUTE",
      note: "Plexecute can record this directly.",
      nextStep: null,
    };
  if (/\b(go to|attend|drive|turn up|speak to (my|your) (boss|manager))\b/.test(t))
    return {
      cls: "MEMBER_MUST_ACT",
      note: "Only the member can do this; Plexecute can plan and remind.",
      nextStep: "Offer to schedule and remind.",
    };
  return { cls: "PLEXECUTE_CAN_ASSIST", note: "Coaching and guidance.", nextStep: null };
}

/* ------------------------------------------------------------------ */
/* 3. Inputs                                                           */
/* ------------------------------------------------------------------ */

export type IGoal = {
  id: string;
  title: string;
  domain: string;
  status: string;
  priority?: number | null;
  priority_class?: string | null;
  deadline?: string | null;
  weekly_minutes?: number | null;
  why?: string | null;
  dependencies?: string[] | null;
  monthly_saving?: number | null;
  budget_available?: number | null;
  current_value?: number | null;
  baseline_value?: number | null;
  target_value?: number | null;
  target_unit?: string | null;
  created_at?: string;
  pathway?: { resources?: { kind: string; amount: number | null }[]; months?: number } | null;
};
export type IMilestone = {
  id: string;
  goal_id: string;
  key?: string | null;
  title: string;
  stage?: number | null;
  depends_on?: string[] | null;
  status?: string | null;
  done_at?: string | null;
  due_date?: string | null;
  blocked_reason?: string | null;
};
export type IBlock = {
  id: string;
  title: string;
  domain: string;
  goal_id: string | null;
  starts_at: string;
  duration_min: number;
  status: string;
  is_protected?: boolean | null;
  source_type?: string | null;
};
export type IObjective = { area: string; text: string };
export type ICommitment = {
  title: string;
  kind?: string | null;
  start_time: string | null;
  end_time: string | null;
  on_date?: string | null;
  days?: number[] | null;
  is_hard?: boolean | null;
};

export const DONE = new Set(["done", "partial"]);
export const MISSED = new Set(["missed", "skipped", "expired"]);
const ACTIVE_LIKE = new Set(["active", "proposed", "paused"]);

/* ------------------------------------------------------------------ */
/* 4. Relationship graph (only real, deterministic links)              */
/* ------------------------------------------------------------------ */

export type LinkKind = "vision" | "goal" | "milestone" | "block";
export type Link = {
  from_kind: LinkKind;
  from_ref: string;
  to_kind: LinkKind;
  to_ref: string;
  relation: "serves" | "requires" | "part_of" | "scheduled_for";
  source: "member_goal" | "pathway" | "plan" | "area_and_wording";
  goal_id: string | null;
};

const GOAL_AREAS: Record<string, string[]> = {
  training: ["fitness", "health"],
  cardio: ["fitness", "health"],
  fitness: ["fitness", "health"],
  nutrition: ["health", "fitness"],
  weight: ["health", "fitness"],
  wellness: ["health", "personal_growth"],
  sleep: ["health"],
  mindfulness: ["health", "personal_growth"],
  recovery: ["health"],
  learning: ["education", "career", "personal_growth"],
  career: ["career", "business", "education"],
  business: ["business", "career", "money"],
  finance: ["money", "home", "retirement"],
  money: ["money", "home"],
  relationships: ["family", "relationships"],
  family: ["family"],
  habits: ["personal_growth", "health"],
};
const STOP = new Set([
  "with",
  "from",
  "that",
  "this",
  "have",
  "want",
  "become",
  "years",
  "year",
  "more",
  "into",
  "about",
  "able",
  "being",
  "build",
  "make",
  "start",
  "would",
  "like",
  "will",
  "really",
  "better",
  "life",
  "time",
  "good",
]);
function words(s: string) {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|s)$/, "")),
  );
}

/** A goal serves a 5-year objective only when the life area matches AND the wording genuinely overlaps. */
export function servesObjective(
  g: Pick<IGoal, "title" | "domain" | "why">,
  o: IObjective,
): boolean {
  const areas = GOAL_AREAS[g.domain] ?? [];
  if (o.area !== "other" && !areas.includes(o.area)) return false;
  const gw = words(`${g.title} ${g.why ?? ""}`);
  for (const w of words(o.text)) if (gw.has(w)) return true;
  return false;
}

/** Builds the member's relationship graph from goals, milestones, blocks and the confirmed 5-year direction. */
export function buildLinks(
  goals: IGoal[],
  milestones: IMilestone[],
  blocks: IBlock[],
  objectives: IObjective[],
): Link[] {
  const live = goals.filter((g) => ACTIVE_LIKE.has(g.status));
  const ids = new Set(live.map((g) => g.id));
  const out: Link[] = [];
  objectives.forEach((o, i) => {
    for (const g of live)
      if (servesObjective(g, o))
        out.push({
          from_kind: "goal",
          from_ref: g.id,
          to_kind: "vision",
          to_ref: String(i),
          relation: "serves",
          source: "area_and_wording",
          goal_id: g.id,
        });
  });
  for (const g of live)
    for (const d of g.dependencies ?? [])
      if (ids.has(d))
        out.push({
          from_kind: "goal",
          from_ref: g.id,
          to_kind: "goal",
          to_ref: d,
          relation: "requires",
          source: "member_goal",
          goal_id: g.id,
        });
  for (const m of milestones) {
    if (!ids.has(m.goal_id)) continue;
    out.push({
      from_kind: "milestone",
      from_ref: m.id,
      to_kind: "goal",
      to_ref: m.goal_id,
      relation: "part_of",
      source: "pathway",
      goal_id: m.goal_id,
    });
    for (const k of m.depends_on ?? []) {
      const dep = milestones.find((x) => x.goal_id === m.goal_id && x.key === k);
      if (dep)
        out.push({
          from_kind: "milestone",
          from_ref: m.id,
          to_kind: "milestone",
          to_ref: dep.id,
          relation: "requires",
          source: "pathway",
          goal_id: m.goal_id,
        });
    }
  }
  for (const b of blocks)
    if (b.goal_id && ids.has(b.goal_id))
      out.push({
        from_kind: "block",
        from_ref: b.id,
        to_kind: "goal",
        to_ref: b.goal_id,
        relation: "scheduled_for",
        source: "plan",
        goal_id: b.goal_id,
      });
  return out;
}

export const linkKey = (
  l: Pick<Link, "from_kind" | "from_ref" | "to_kind" | "to_ref" | "relation">,
) => `${l.from_kind}:${l.from_ref}>${l.relation}>${l.to_kind}:${l.to_ref}`;

/** Diff between stored and current links: which to add and which are stale (target removed or changed). */
export function diffLinks(stored: { key: string }[], current: Link[]) {
  const cur = new Map(current.map((l) => [linkKey(l), l]));
  const have = new Set(stored.map((s) => s.key));
  return {
    add: [...cur.entries()].filter(([k]) => !have.has(k)).map(([, l]) => l),
    stale: stored.filter((s) => !cur.has(s.key)).map((s) => s.key),
  };
}

/** The current milestone a goal's sessions are working on: first unfinished one whose prerequisites are done. */
export function currentMilestone(ms: IMilestone[]): IMilestone | null {
  const ordered = orderMilestones(
    ms.map((m) => ({
      ...m,
      key: m.key ?? m.id,
      stage: m.stage ?? 0,
      depends_on: m.depends_on ?? [],
    })),
  );
  const doneKeys = new Set(
    ordered.filter((m) => m.done_at || m.status === "done").map((m) => m.key),
  );
  return (
    (ordered.find(
      (m) =>
        !(m.done_at || m.status === "done") && (m.depends_on ?? []).every((d) => doneKeys.has(d)),
    ) as IMilestone | undefined) ?? null
  );
}

/** "Why is this on my plan?": the real chain from a plan item up to the goal and any 5-year objective. */
export function explainItem(
  block: IBlock,
  goals: IGoal[],
  milestones: IMilestone[],
  objectives: IObjective[],
): { chain: string[]; grounded: boolean; note: string } {
  if (!block.goal_id) {
    const why =
      block.source_type === "commitment"
        ? "a fixed commitment you added"
        : block.source_type === "journey"
          ? "travel time reserved for a journey"
          : block.source_type === "booking"
            ? "a confirmed booking"
            : "an item you added directly";
    return {
      chain: [block.title],
      grounded: true,
      note: `This isn't linked to a goal; it's ${why}.`,
    };
  }
  const g = goals.find((x) => x.id === block.goal_id);
  if (!g)
    return {
      chain: [block.title],
      grounded: false,
      note: "Its goal no longer exists, so this item is left over and can be removed.",
    };
  const chain = [block.title];
  const m = currentMilestone(milestones.filter((x) => x.goal_id === g.id));
  if (m) chain.push(`milestone: ${m.title}`);
  // Upstream goals this goal itself serves (dependency chain, max 3 hops).
  const seen = new Set<string>([g.id]);
  chain.push(`goal: ${g.title}${g.status !== "active" ? ` (${g.status})` : ""}`);
  let cur: IGoal | undefined = g;
  for (let i = 0; i < 3 && cur; i++) {
    const parent: IGoal | undefined = goals.find(
      (x) => !seen.has(x.id) && (x.dependencies ?? []).includes(cur!.id),
    );
    if (!parent) break;
    seen.add(parent.id);
    chain.push(`needed for goal: ${parent.title}`);
    cur = parent;
  }
  const top = cur ?? g;
  const o = objectives.find((x) => servesObjective(top, x) || servesObjective(g, x));
  if (o) chain.push(`5-year direction: ${o.text}`);
  return {
    chain,
    grounded: true,
    note: o ? "" : "No 5-year objective is linked to this, and that's fine.",
  };
}

/* ------------------------------------------------------------------ */
/* 5. Prerequisites                                                    */
/* ------------------------------------------------------------------ */

/** Sessions planned for a goal that is still waiting on an unfinished prerequisite goal or milestone chain. */
export function prerequisiteIssues(goals: IGoal[], milestones: IMilestone[], upcoming: IBlock[]) {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const out: { goal: string; waiting_on: string[]; planned_sessions: number }[] = [];
  for (const g of goals.filter((x) => x.status === "active")) {
    const waiting = (g.dependencies ?? [])
      .map((d) => byId.get(d))
      .filter((d): d is IGoal => !!d && d.status !== "completed")
      .map((d) => d.title);
    const ms = milestones.filter((m) => m.goal_id === g.id);
    const blocked = ms
      .filter((m) => m.status === "blocked" || m.blocked_reason)
      .map(
        (m) =>
          `milestone "${m.title}" is blocked${m.blocked_reason ? `: ${m.blocked_reason}` : ""}`,
      );
    if (waiting.length || blocked.length)
      out.push({
        goal: g.title,
        waiting_on: [...waiting, ...blocked],
        planned_sessions: upcoming.filter((b) => b.goal_id === g.id).length,
      });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 6. Conflicts and priority reconciliation                            */
/* ------------------------------------------------------------------ */

export type Conflict = {
  kind: "money" | "time";
  goals: string[];
  need: number;
  available: number;
  unit: "per_month" | "min_per_week";
  message: string;
};

function monthsUntil(deadline: string | null | undefined, now: Date) {
  if (!deadline) return null;
  const m = (new Date(deadline).getTime() - now.getTime()) / (30.44 * 864e5);
  return m > 0 ? m : null;
}

/** Monthly money a goal needs: stated saving rate, else known pathway cost spread to its deadline. Null = unknown. */
export function monthlyNeed(g: IGoal, now: Date): number | null {
  if (g.monthly_saving && g.monthly_saving > 0) return g.monthly_saving;
  const cost = (g.pathway?.resources ?? [])
    .filter((r) => r.kind === "money" && r.amount)
    .reduce((s, r) => s + (r.amount ?? 0), 0);
  if (!cost) return null;
  const months = monthsUntil(g.deadline, now) ?? g.pathway?.months ?? null;
  return months ? Math.round(cost / months) : null;
}

/** Competing goals for the same money or time. Never claims a conflict when a number is unknown. */
export function detectConflicts(
  goals: IGoal[],
  ctx: { monthlyBudget: number | null; weeklyCapacityMin: number | null; currency?: string },
  now = new Date(),
): { conflicts: Conflict[]; unknowns: string[] } {
  const live = goals.filter((g) => g.status === "active" || g.status === "proposed");
  const conflicts: Conflict[] = [];
  const unknowns: string[] = [];
  const cur = ctx.currency === "USD" ? "$" : "£";
  const money = live
    .map((g) => ({ g, need: monthlyNeed(g, now) }))
    .filter((x) => x.need != null) as { g: IGoal; need: number }[];
  if (money.length) {
    if (ctx.monthlyBudget == null) {
      if (money.length >= 2) unknowns.push("how much money is available each month for goals");
    } else {
      const total = money.reduce((s, x) => s + x.need, 0);
      if (total > ctx.monthlyBudget)
        conflicts.push({
          kind: "money",
          goals: money.map((x) => x.g.title),
          need: total,
          available: ctx.monthlyBudget,
          unit: "per_month",
          message: `${money.map((x) => `${x.g.title} needs about ${cur}${x.need}/month`).join(", ")}: ${cur}${total} in total, but ${cur}${ctx.monthlyBudget}/month is available.`,
        });
    }
  }
  const timed = live.filter((g) => g.status === "active" && (g.weekly_minutes ?? 0) > 0);
  if (timed.length && ctx.weeklyCapacityMin != null) {
    const total = timed.reduce((s, g) => s + (g.weekly_minutes ?? 0), 0);
    if (total > ctx.weeklyCapacityMin)
      conflicts.push({
        kind: "time",
        goals: timed.map((g) => g.title),
        need: total,
        available: ctx.weeklyCapacityMin,
        unit: "min_per_week",
        message: `Active goals need ${Math.round(total / 6) / 10} h a week but about ${Math.round(ctx.weeklyCapacityMin / 6) / 10} h is free after commitments.`,
      });
  }
  return { conflicts, unknowns };
}

const CLASS_RANK: Record<string, number> = {
  must: 4,
  deadline_critical: 3,
  important: 2,
  long_term: 1,
  optional: 0,
};

/**
 * Suggests which goal should lead when two compete, using stated priority, priority class, deadline urgency
 * and the 5-year direction. Returns "ask" whenever the evidence doesn't clearly separate them. Never applies anything.
 */
export function reconcile(
  goals: IGoal[],
  objectives: IObjective[],
  now = new Date(),
): { decision: "ask" | "suggest"; lead: string | null; reasons: string[] } {
  if (goals.length < 2) return { decision: "ask", lead: null, reasons: [] };
  const score = (g: IGoal) => {
    const r: string[] = [];
    let s = 0;
    const cls = CLASS_RANK[g.priority_class ?? ""] ?? null;
    if (cls != null) {
      s += cls * 10;
      r.push(`marked ${g.priority_class}`);
    }
    if (g.priority != null) {
      s += (10 - Math.min(10, g.priority)) * 3;
    }
    const m = monthsUntil(g.deadline, now);
    if (m != null && m < 6) {
      s += 15;
      r.push("deadline within 6 months");
    }
    if (objectives.some((o) => servesObjective(g, o))) {
      s += 8;
      r.push("serves your 5-year direction");
    }
    return { g, s, r };
  };
  const ranked = goals.map(score).sort((a, b) => b.s - a.s);
  const [a, b] = ranked;
  if (!a || !b || a.s - b.s < 10)
    return {
      decision: "ask",
      lead: null,
      reasons: ["These look equally important from what you've told me."],
    };
  return { decision: "suggest", lead: a.g.title, reasons: a.r };
}

/* ------------------------------------------------------------------ */
/* 7. Trajectory and goal metrics                                      */
/* ------------------------------------------------------------------ */

export type Projection = {
  goal: string;
  kind: "value" | "milestones" | "savings";
  status: "ahead" | "on_track" | "behind" | "not_enough_data";
  projected_finish: string | null;
  weeks_late: number | null;
  basis: string;
};

/** Projects finish date from the real rate of progress. Needs ≥2 readings over ≥7 days, or ≥1 done milestone. */
export function projectGoal(
  g: IGoal,
  entries: { value: number; recorded_at: string }[],
  milestones: IMilestone[],
  tz: string | null,
  now = new Date(),
): Projection {
  const base: Projection = {
    goal: g.title,
    kind: "value",
    status: "not_enough_data",
    projected_finish: null,
    weeks_late: null,
    basis: "",
  };
  const deadline = g.deadline ? new Date(g.deadline) : null;
  // Savings with a stated monthly rate: deterministic arithmetic.
  if (
    g.monthly_saving &&
    g.target_value != null &&
    g.current_value != null &&
    g.monthly_saving > 0
  ) {
    const months = Math.max(0, (g.target_value - g.current_value) / g.monthly_saving);
    const finish = new Date(now.getTime() + months * 30.44 * 864e5);
    const late = deadline
      ? Math.round((finish.getTime() - deadline.getTime()) / (7 * 864e5))
      : null;
    return {
      ...base,
      kind: "savings",
      status: late == null ? "on_track" : late > 1 ? "behind" : late < -2 ? "ahead" : "on_track",
      projected_finish: finish.toISOString().slice(0, 10),
      weeks_late: late != null && late > 0 ? late : 0,
      basis: `at ${g.monthly_saving}/month from ${g.current_value} toward ${g.target_value}`,
    };
  }
  const sorted = [...entries].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
  if (sorted.length >= 2 && g.target_value != null) {
    const first = sorted[0]!,
      last = sorted[sorted.length - 1]!;
    const days =
      (new Date(last.recorded_at).getTime() - new Date(first.recorded_at).getTime()) / 864e5;
    if (days >= 7) {
      const rate = (Number(last.value) - Number(first.value)) / days;
      const remaining = g.target_value - Number(last.value);
      if (rate !== 0 && Math.sign(rate) === Math.sign(remaining)) {
        const finish = new Date(new Date(last.recorded_at).getTime() + (remaining / rate) * 864e5);
        const late = deadline
          ? Math.round((finish.getTime() - deadline.getTime()) / (7 * 864e5))
          : null;
        const t = goalTrajectory(
          {
            ...(g as TrajectoryGoal),
            created_at: g.created_at ?? first.recorded_at,
            baseline_value: g.baseline_value ?? null,
            current_value: g.current_value ?? null,
            target_unit: g.target_unit ?? null,
            deadline: g.deadline ?? null,
            target_value: g.target_value,
          },
          sorted,
          tz,
          now,
        );
        const status =
          late == null
            ? t.position === "behind"
              ? "behind"
              : "on_track"
            : late > 1
              ? "behind"
              : late < -2
                ? "ahead"
                : "on_track";
        return {
          ...base,
          status,
          projected_finish: finish.toISOString().slice(0, 10),
          weeks_late: late != null && late > 0 ? late : 0,
          basis: `${sorted.length} readings over ${Math.round(days)} days`,
        };
      }
      return {
        ...base,
        status: deadline ? "behind" : "not_enough_data",
        basis: "no progress toward the target in recent readings",
      };
    }
  }
  const ms = milestones.filter((m) => m.goal_id === g.id);
  const done = ms.filter((m) => m.done_at);
  if (ms.length >= 2 && done.length >= 1 && g.created_at) {
    const weeks = Math.max(1, (now.getTime() - new Date(g.created_at).getTime()) / (7 * 864e5));
    const pace = done.length / weeks;
    const finish = new Date(now.getTime() + ((ms.length - done.length) / pace) * 7 * 864e5);
    const late = deadline
      ? Math.round((finish.getTime() - deadline.getTime()) / (7 * 864e5))
      : null;
    return {
      ...base,
      kind: "milestones",
      status: late == null ? "on_track" : late > 1 ? "behind" : late < -2 ? "ahead" : "on_track",
      projected_finish: finish.toISOString().slice(0, 10),
      weeks_late: late != null && late > 0 ? late : 0,
      basis: `${done.length} of ${ms.length} milestones done in ${Math.round(weeks)} weeks`,
    };
  }
  return { ...base, basis: "not enough recorded progress yet to project" };
}

export type Metric = { label: string; value: string };

/** 2–4 leading indicators per goal from real records only (no vanity counts). */
export function goalMetrics(
  g: IGoal,
  blocks: IBlock[],
  milestones: IMilestone[],
  entries: { value: number; recorded_at: string }[],
  now = new Date(),
): Metric[] {
  const weekAgo = now.getTime() - 7 * 864e5;
  const past = blocks.filter(
    (b) =>
      b.goal_id === g.id &&
      new Date(b.starts_at).getTime() >= weekAgo &&
      new Date(b.starts_at).getTime() <= now.getTime() &&
      b.status !== "replaced" &&
      b.status !== "cancelled",
  );
  const out: Metric[] = [];
  if (past.length) {
    const done = past.filter((b) => DONE.has(b.status));
    out.push({ label: "Sessions this week", value: `${done.length} of ${past.length} done` });
    out.push({
      label: "Focused time",
      value: `${done.reduce((s, b) => s + b.duration_min, 0)} min`,
    });
  }
  const ms = milestones.filter((m) => m.goal_id === g.id);
  if (ms.length)
    out.push({
      label: "Milestones",
      value: `${ms.filter((m) => m.done_at).length} of ${ms.length} done`,
    });
  if (g.target_value != null) {
    const latest = entries.length
      ? [...entries].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0]!.value
      : g.current_value;
    if (latest != null)
      out.push({
        label: "Current",
        value: `${latest} of ${g.target_value}${g.target_unit ? ` ${g.target_unit}` : ""}`,
      });
  }
  return out.slice(0, 4);
}

/* ------------------------------------------------------------------ */
/* 8. Repeated-miss patterns and root causes                           */
/* ------------------------------------------------------------------ */

export const PATTERN_MIN_MISSES = 3;
export const PATTERN_MIN_RATE = 0.6;
export type Band = "morning" | "afternoon" | "evening";
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localHour(iso: string, tz: string | null) {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz ?? "UTC",
    hour: "numeric",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(iso));
  return {
    h: Number(p.find((x) => x.type === "hour")?.value ?? 0),
    wd: p.find((x) => x.type === "weekday")?.value ?? "",
  };
}
export const bandOf = (h: number): Band => (h < 12 ? "morning" : h < 17 ? "afternoon" : "evening");

export type MissPattern = {
  domain: string;
  band: Band;
  weekdays: string[];
  missed: number;
  total: number;
  cause: "after_work_or_shift" | "stated_reason" | "time_of_day";
  cause_detail: string;
};

/**
 * Finds repeated misses in the same domain and time band (≥3 misses and ≥60% missed). A cause is named only when
 * the evidence supports it: most misses straight after a work/shift commitment, or a majority stated reason.
 */
export function missPatterns(
  past: IBlock[],
  tz: string | null,
  opts: { workEnds?: Record<string, number[]>; reasons?: Record<string, string> } = {},
): { enough: boolean; patterns: MissPattern[] } {
  const rows = past.filter((b) => DONE.has(b.status) || MISSED.has(b.status));
  if (rows.length < 4) return { enough: false, patterns: [] };
  const groups = new Map<string, IBlock[]>();
  for (const b of rows) {
    const { h } = localHour(b.starts_at, tz);
    const k = `${b.domain}|${bandOf(h)}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(b);
  }
  const patterns: MissPattern[] = [];
  for (const [k, bs] of groups) {
    const missed = bs.filter((b) => MISSED.has(b.status));
    if (missed.length < PATTERN_MIN_MISSES || missed.length / bs.length < PATTERN_MIN_RATE)
      continue;
    const [domain, band] = k.split("|") as [string, Band];
    const weekdays = [...new Set(missed.map((b) => localHour(b.starts_at, tz).wd))].sort(
      (a, b) => DAY.indexOf(a) - DAY.indexOf(b),
    );
    let cause: MissPattern["cause"] = "time_of_day";
    let detail = `${missed.length} of ${bs.length} ${band} ${domain} sessions were missed.`;
    const afterWork = missed.filter((b) => {
      const day = b.starts_at.slice(0, 10);
      const { h } = localHour(b.starts_at, tz);
      return (opts.workEnds?.[day] ?? []).some((end) => h * 60 - end >= 0 && h * 60 - end <= 180);
    });
    const reasonCounts = new Map<string, number>();
    for (const b of missed) {
      const r = opts.reasons?.[b.id];
      if (r) reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
    }
    const topReason = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (afterWork.length >= Math.ceil(missed.length * 0.75)) {
      cause = "after_work_or_shift";
      detail = `${afterWork.length} of ${missed.length} missed ${band} ${domain} sessions came within 3 hours of finishing work or a shift.`;
    } else if (topReason && topReason[1] > missed.length / 2) {
      cause = "stated_reason";
      detail = `Most missed ${band} ${domain} sessions were marked "${topReason[0]}".`;
    }
    patterns.push({
      domain,
      band,
      weekdays,
      missed: missed.length,
      total: bs.length,
      cause,
      cause_detail: detail,
    });
  }
  return { enough: true, patterns };
}

/** Stronger adherence penalty for proven failure bands, fed into the existing planner's adherence objective. */
export function patternAdherence(
  patterns: MissPattern[],
): Record<string, Record<number, { done: number; total: number }>> {
  const out: Record<string, Record<number, { done: number; total: number }>> = {};
  const hours: Record<Band, number[]> = {
    morning: [5, 6, 7, 8, 9, 10, 11],
    afternoon: [12, 13, 14, 15, 16],
    evening: [17, 18, 19, 20, 21, 22],
  };
  for (const p of patterns) {
    const dom = (out[p.domain] ??= {});
    for (const h of hours[p.band]) dom[h] = { done: p.total - p.missed, total: p.total };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 9. Strategic alignment                                              */
/* ------------------------------------------------------------------ */

export function alignment(objectives: IObjective[], goals: IGoal[], upcoming: IBlock[]) {
  const active = goals.filter((g) => g.status === "active");
  return objectives.map((o) => {
    const serving = active.filter((g) => servesObjective(g, o));
    const proposed = goals
      .filter((g) => g.status === "proposed" && servesObjective(g, o))
      .map((g) => g.title);
    const sessions = upcoming.filter(
      (b) => b.goal_id && serving.some((g) => g.id === b.goal_id),
    ).length;
    return {
      objective: o.text,
      area: o.area,
      active_goals: serving.map((g) => g.title),
      proposed_goals: proposed,
      sessions_next_7_days: sessions,
      state: serving.length
        ? sessions
          ? "in_progress"
          : "active_goal_no_sessions"
        : proposed.length
          ? "proposed_only"
          : "nothing_yet",
    };
  });
}

/* ------------------------------------------------------------------ */
/* 10. Confidence                                                      */
/* ------------------------------------------------------------------ */

export type Confidence = "High" | "Medium" | "Low";
/** High only when nothing material is assumed or unknown. */
export function confidenceFrom(facts: number, assumptions: number, unknowns: number): Confidence {
  if (unknowns >= 2 || (facts === 0 && assumptions > 0)) return "Low";
  if (unknowns === 1 || assumptions >= 1) return "Medium";
  return "High";
}

/* ------------------------------------------------------------------ */
/* 11. Daily briefing and weekly review                                */
/* ------------------------------------------------------------------ */

export type BriefItem = { time: string | null; title: string; kind: string };

export function dailyBrief(input: {
  today: string;
  items: BriefItem[];
  deadlines: { title: string; due: string }[];
  risks: string[];
}) {
  const items = [...input.items].sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99"));
  const focus =
    items.find((i) => i.kind === "goal_session") ??
    items.find((i) => i.kind === "appointment" || i.kind === "booking") ??
    items[0] ??
    null;
  return {
    date: input.today,
    items,
    deadlines: input.deadlines.slice(0, 3),
    risks: input.risks.slice(0, 3),
    priority: focus ? `${focus.time ? `${focus.time} ` : ""}${focus.title}` : null,
    empty: !items.length && !input.deadlines.length,
  };
}

export function weeklyReview(
  blocks: IBlock[],
  goals: IGoal[],
  patterns: MissPattern[],
  from: Date,
  to: Date,
) {
  const inWeek = blocks.filter((b) => {
    const t = new Date(b.starts_at).getTime();
    return (
      t >= from.getTime() &&
      t < to.getTime() &&
      !["replaced", "cancelled", "planned", "snoozed"].includes(b.status)
    );
  });
  const done = inWeek.filter((b) => DONE.has(b.status));
  const missed = inWeek.filter((b) => MISSED.has(b.status));
  const byGoal = goals
    .filter((g) => g.status === "active")
    .map((g) => {
      const gb = inWeek.filter((b) => b.goal_id === g.id);
      return {
        goal: g.title,
        planned: gb.length,
        done: gb.filter((b) => DONE.has(b.status)).length,
      };
    })
    .filter((x) => x.planned);
  const noAction = goals
    .filter(
      (g) =>
        g.status === "active" &&
        !blocks.some((b) => b.goal_id === g.id && new Date(b.starts_at) >= from),
    )
    .map((g) => g.title);
  const changes: string[] = [];
  for (const p of patterns)
    changes.push(
      p.cause === "after_work_or_shift"
        ? `Move ${p.domain} sessions away from straight after work or shifts (${p.weekdays.join(", ")}).`
        : `Try a different time than ${p.band} for ${p.domain} (${p.missed} of ${p.total} missed).`,
    );
  for (const g of noAction)
    changes.push(`Schedule a first session for "${g}"; it has nothing planned.`);
  return {
    planned: inWeek.length,
    completed: done.length,
    missed: missed.length,
    completion_pct: inWeek.length ? Math.round((done.length / inWeek.length) * 100) : null,
    by_goal: byGoal,
    goals_without_actions: noAction,
    blockers: patterns.map((p) => p.cause_detail),
    next_week: changes.slice(0, 4),
    enough: inWeek.length > 0,
  };
}

/* ------------------------------------------------------------------ */
/* 12. Proactive signals (restrained)                                  */
/* ------------------------------------------------------------------ */

export type Signal = { key: string; severity: "attention" | "info"; text: string };

/** At most 3 meaningful signals, de-duplicated by key, most important first. */
export function proactiveSignals(x: {
  patterns: MissPattern[];
  projections: Projection[];
  conflicts: Conflict[];
  prereq: ReturnType<typeof prerequisiteIssues>;
  goalsWithoutActions: string[];
  alignment: ReturnType<typeof alignment>;
}): Signal[] {
  const out: Signal[] = [];
  for (const c of x.conflicts)
    out.push({ key: `conflict:${c.kind}`, severity: "attention", text: c.message });
  for (const p of x.projections)
    if (p.status === "behind" && p.weeks_late)
      out.push({
        key: `behind:${p.goal}`,
        severity: "attention",
        text: `At the current pace, ${p.goal} finishes about ${p.weeks_late} weeks later than planned.`,
      });
  for (const p of x.patterns)
    out.push({ key: `pattern:${p.domain}:${p.band}`, severity: "attention", text: p.cause_detail });
  for (const q of x.prereq)
    if (q.planned_sessions)
      out.push({
        key: `prereq:${q.goal}`,
        severity: "attention",
        text: `${q.goal} has sessions planned but is waiting on ${q.waiting_on.join("; ")}.`,
      });
  for (const g of x.goalsWithoutActions)
    out.push({ key: `noaction:${g}`, severity: "info", text: `${g} has nothing scheduled.` });
  for (const a of x.alignment)
    if (a.state === "nothing_yet")
      out.push({
        key: `vision:${a.objective}`,
        severity: "info",
        text: `Your 5-year objective "${a.objective}" has nothing active yet.`,
      });
  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true))).slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* 13. Plan decision rationale                                         */
/* ------------------------------------------------------------------ */

export type RationaleEntry = { goal_id: string | null; starts_at: string; reasons: string[] };

/**
 * Short structured reasons for each proposed placement, derived from the same inputs the planner used.
 * Kept concise: at most 3 reasons per session, only facts that were true for this placement.
 */
export function planRationale(
  proposed: { goal_id: string | null; starts_at: string; duration_min: number; domain: string }[],
  ctx: {
    previous: { goal_id: string | null; starts_at: string }[];
    energyPeak: string | null;
    patterns: MissPattern[];
    protectedDays: string[];
    tz: string | null;
  },
): RationaleEntry[] {
  return proposed.map((b) => {
    const r: string[] = [];
    const { h, wd } = localHour(b.starts_at, ctx.tz);
    const band = bandOf(h);
    const prev = ctx.previous.find(
      (p) =>
        p.goal_id === b.goal_id &&
        Math.abs(new Date(p.starts_at).getTime() - new Date(b.starts_at).getTime()) % (7 * 864e5) <
          3600e3,
    );
    if (prev) r.push("kept close to the time you've already been using");
    if (ctx.energyPeak && ctx.energyPeak === (band === "afternoon" ? "midday" : band))
      r.push(`fits your stated ${ctx.energyPeak} energy`);
    const avoided = ctx.patterns.filter((p) => p.domain === b.domain && p.band !== band);
    if (avoided.length)
      r.push(
        `moved away from ${avoided.map((p) => p.band).join("/")}, where this kept being missed`,
      );
    if (ctx.protectedDays.length && !ctx.protectedDays.includes(wd))
      r.push(`keeps ${ctx.protectedDays.join(", ")} free for fixed commitments`);
    return { goal_id: b.goal_id, starts_at: b.starts_at, reasons: r.slice(0, 3) };
  });
}
