// Goal Mission: the durable orchestration record that turns a member's outcome into reality.
// Pure rules only (state machine, contract, clarification, expert tiering, blockers, synthesis,
// root cause, proactive checks). It orchestrates the existing engines and never duplicates them:
// pathway.ts (milestones/feasibility), research.functions.ts (live sources), life-intelligence.ts
// (routing, conflicts, projection, miss patterns) and scheduler.ts (placement).

export const MISSION_STATES = [
  "CAPTURED",
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
] as const;
export type MissionState = (typeof MISSION_STATES)[number];

/** Allowed transitions. ACHIEVED is only reachable from VERIFYING (never faked). */
const NEXT: Record<MissionState, MissionState[]> = {
  CAPTURED: ["UNDERSTANDING", "RESEARCHING", "MODELLING"],
  UNDERSTANDING: ["RESEARCHING", "MODELLING", "FEASIBILITY_CHECK"],
  RESEARCHING: ["MODELLING", "FEASIBILITY_CHECK", "UNDERSTANDING"],
  MODELLING: ["FEASIBILITY_CHECK", "RESEARCHING", "UNDERSTANDING"],
  FEASIBILITY_CHECK: ["PATHWAY_READY", "BLOCKED", "UNDERSTANDING", "RESEARCHING"],
  PATHWAY_READY: ["PLANNING", "FEASIBILITY_CHECK"],
  PLANNING: ["SCHEDULED", "BLOCKED"],
  SCHEDULED: ["EXECUTING", "ADAPTING", "BLOCKED"],
  EXECUTING: ["ADAPTING", "BLOCKED", "VERIFYING", "SCHEDULED"],
  BLOCKED: ["ADAPTING", "UNDERSTANDING", "RESEARCHING", "FEASIBILITY_CHECK"],
  ADAPTING: ["FEASIBILITY_CHECK", "PLANNING", "SCHEDULED", "EXECUTING"],
  VERIFYING: ["ACHIEVED", "EXECUTING", "ADAPTING"],
  ACHIEVED: [],
};
export function canMove(from: MissionState, to: MissionState) {
  return from === to || NEXT[from].includes(to);
}

/** Member-facing stage words (no internal jargon). */
export const STAGE_LABEL: Record<MissionState, string> = {
  CAPTURED: "Getting started",
  UNDERSTANDING: "Understanding what you want",
  RESEARCHING: "Checking the facts",
  MODELLING: "Mapping the route",
  FEASIBILITY_CHECK: "Checking it fits your life",
  PATHWAY_READY: "Route ready",
  PLANNING: "Planning",
  SCHEDULED: "On your plan",
  EXECUTING: "In progress",
  BLOCKED: "Needs attention",
  ADAPTING: "Adjusting the plan",
  VERIFYING: "Checking it's done",
  ACHIEVED: "Achieved",
};

// ---------------- Expert routing ----------------
export const EXPERTS = [
  "career",
  "learning",
  "business",
  "finance",
  "property",
  "time",
  "habits",
  "accountability",
  "fitness",
  "nutrition",
  "sleep",
  "wellbeing",
  "relationships",
  "decision",
  "transition",
  "research",
  "logistics",
  "risk",
] as const;
export type Expert = (typeof EXPERTS)[number];

const EXPERT_CUES: [Expert, RegExp][] = [
  [
    "career",
    /\b(job|career|promot|employ|work as|become an?|role|profession|quit|leave my job|surveyor|manager|engineer)\b/i,
  ],
  [
    "learning",
    /\b(qualif|degree|course|exam|study|learn|certif|apprentice|chartered|accredit|university)\b/i,
  ],
  [
    "business",
    /\b(business|company|startup|start[- ]?up|self[- ]employ|client|customers?|brand|sell|launch|own my own)\b/i,
  ],
  [
    "finance",
    /\b(money|financ|sav(e|ing)|debt|income|£|\$|budget|afford|wealth|invest|financial freedom|salary|retire)\b/i,
  ],
  [
    "property",
    /\b(property|buy a (house|home|flat)|mortgage|landlord|buy[- ]to[- ]let|house deposit)\b/i,
  ],
  ["fitness", /\b(fit|fitness|gym|train|muscle|strength|run|marathon|weight|kg|lose|tone)\b/i],
  ["nutrition", /\b(diet|meal|eat|food|protein|calorie|nutrition|kg)\b/i],
  ["sleep", /\b(sleep|tired|rest|insomnia|recover)\b/i],
  ["wellbeing", /\b(stress|anxi|happ|wellbeing|mental|calm|burn ?out|better life)\b/i],
  ["relationships", /\b(partner|marri|family|kids?|son|daughter|friend|relationship|dating)\b/i],
  ["learning", /\b(write|writing|book|novel|publish|author|manuscript)\b/i],
  ["habits", /\b(habit|routine|consisten|discipline|every day|daily)\b/i],
  ["transition", /\b(leave|quit|move|relocat|change (career|job)|transition|retire)\b/i],
  ["decision", /\b(should i|decide|choice|option|or\b)/i],
];

/** Hidden routing: which specialists a goal needs. Time and risk join anything non-trivial. */
export function routeExperts(text: string, domains: string[] = []): Expert[] {
  const out = new Set<Expert>();
  for (const [e, re] of EXPERT_CUES) if (re.test(text)) out.add(e);
  for (const d of domains) {
    const m = d.toLowerCase();
    if (/career/.test(m)) out.add("career");
    if (/learn|educat/.test(m)) out.add("learning");
    if (/financ|money/.test(m)) out.add("finance");
    if (/business/.test(m)) out.add("business");
    if (/train|fitness|health/.test(m)) out.add("fitness");
    if (/nutri/.test(m)) out.add("nutrition");
    if (/sleep|recover/.test(m)) out.add("sleep");
    if (/wellbeing|mind/.test(m)) out.add("wellbeing");
    if (/relation|family/.test(m)) out.add("relationships");
  }
  // Leaving income or starting a company always has a money side.
  if (out.has("business") || (out.has("transition") && out.has("career"))) out.add("finance");
  if (out.size) out.add("time");
  if (out.size >= 3) out.add("risk");
  if (needsResearch(text)) out.add("research");
  return [...out];
}

export type MissionTier = "simple" | "moderate" | "complex";
/** Progressive intelligence: never send every request to every expert. */
export function tierFor(experts: Expert[]): MissionTier {
  const core = experts.filter((e) => e !== "time" && e !== "risk" && e !== "research");
  if (core.length >= 3 || (core.includes("transition") && core.length >= 2)) return "complex";
  if (core.length === 2) return "moderate";
  return "simple";
}

/** Current external facts change the plan: research before planning. */
export function needsResearch(text: string) {
  return /\b(qualif|degree|course|licen[cs]e|accredit|chartered|regulat|become an?|surveyor|nurse|solicitor|electrician|plumber|requirement|visa|register|permit|grant|start (a|my) (business|company)|limited company|construction)\b/i.test(
    text,
  );
}

// ---------------- Dream → concrete outcome ----------------
const VAGUE =
  /\b(financial freedom|better life|be successful|successful|own (my own )?business|my own business|happ(y|ier)|get into property|change my life|be rich|wealthy|get fit|sort my life|be better)\b/i;
const MEASURABLE =
  /\d|by (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|next|the end|\d)|\bkg\b|£|\$|per (month|week|year)|%/i;

export function isVagueDream(text: string) {
  return VAGUE.test(text) && !MEASURABLE.test(text);
}

export type Clarifier = { key: string; question: string };
/** The minimum high-value questions (max 3), chosen by what is missing. Never interrogate. */
export function clarifiersFor(
  text: string,
  known: Partial<Record<string, unknown>> = {},
): Clarifier[] {
  const t = text.toLowerCase();
  const q: Clarifier[] = [];
  const add = (key: string, question: string) => {
    if (known[key] == null && !q.some((x) => x.key === key)) q.push({ key, question });
  };
  if (/financial freedom|rich|wealth/.test(t)) {
    add(
      "success",
      "What would financial freedom look like for you: a monthly income that covers your bills without working, being debt-free, or a savings figure?",
    );
    add(
      "current",
      "Roughly where are you now: monthly take-home pay, monthly costs and any debts?",
    );
    add("horizon", "By when would you like to reach it?");
  } else if (
    /\b(scale|grow|expand)\b/.test(t) &&
    /\b(my|our)\s+(company|business|startup|platform|app|brand|shop)\b/.test(t)
  ) {
    // An existing company: its stage decides what the work is, so ask only what it is and where it stands.
    add("success", "What does your company do, in a sentence?");
    add(
      "current",
      "Where is it now: not launched yet, or launched (roughly how many users or customers, and any revenue)?",
    );
  } else if (/business|company/.test(t)) {
    add(
      "success",
      "What kind of business, and what would success mean in the first year: a side income, replacing your salary, or something bigger?",
    );
    add(
      "current",
      "What's your starting point: relevant experience, savings you could use, and are you employed now?",
    );
    add("horizon", "How soon do you want it running?");
  } else if (/fit/.test(t)) {
    add(
      "success",
      "What does fit mean for you: stronger, leaner, more stamina, or a specific event?",
    );
    add(
      "current",
      "How active are you now, and do you have any injuries or health conditions I should plan around?",
    );
    add("time", "How many days a week and how long per session can you realistically give it?");
  } else if (/book|novel|publish|write/.test(t)) {
    add(
      "success",
      "What kind of book is it (novel, non-fiction, memoir...), and does publishing mean self-publishing or finding a traditional publisher?",
    );
    add(
      "current",
      "How far along are you: idea only, outline, or some chapters written? And how much time can you write each week?",
    );
    add("horizon", "By when would you like it published?");
  } else if (/property/.test(t)) {
    add("success", "Is this your own home, a buy-to-let, or something else?");
    add("current", "What savings and income do you have to work with now?");
    add("horizon", "By when?");
  } else {
    add(
      "success",
      "What would it look like if you'd achieved it? Describe the end result in a sentence.",
    );
    add("current", "Where are you starting from right now?");
    add("horizon", "By when would you like it?");
  }
  return q.slice(0, 3);
}

// ---------------- Goal Definition Contract ----------------
export type Contract = {
  desired_outcome: string;
  definition_of_done: string | null;
  target_horizon: string | null;
  current_state: string | null;
  life_direction: string | null;
  success_metrics: string[];
  constraints: string[];
  resources: string[];
  prerequisites: string[];
  dependencies: string[];
  assumptions: string[];
  unknowns: string[];
  risks: string[];
  evidence_required: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

export function buildContract(input: Partial<Contract> & { desired_outcome: string }): Contract {
  const c: Contract = {
    desired_outcome: input.desired_outcome.slice(0, 300),
    definition_of_done: input.definition_of_done ?? null,
    target_horizon: input.target_horizon ?? null,
    current_state: input.current_state ?? null,
    life_direction: input.life_direction ?? null,
    success_metrics: (input.success_metrics ?? []).slice(0, 6),
    constraints: (input.constraints ?? []).slice(0, 10),
    resources: (input.resources ?? []).slice(0, 10),
    prerequisites: (input.prerequisites ?? []).slice(0, 10),
    dependencies: (input.dependencies ?? []).slice(0, 10),
    assumptions: (input.assumptions ?? []).slice(0, 10),
    unknowns: [...(input.unknowns ?? [])].slice(0, 10),
    risks: (input.risks ?? []).slice(0, 10),
    evidence_required: input.evidence_required ?? null,
    confidence: "LOW",
  };
  if (!c.definition_of_done) c.unknowns.push("what done looks like");
  if (!c.target_horizon) c.unknowns.push("target date");
  if (!c.current_state) c.unknowns.push("starting point");
  c.unknowns = [...new Set(c.unknowns)];
  c.confidence = confidenceOf(c);
  return c;
}

export function confidenceOf(c: Contract): Contract["confidence"] {
  const known =
    [c.definition_of_done, c.target_horizon, c.current_state].filter(Boolean).length +
    Math.min(2, c.success_metrics.length);
  if (known >= 4 && c.unknowns.length <= 1) return "HIGH";
  if (known >= 2) return "MEDIUM";
  return "LOW";
}

/** Merge new facts into a saved contract without losing earlier ones. */
export function mergeContract(prev: Partial<Contract>, patch: Partial<Contract>): Contract {
  const arr = (k: keyof Contract) => [
    ...new Set([...((prev[k] as string[]) ?? []), ...((patch[k] as string[]) ?? [])]),
  ];
  const merged = buildContract({
    ...prev,
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null && !Array.isArray(v))),
    desired_outcome: patch.desired_outcome ?? prev.desired_outcome ?? "",
    success_metrics: arr("success_metrics"),
    constraints: arr("constraints"),
    resources: arr("resources"),
    prerequisites: arr("prerequisites"),
    dependencies: arr("dependencies"),
    assumptions: arr("assumptions"),
    risks: arr("risks"),
    // Patch unknowns replace earlier ones (resolved facts drop out); core gaps are re-added by buildContract.
    unknowns:
      patch.unknowns ??
      ((prev.unknowns as string[]) ?? []).filter(
        (u) => !["what done looks like", "target date", "starting point"].includes(u),
      ),
  });
  return merged;
}

/** Ready to plan only when the outcome is concrete (done + horizon + starting point known). */
export function readyForPathway(c: Contract) {
  return Boolean(c.definition_of_done && c.target_horizon && c.current_state);
}

// ---------------- Blockers ----------------
export type BlockerKind = "HARD" | "SOFT" | "UNKNOWN" | "RESOLVABLE";
export type Blocker = {
  kind: BlockerKind;
  area: string;
  detail: string;
  route_around: string | null;
};

export function classifyBlocker(rawArea: string, detail: string): Blocker {
  const d = detail.toLowerCase();
  const ar = rawArea.toLowerCase();
  const area =
    /financ|money|cost|budget|afford|fund/.test(ar) || /afford|savings|cost|fund/.test(d)
      ? "money"
      : /time|hour|schedul/.test(ar)
        ? "time"
        : /health|injur|medical/.test(ar)
          ? "health"
          : rawArea;
  let kind: BlockerKind = "SOFT";
  if (/unknown|not sure|unclear|not stated|needs checking|not yet known/.test(d)) kind = "UNKNOWN";
  else if (/legal|illegal|age limit|medical(ly)? not|banned|not permitted|cannot legally/.test(d))
    kind = "HARD";
  else if (
    /prerequisite|qualif|licen[cs]|form|application|enrol|register|missing|not (yet )?(done|complete)/.test(
      d,
    )
  )
    kind = "RESOLVABLE";
  const around: Record<BlockerKind, string | null> = {
    HARD:
      area === "health" ? "Get professional clearance first, then plan around any limits." : null,
    SOFT:
      area === "time"
        ? "Smaller sessions, a later date, or pause a lower-priority goal."
        : area === "money"
          ? "Save first, lower-cost route, or stage the spend."
          : "Adjust size or timing.",
    UNKNOWN: "Ask the member or research it before planning.",
    RESOLVABLE: "Schedule the prerequisite as the first action.",
  };
  return { kind, area, detail: detail.slice(0, 300), route_around: around[kind] };
}

// ---------------- Pathway options ----------------
export type RouteOption = {
  key: string;
  name: string;
  months: number | null;
  cost: number | null;
  needs: string[];
  risk: "low" | "medium" | "high";
  fits_schedule: boolean;
  member_preference?: number;
};

/** Deterministic comparison against the member's real factors. Returns ranked keys and why. */
export function compareRoutes(
  options: RouteOption[],
  member: { budget?: number | null; horizonMonths?: number | null; has?: string[] },
) {
  const has = new Set((member.has ?? []).map((x) => x.toLowerCase()));
  const scored = options.map((o) => {
    let s = 0;
    const why: string[] = [];
    if (o.months != null && member.horizonMonths != null) {
      if (o.months <= member.horizonMonths) {
        s += 3;
        why.push("fits your timeframe");
      } else {
        s -= 2;
        why.push(`takes about ${o.months} months, longer than your timeframe`);
      }
    }
    if (o.cost != null && member.budget != null) {
      if (o.cost <= member.budget) {
        s += 2;
        why.push("within your budget");
      } else {
        s -= 3;
        why.push("costs more than you have now");
      }
    }
    const met = o.needs.filter((n) => has.has(n.toLowerCase())).length;
    s += met * 2 - (o.needs.length - met);
    if (met) why.push(`you already have ${met} of ${o.needs.length} entry needs`);
    s += o.fits_schedule ? 2 : -2;
    if (!o.fits_schedule) why.push("clashes with your current schedule");
    s += o.risk === "low" ? 1 : o.risk === "high" ? -1 : 0;
    s += o.member_preference ?? 0;
    return { key: o.key, name: o.name, score: s, why };
  });
  scored.sort((a, b) => b.score - a.score);
  return { ranked: scored, recommended: scored[0]?.key ?? null };
}

// ---------------- Council synthesis ----------------
export type ExpertView = {
  expert: Expert;
  stance: string;
  constraint?: string;
  urgency?: "now" | "soon" | "later";
};
export type CouncilRecord = {
  views: ExpertView[];
  disagreements: { between: Expert[]; about: string }[];
  alternatives: string[];
  trade_offs: string[];
  selected_route: string;
  rationale: string;
  confidence: Contract["confidence"];
  assumptions: string[];
  decided_at: string;
};

/** Reconciles specialist views into one route. Safety constraints (finance, risk, time) bind; urgency yields to them. */
export function synthesise(
  views: ExpertView[],
  chosen: string,
  opts: {
    alternatives?: string[];
    assumptions?: string[];
    confidence?: Contract["confidence"];
    now?: Date;
  } = {},
): CouncilRecord {
  const urg = views.filter((v) => v.urgency === "now");
  const binding = views.filter(
    (v) => v.constraint && ["finance", "risk", "time", "fitness", "wellbeing"].includes(v.expert),
  );
  const disagreements = urg.flatMap((u) =>
    binding
      .filter((b) => b.expert !== u.expert)
      .map((b) => ({
        between: [u.expert, b.expert] as Expert[],
        about: `${u.stance} vs ${b.constraint}`,
      })),
  );
  const trade = disagreements.map(
    (d) =>
      `Moving faster (${d.between[0]}) is limited by ${d.between[1]}: ${d.about.split(" vs ")[1]}`,
  );
  return {
    views,
    disagreements,
    alternatives: opts.alternatives ?? [],
    trade_offs: trade,
    selected_route: chosen,
    rationale: binding.length
      ? `Chosen to respect ${binding.map((b) => b.constraint).join("; ")} while still moving forward.`
      : `Chosen as the most direct route that fits the member's situation.`,
    confidence: opts.confidence ?? "MEDIUM",
    assumptions: opts.assumptions ?? [],
    decided_at: (opts.now ?? new Date()).toISOString(),
  };
}

// ---------------- Execution-ready actions ----------------
export type ReadyAction = {
  objective: string;
  action: string;
  first_step: string;
  minutes: number;
  done_when: string;
  evidence: EvidenceKind;
  next_action: string | null;
  resource?: string | null;
};
const VAGUE_ACTION =
  /^(work on|do|think about|look into|start|continue|progress|keep going with|research)\b[^,.]{0,25}$/i;
export function actionProblems(a: Partial<ReadyAction>): string[] {
  const p: string[] = [];
  if (!a.objective) p.push("objective");
  if (!a.action || a.action.length < 12 || VAGUE_ACTION.test(a.action.trim()))
    p.push("exact action (too vague)");
  if (!a.first_step) p.push("first step");
  if (!a.minutes || a.minutes < 5) p.push("duration");
  if (!a.done_when) p.push("definition of done");
  return p;
}

// ---------------- Evidence ----------------
export type EvidenceKind =
  | "member_confirmation"
  | "workout_logged"
  | "meal_logged"
  | "metric_recorded"
  | "quiz_passed"
  | "artefact_uploaded"
  | "booking_confirmed"
  | "call_result"
  | "module_finished"
  | "saved_output";
/** Evidence burden matched to importance. */
export function evidenceFor(kind: string, importance: "low" | "medium" | "high"): EvidenceKind {
  const k = kind.toLowerCase();
  if (/workout|training|gym|run/.test(k)) return "workout_logged";
  if (/meal|eat|nutrition/.test(k)) return "meal_logged";
  if (/book|appointment|reservation/.test(k)) return "booking_confirmed";
  if (/call/.test(k)) return "call_result";
  if (/learn|study|course|module/.test(k))
    return importance === "high" ? "quiz_passed" : "module_finished";
  if (/weigh|measure|metric|save|money/.test(k)) return "metric_recorded";
  if (/write|draft|cv|document|plan/.test(k))
    return importance === "low" ? "member_confirmation" : "saved_output";
  return importance === "high" ? "artefact_uploaded" : "member_confirmation";
}

// ---------------- Root cause from outcomes ----------------
export type Outcome = {
  status: string;
  minutes?: number | null;
  planned_minutes?: number | null;
  reason?: string | null;
  hour?: number | null;
  clashed?: boolean;
};
export type RootCause =
  | "time_conflict"
  | "too_long"
  | "unclear_action"
  | "missing_prerequisite"
  | "fatigue"
  | "cost"
  | "low_priority"
  | "motivation"
  | "unsuitable_pathway"
  | "none";
export function rootCause(outs: Outcome[]): { cause: RootCause; evidence: string; fix: string } {
  const missed = outs.filter((o) => /missed|skipped|expired|failed|blocked/.test(o.status));
  if (missed.length < 2)
    return { cause: "none", evidence: "not enough misses to show a pattern", fix: "keep going" };
  const reasons = missed.map((o) => (o.reason ?? "").toLowerCase()).join(" ");
  const count = (re: RegExp) => (reasons.match(re) ?? []).length;
  const pick = (cause: RootCause, evidence: string, fix: string) => ({ cause, evidence, fix });
  if (
    missed.filter((o) => o.clashed).length >= 2 ||
    count(/work|meeting|busy|clash|kids|school/g) >= 2
  )
    return pick(
      "time_conflict",
      `${missed.length} misses at times that clash with other commitments`,
      "move these sessions to a time that has been kept before",
    );
  if (count(/tired|exhaust|sleep|fatigue|ill/g) >= 2)
    return pick(
      "fatigue",
      "missed when tired",
      "lighter sessions earlier in the week and protect sleep",
    );
  if (count(/didn'?t know|unclear|confus|not sure what/g) >= 1)
    return pick(
      "unclear_action",
      "member wasn't sure what to do",
      "rewrite the session with an exact first step",
    );
  if (count(/need|missing|don'?t have|can'?t until/g) >= 2)
    return pick(
      "missing_prerequisite",
      "something needed first was missing",
      "schedule the prerequisite before this action",
    );
  if (count(/cost|money|afford|expens/g) >= 1)
    return pick("cost", "cost was the barrier", "find a lower-cost route or stage the spend");
  const long = missed.filter((o) => o.planned_minutes && o.planned_minutes >= 60).length;
  if (long >= Math.ceil(missed.length * 0.6))
    return pick(
      "too_long",
      `${long} of ${missed.length} missed sessions were an hour or longer`,
      "split into shorter sessions",
    );
  if (missed.length >= 4 && count(/bored|motivat|couldn'?t be bothered|didn'?t feel/g) >= 1)
    return pick(
      "motivation",
      "low drive reported",
      "smaller wins, accountability call, link to why it matters",
    );
  if (missed.length >= 6)
    return pick(
      "unsuitable_pathway",
      `${missed.length} misses despite changes`,
      "review the route itself with the member",
    );
  return pick(
    "low_priority",
    `${missed.length} misses without a clear reason`,
    "ask whether this goal still matters right now, or reduce it",
  );
}

// ---------------- Proactive mission checks ----------------
export type MissionSignal = { key: string; message: string; severity: "info" | "warn" };
export function missionSignals(m: {
  title: string;
  state: MissionState;
  projection?: { status?: string; weeks_late?: number | null } | null;
  openPrereqs?: { title: string; due?: string | null }[];
  nextSessionAt?: string | null;
  deadline?: string | null;
  now: Date;
}): MissionSignal[] {
  const s: MissionSignal[] = [];
  const days = (iso: string) => Math.round((new Date(iso).getTime() - m.now.getTime()) / 86400000);
  for (const p of m.openPrereqs ?? []) {
    if (p.due && days(p.due) >= 0 && days(p.due) <= 14)
      s.push({
        key: `prereq:${p.title}`,
        severity: "warn",
        message: `${p.title} for "${m.title}" is due in ${days(p.due)} days and is still open.`,
      });
  }
  if (m.projection?.status === "behind")
    s.push({
      key: "behind",
      severity: "warn",
      message: `"${m.title}" is behind${m.projection.weeks_late ? ` by about ${m.projection.weeks_late} weeks` : ""} at the current pace.`,
    });
  if (["SCHEDULED", "EXECUTING"].includes(m.state) && !m.nextSessionAt)
    s.push({
      key: "no_next",
      severity: "warn",
      message: `"${m.title}" has nothing scheduled next.`,
    });
  if (m.state === "BLOCKED")
    s.push({
      key: "blocked",
      severity: "warn",
      message: `"${m.title}" is blocked and needs a decision.`,
    });
  return s.slice(0, 1); // one useful note per mission, never spam
}
