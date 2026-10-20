// Universal goal pathway model. Pure and deterministic: AI/research only proposes the pathway content;
// validation, dependency order, time/money feasibility, rolling horizon, evidence and blocked-path rules live here.
import { createsCycle } from "./goals";
import { detectSignals } from "./safety";

export const PATHWAY_ENGINE_VERSION = "pathway_v1";

export const SUCCESS_TYPES = ["binary", "measurable", "milestones", "external"] as const;
export type SuccessType = (typeof SUCCESS_TYPES)[number];

export const CAPABILITIES = [
  "plexecute_executes",
  "plexecute_assists",
  "plexecute_schedules",
  "plexecute_researches",
  "plexecute_books",
  "user_performs",
  "professional_required",
  "external_approval",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const CAPABILITY_LABEL: Record<Capability, string> = {
  plexecute_executes: "Plexecute does this for you",
  plexecute_assists: "Plexecute helps you do this",
  plexecute_schedules: "Plexecute schedules and reminds you",
  plexecute_researches: "Plexecute researches this",
  plexecute_books: "Plexecute can book this (Execute)",
  user_performs: "You do this",
  professional_required: "A qualified professional is needed",
  external_approval: "Needs approval from an outside body",
};

export const EVIDENCE_TYPES = [
  "user_confirms",
  "result_recorded",
  "document",
  "application_submitted",
  "amount_reached",
  "session_completed",
  "appointment_attended",
] as const;
export type Evidence = (typeof EVIDENCE_TYPES)[number];
export const EVIDENCE_LABEL: Record<Evidence, string> = {
  user_confirms: "You confirm it's done",
  result_recorded: "Result recorded (e.g. pass mark)",
  document: "Document or certificate noted",
  application_submitted: "Application reference noted",
  amount_reached: "Amount reached",
  session_completed: "Sessions completed",
  appointment_attended: "Appointment attended",
};

export const PREREQ_KINDS = [
  "age",
  "qualification",
  "licence",
  "savings",
  "experience",
  "application",
  "approval",
  "equipment",
  "location",
  "eligibility",
  "documentation",
  "other",
] as const;
export const RESOURCE_KINDS = [
  "money",
  "time",
  "equipment",
  "transport",
  "location",
  "qualification",
  "access",
  "people",
  "software",
  "documents",
  "subscription",
  "other",
] as const;
export const PRIORITY_CLASSES = [
  "must",
  "important",
  "optional",
  "deadline_critical",
  "long_term",
] as const;
export type PriorityClass = (typeof PRIORITY_CLASSES)[number];

export type Source = {
  url: string;
  title: string;
  publisher: string;
  trust: string;
  retrieved_at: string;
  fact: string;
  jurisdiction: string | null;
};
export type Action = { title: string; minutes: number; capability: Capability; done?: boolean };
export type Milestone = {
  key: string;
  title: string;
  stage: number;
  depends_on: string[];
  effort_hours: number;
  /** Calendar floor, e.g. a 12-week course or exam booking lead time. */
  min_weeks: number;
  cost: number;
  evidence: Evidence;
  capability: Capability;
  major: boolean;
  source_refs: number[];
  actions: Action[];
  status?: "pending" | "active" | "blocked" | "failed" | "done";
};
export type PathwayOption = {
  key: string;
  title: string;
  summary: string;
  months: number;
  cost: number;
  risk: string;
};
export type Prerequisite = {
  title: string;
  kind: (typeof PREREQ_KINDS)[number];
  met: boolean | null;
};
export type Resource = {
  title: string;
  kind: (typeof RESOURCE_KINDS)[number];
  amount: number | null;
};
export type PathwayDraft = {
  goal_title: string;
  outcome: string;
  domain: string;
  success: { type: SuccessType; definition: string; target: number | null; unit: string | null };
  jurisdiction: string | null;
  options: PathwayOption[];
  chosen_option: string | null;
  choice_reason: string | null;
  prerequisites: Prerequisite[];
  resources: Resource[];
  milestones: Milestone[];
  assumptions: string[];
  risks: string[];
  sources: Source[];
  research_confidence: "high" | "mixed" | "low" | "none";
};

// ---------- Intake screening (deterministic, before any AI cost) ----------

const RESTRICTED: [RegExp, string][] = [
  [
    /\b(hack|break into|steal|launder|counterfeit|forge|fraud|scam|evade tax|smuggl)/i,
    "It involves something illegal.",
  ],
  [
    /\b(bomb|weapon|poison|hurt|kill)\b(?!.*\b(fear|anxiety|phobia)\b)/i,
    "It could cause harm to people.",
  ],
  [
    /\b(stalk|track (my|an?) (ex|partner)|spy on)\b/i,
    "It involves monitoring someone without consent.",
  ],
  [
    /\blose\s+\d+\s*(kg|lbs?|pounds|stone)\s+in\s+(a|one|1|2|two)\s+(day|week)s?\b/i,
    "That rate of weight loss is unsafe.",
  ],
  [/\b(stop eating|starve|purge)\b/i, "It could seriously harm your health."],
];
/** Hard refusal reason for illegal or unsafe goals, else null. Crisis language is handled by the safety system. */
export function restrictedGoal(text: string): string | null {
  for (const [re, why] of RESTRICTED) if (re.test(text)) return why;
  return null;
}
export function safetySignals(text: string) {
  return detectSignals(text);
}

const VAGUE =
  /^(i want to |i'd like to |help me )?(be|get|feel|become)?\s*(healthier|better|happier|fitter|more (productive|successful|organised|organized|confident)|successful|rich|sorted|my life together)\.?$/i;
/** Short clarifying questions only when the goal has no concrete outcome yet (max 3). */
export function clarifyingQuestions(
  text: string,
  known: { deadline?: string | null | undefined; jurisdiction?: string | null | undefined } = {},
): string[] {
  const t = text.trim();
  const q: string[] = [];
  const words = t.split(/\s+/).length;
  if (VAGUE.test(t) || words < 2)
    q.push(
      "What would be different when you've achieved this? Pick one concrete result (for example a number, a qualification, or something finished).",
    );
  if (!known.deadline && VAGUE.test(t)) q.push("By roughly when would you like it done?");
  if (
    !known.jurisdiction &&
    JURISDICTIONAL.test(t) &&
    !/\b(uk|united kingdom|england|scotland|wales|us|usa|united states|america)\b/i.test(t)
  )
    q.push("Which country will you be doing this in? Requirements differ by country.");
  return q.slice(0, 3);
}

const JURISDICTIONAL =
  /\b(qualif|licen[cs]|certif|registered|degree|university|college|apprentice|pilot|electrician|plumber|nurse|doctor|lawyer|solicitor|accountant|teacher|visa|immigra|move to|emigrat|mortgage|buy (a |my )?(first )?(house|home|flat)|planning permission|driving test|citizenship)/i;
const CURRENT_INFO =
  /\b(cost|price|fee|deadline|apply|application|requirement|entry|eligib|exam|course|programme|program|regulat|rules?|process)\b/i;
const STABLE =
  /\b(run|marathon|10k|5k|piano|guitar|read|write|novel|public speaking|meditat|sleep|weight|strength|habit|declutter|organis|organiz|save|savings|spanish|french|language)\b/i;
/** Deterministic research trigger (brief §25): research only when facts are current, regulated, priced, dated or jurisdictional. */
export function researchTrigger(text: string): { required: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (JURISDICTIONAL.test(text))
    reasons.push("Requirements are set by official or regulated bodies and differ by country.");
  if (CURRENT_INFO.test(text) && !STABLE.test(text))
    reasons.push("Costs, deadlines or entry rules can change.");
  return { required: reasons.length > 0, reasons };
}

const REGULATED: [RegExp, string][] = [
  [
    /\b(surgery|treatment|medication|diagnos|ivf|therapy for)\b/i,
    "Medical decisions stay with a qualified clinician; Plexecute can organise appointments and steps.",
  ],
  [
    /\b(divorce|custody|sue|lawsuit|will and testament|legal case|immigration appeal)\b/i,
    "Legal advice must come from a qualified solicitor or lawyer; Plexecute can organise the process.",
  ],
  [
    /\b(buy (a |my )?(first )?(house|home|flat)|conveyanc)/i,
    "Mortgage advice and conveyancing come from regulated advisers and solicitors; Plexecute plans the saving and the steps.",
  ],
  [
    /\b(invest|pension|mortgage|debt|isa|401k|stocks|crypto)\b/i,
    "Plexecute is not a regulated financial adviser; it plans saving and steps, not product choices.",
  ],
  [
    /\b(depression|ptsd|eating disorder|bipolar|ocd)\b/i,
    "Mental-health treatment belongs with a qualified professional; Plexecute supports routines around it.",
  ],
  [
    /\b(pilot|electrician|nurse|doctor|solicitor|lawyer|accountant|surveyor|pharmacist|engineer|teacher|paramedic)\b/i,
    "Only the licensing or awarding body can grant this; Plexecute plans and supports the route.",
  ],
];
export function professionalBoundary(text: string): string | null {
  for (const [re, note] of REGULATED) if (re.test(text)) return note;
  return null;
}

// ---------- Validation and ordering ----------

const VAGUE_ACTION =
  /^(work on|think about|focus on|keep going|do stuff|try to|be better|improve)\b/i;
const clampN = (n: unknown, lo: number, hi: number, d = lo) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
};

/** Cleans an AI draft into safe bounded values. Never invents facts: unknowns stay null/zero. */
export function normalisePathway(raw: any): PathwayDraft {
  const ms: Milestone[] = (Array.isArray(raw?.milestones) ? raw.milestones : [])
    .slice(0, 24)
    .map((m: any, i: number) => ({
      key: String(m?.key || `m${i + 1}`).slice(0, 40),
      title: String(m?.title ?? "").slice(0, 160),
      stage: Math.round(clampN(m?.stage, 1, 12, 1)),
      depends_on: (Array.isArray(m?.depends_on) ? m.depends_on : []).map(String).slice(0, 10),
      effort_hours: clampN(m?.effort_hours, 0, 5000, 0),
      min_weeks: Math.round(clampN(m?.min_weeks, 0, 520, 0)),
      cost: clampN(m?.cost, 0, 10_000_000, 0),
      evidence: (EVIDENCE_TYPES as readonly string[]).includes(m?.evidence)
        ? m.evidence
        : "user_confirms",
      capability: (CAPABILITIES as readonly string[]).includes(m?.capability)
        ? m.capability
        : "user_performs",
      major: !!m?.major,
      source_refs: (Array.isArray(m?.source_refs) ? m.source_refs : [])
        .map(Number)
        .filter(Number.isInteger),
      actions: (Array.isArray(m?.actions) ? m.actions : []).slice(0, 8).map((a: any) => ({
        title: String(a?.title ?? "").slice(0, 200),
        minutes: Math.round(clampN(a?.minutes, 5, 480, 30)),
        capability: (CAPABILITIES as readonly string[]).includes(a?.capability)
          ? a.capability
          : "user_performs",
        done: !!a?.done,
      })),
      status: m?.status,
    }));
  const st = raw?.success ?? {};
  return {
    goal_title: String(raw?.goal_title ?? "").slice(0, 120),
    outcome: String(raw?.outcome ?? "").slice(0, 400),
    domain: String(raw?.domain ?? "other"),
    success: {
      type: (SUCCESS_TYPES as readonly string[]).includes(st.type) ? st.type : "milestones",
      definition: String(st.definition ?? "").slice(0, 400),
      target: st.target == null || !Number.isFinite(Number(st.target)) ? null : Number(st.target),
      unit: st.unit ? String(st.unit).slice(0, 20) : null,
    },
    jurisdiction: raw?.jurisdiction ? String(raw.jurisdiction).slice(0, 60) : null,
    options: (Array.isArray(raw?.options) ? raw.options : [])
      .slice(0, 5)
      .map((o: any, i: number) => ({
        key: String(o?.key || `o${i + 1}`).slice(0, 40),
        title: String(o?.title ?? "").slice(0, 120),
        summary: String(o?.summary ?? "").slice(0, 400),
        months: clampN(o?.months, 0, 240, 0),
        cost: clampN(o?.cost, 0, 10_000_000, 0),
        risk: String(o?.risk ?? "").slice(0, 200),
      })),
    chosen_option: raw?.chosen_option ? String(raw.chosen_option) : null,
    choice_reason: raw?.choice_reason ? String(raw.choice_reason).slice(0, 400) : null,
    prerequisites: (Array.isArray(raw?.prerequisites) ? raw.prerequisites : [])
      .slice(0, 15)
      .map((p: any) => ({
        title: String(p?.title ?? "").slice(0, 160),
        kind: (PREREQ_KINDS as readonly string[]).includes(p?.kind) ? p.kind : "other",
        met: p?.met === true ? true : p?.met === false ? false : null,
      })),
    resources: (Array.isArray(raw?.resources) ? raw.resources : []).slice(0, 15).map((r: any) => ({
      title: String(r?.title ?? "").slice(0, 160),
      kind: (RESOURCE_KINDS as readonly string[]).includes(r?.kind) ? r.kind : "other",
      amount: r?.amount == null || !Number.isFinite(Number(r.amount)) ? null : Number(r.amount),
    })),
    milestones: ms,
    assumptions: (Array.isArray(raw?.assumptions) ? raw.assumptions : []).map(String).slice(0, 10),
    risks: (Array.isArray(raw?.risks) ? raw.risks : []).map(String).slice(0, 10),
    sources: Array.isArray(raw?.sources) ? raw.sources.slice(0, 12) : [],
    research_confidence: ["high", "mixed", "low", "none"].includes(raw?.research_confidence)
      ? raw.research_confidence
      : "none",
  };
}

/** Structural problems that block acceptance. */
export function validatePathway(d: PathwayDraft): string[] {
  const e: string[] = [];
  if (!d.goal_title.trim()) e.push("The goal has no title.");
  if (!d.success.definition.trim()) e.push("There is no clear definition of done.");
  if (d.success.type === "measurable" && d.success.target == null)
    e.push("A measurable goal needs a target number.");
  if (!d.milestones.length) e.push("There are no milestones.");
  const keys = new Set(d.milestones.map((m) => m.key));
  if (keys.size !== d.milestones.length) e.push("Two milestones share the same key.");
  for (const m of d.milestones) {
    if (!m.title.trim()) e.push("A milestone has no title.");
    for (const dep of m.depends_on)
      if (!keys.has(dep)) e.push(`"${m.title}" depends on an unknown step.`);
    if (!m.actions.length) e.push(`"${m.title}" has no concrete actions.`);
    for (const a of m.actions)
      if (!a.title.trim() || VAGUE_ACTION.test(a.title))
        e.push(`"${a.title || "(blank)"}" is too vague to act on.`);
    if (m.source_refs.some((r) => r < 0 || r >= d.sources.length))
      e.push(`"${m.title}" cites a source that wasn't found.`);
  }
  const g = d.milestones.map((m) => ({
    id: m.key,
    title: m.title,
    status: "active",
    dependencies: m.depends_on,
  }));
  for (const m of d.milestones)
    for (const dep of m.depends_on) {
      const others = g.map((x) =>
        x.id === m.key ? { ...x, dependencies: x.dependencies.filter((y) => y !== dep) } : x,
      );
      if (createsCycle(others, m.key, dep)) {
        e.push("The steps depend on each other in a loop.");
        break;
      }
    }
  return [...new Set(e)];
}

/** Dependency-respecting order (stage, then topological). */
export function orderMilestones<M extends Pick<Milestone, "key" | "stage" | "depends_on">>(
  ms: M[],
): M[] {
  const by = new Map(ms.map((m) => [m.key, m]));
  const out: M[] = [];
  const seen = new Set<string>();
  const visit = (m: M, path: Set<string>) => {
    if (seen.has(m.key) || path.has(m.key)) return;
    path.add(m.key);
    for (const d of [...m.depends_on].sort()) {
      const x = by.get(d);
      if (x) visit(x, path);
    }
    seen.add(m.key);
    out.push(m);
  };
  for (const m of [...ms].sort((a, b) => a.stage - b.stage || a.key.localeCompare(b.key)))
    visit(m, new Set());
  return out;
}

// ---------- Feasibility (time + money) ----------

const WEEK_MS = 7 * 864e5;
const addWeeks = (iso: string, w: number) =>
  new Date(new Date(iso + "T00:00:00Z").getTime() + Math.ceil(w) * WEEK_MS)
    .toISOString()
    .slice(0, 10);
const weeksBetween = (a: string, b: string) =>
  (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / WEEK_MS;
const CURRENCY = /^(gbp|usd|£|\$|pounds?|dollars?)$/i;

export type PathwayAssessment = {
  level: "feasible" | "tight" | "infeasible";
  needed_weeks: number;
  available_weeks: number | null;
  earliest_date: string;
  weekly_minutes_needed: number;
  weekly_minutes_available: number;
  money: { required: number; available: number; shortfall: number; months_to_fund: number | null };
  reasons: string[];
  alternatives: string[];
  engine: string;
};

/**
 * Earliest realistic finish from two floors: effort serialised through the member's real spare weekly time,
 * and the calendar critical path of minimum durations (courses, waiting periods), plus funding time for any shortfall.
 */
export function assessPathway(
  d: PathwayDraft,
  ctx: {
    today: string;
    deadline?: string | null | undefined;
    weeklyMinutesAvailable: number;
    budget?: number | null | undefined;
    monthlySaving?: number | null | undefined;
    current?: number | null | undefined;
  },
): PathwayAssessment {
  const reasons: string[] = [];
  const alternatives: string[] = [];
  const open = d.milestones.filter((m) => m.status !== "done");
  const cap = Math.max(0, Math.floor(ctx.weeklyMinutesAvailable));
  const effortMin = open.reduce((s, m) => s + m.effort_hours * 60, 0);
  const effortWeeks = effortMin === 0 ? 0 : cap === 0 ? Infinity : effortMin / cap;

  const finish = new Map<string, number>();
  for (const m of orderMilestones(open)) {
    const start = Math.max(0, ...m.depends_on.map((k) => finish.get(k) ?? 0));
    finish.set(m.key, start + m.min_weeks);
  }
  const pathWeeks = Math.max(0, ...finish.values());

  // Money: explicit costs vs budget, and measurable currency targets (savings goals) vs monthly saving.
  const required = open.reduce((s, m) => s + m.cost, 0);
  const available = Math.max(0, ctx.budget ?? 0);
  const saving = Math.max(0, ctx.monthlySaving ?? 0);
  let shortfall = Math.max(0, required - available);
  if (
    d.success.type === "measurable" &&
    d.success.unit &&
    CURRENCY.test(d.success.unit) &&
    d.success.target != null
  )
    shortfall = Math.max(shortfall, d.success.target - Math.max(ctx.current ?? 0, available));
  const monthsToFund = shortfall === 0 ? 0 : saving > 0 ? Math.ceil(shortfall / saving) : null;
  const fundWeeks = monthsToFund == null ? Infinity : monthsToFund * 4.345;

  const needed = Math.max(effortWeeks, pathWeeks, fundWeeks);
  const availableWeeks = ctx.deadline ? Math.max(0, weeksBetween(ctx.today, ctx.deadline)) : null;
  const earliest = Number.isFinite(needed) ? addWeeks(ctx.today, needed) : "";
  let level: PathwayAssessment["level"] = "feasible";

  if (effortMin > 0 && cap === 0) {
    level = "infeasible";
    reasons.push(
      "There is no free time left in your week once work, sleep, commitments and other goals are counted.",
    );
    alternatives.push("Pause or shrink another goal, or free up a regular slot, then re-check.");
  }
  if (shortfall > 0 && monthsToFund == null) {
    level = "infeasible";
    reasons.push(
      `It needs about ${fmt(shortfall)} more than you have available, and no monthly saving amount is set.`,
    );
    alternatives.push(
      "Tell Plexecute how much you can set aside each month so a funding stage can be planned.",
    );
  } else if (shortfall > 0) {
    reasons.push(
      `Funding gap of ${fmt(shortfall)}: about ${monthsToFund} month${monthsToFund === 1 ? "" : "s"} of saving at ${fmt(saving)}/month.`,
    );
  }
  if (availableWeeks != null && Number.isFinite(needed) && needed > availableWeeks) {
    level = "infeasible";
    const drivers: string[] = [];
    if (pathWeeks > availableWeeks)
      drivers.push(
        `the required steps take at least ${Math.ceil(pathWeeks)} weeks however hard you work`,
      );
    if (effortWeeks > availableWeeks)
      drivers.push(
        `about ${Math.round(effortMin / 60)} hours of work only fit into your free time over ${Math.ceil(effortWeeks)} weeks`,
      );
    if (fundWeeks > availableWeeks)
      drivers.push(`saving the money takes about ${monthsToFund} months`);
    reasons.push(`Not possible by ${ctx.deadline}: ${drivers.join("; ")}.`);
    alternatives.push(`Earliest realistic finish: ${earliest}.`);
    if (effortWeeks > availableWeeks && pathWeeks <= availableWeeks && availableWeeks > 0)
      alternatives.push(
        `Or find about ${Math.ceil(effortMin / availableWeeks)} minutes a week instead of ${cap}.`,
      );
    if (
      d.success.type === "measurable" &&
      d.success.unit &&
      CURRENCY.test(d.success.unit) &&
      saving > 0 &&
      d.success.target != null
    )
      alternatives.push(
        `Or lower the target to about ${fmt(Math.floor(available + saving * (availableWeeks / 4.345)))} by that date, or raise monthly saving to ${fmt(Math.ceil(shortfall / Math.max(1, availableWeeks / 4.345)))}.`,
      );
  } else if (availableWeeks != null && Number.isFinite(needed) && needed > availableWeeks * 0.85) {
    if (level === "feasible") level = "tight";
    reasons.push("It fits, but with little slack if something slips.");
  }
  const weeklyNeeded =
    availableWeeks && availableWeeks > 0
      ? Math.ceil(effortMin / availableWeeks)
      : Math.min(cap, Math.ceil(effortMin / Math.max(1, needed || 1)));
  return {
    level,
    needed_weeks: Number.isFinite(needed) ? Math.ceil(needed) : -1,
    available_weeks: availableWeeks == null ? null : Math.floor(availableWeeks),
    earliest_date: earliest,
    weekly_minutes_needed: Number.isFinite(weeklyNeeded) ? weeklyNeeded : 0,
    weekly_minutes_available: cap,
    money: { required, available, shortfall, months_to_fund: monthsToFund },
    reasons,
    alternatives,
    engine: PATHWAY_ENGINE_VERSION,
  };
}
const fmt = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
export function fmtMoney(n: number, currency: "GBP" | "USD" = "GBP") {
  return `${currency === "USD" ? "$" : "£"}${Math.round(n).toLocaleString(currency === "USD" ? "en-US" : "en-GB")}`;
}

// ---------- Rolling horizon, evidence, blocked paths ----------

/** Only milestones whose dependencies are all done are "active"; later stages stay preserved but unscheduled. */
export function rollingHorizon<
  M extends Pick<Milestone, "key" | "depends_on" | "status" | "stage">,
>(ms: M[]) {
  const done = new Set(ms.filter((m) => m.status === "done").map((m) => m.key));
  const blocked = new Set(
    ms.filter((m) => m.status === "blocked" || m.status === "failed").map((m) => m.key),
  );
  const active: M[] = [],
    waiting: M[] = [],
    held: M[] = [];
  for (const m of orderMilestones(ms)) {
    if (m.status === "done") continue;
    if (m.status === "blocked") {
      held.push(m);
      continue;
    }
    if (m.depends_on.some((k) => blocked.has(k) || held.some((h) => h.key === k))) held.push(m);
    else if (m.depends_on.every((k) => done.has(k))) active.push(m);
    else waiting.push(m);
  }
  return { active, waiting, held };
}

/** Weekly minutes for the planner come only from currently active milestones (near-term work). */
export function horizonWeeklyMinutes(
  ms: Pick<Milestone, "key" | "depends_on" | "status" | "stage" | "effort_hours" | "min_weeks">[],
  capacity: number,
): number {
  const { active } = rollingHorizon(ms);
  if (!active.length) return 0;
  const perWeek = active.reduce(
    (s, m) =>
      s +
      (m.effort_hours * 60) /
        Math.max(1, m.min_weeks || Math.ceil((m.effort_hours * 60) / Math.max(60, capacity))),
    0,
  );
  return Math.max(30, Math.min(Math.max(30, capacity), Math.round(perWeek / 15) * 15));
}

/** Major milestones need evidence matching their type; time passing never completes anything. */
export function canComplete(
  m: Pick<Milestone, "major" | "evidence">,
  evidenceNote: string | null | undefined,
  progress?: { current: number | null; target: number | null },
): { ok: boolean; reason?: string } {
  if (m.evidence === "amount_reached") {
    if (progress?.target != null && (progress.current ?? -Infinity) < progress.target)
      return { ok: false, reason: "The recorded amount hasn't reached the target yet." };
    return { ok: true };
  }
  if (m.major && m.evidence !== "user_confirms" && !(evidenceNote ?? "").trim())
    return {
      ok: false,
      reason: `Add the evidence first: ${EVIDENCE_LABEL[m.evidence].toLowerCase()}.`,
    };
  return { ok: true };
}

/** Blocking or failing a step keeps completed work, holds only its dependants and lists them. */
export function blockImpact<M extends Pick<Milestone, "key" | "depends_on" | "status" | "title">>(
  ms: M[],
  key: string,
) {
  const hit = new Set<string>([key]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of ms)
      if (!hit.has(m.key) && m.status !== "done" && m.depends_on.some((d) => hit.has(d))) {
        hit.add(m.key);
        grew = true;
      }
  }
  hit.delete(key);
  return {
    held: ms.filter((m) => hit.has(m.key)).map((m) => m.title),
    preserved: ms.filter((m) => m.status === "done").map((m) => m.title),
  };
}

/** A failed attempt (e.g. exam) re-opens the step with a retry action; downstream steps simply wait. */
export function retryActions(m: Pick<Milestone, "actions" | "title">): Action[] {
  return [
    ...m.actions.map((a) => ({ ...a, done: false })),
    {
      title: `Review what went wrong and rebook: ${m.title}`.slice(0, 200),
      minutes: 45,
      capability: "plexecute_assists",
    },
  ];
}

// ---------- Multiple goals ----------

const RANK: Record<PriorityClass, number> = {
  must: 5,
  deadline_critical: 4,
  important: 3,
  long_term: 2,
  optional: 1,
};
export function priorityNumber(c: string | null | undefined): number {
  return RANK[(c as PriorityClass) ?? "important"] ?? 3;
}
/** When combined weekly needs exceed free time, explain the trade-off; lowest-priority goals give way first, never sleep or protected time. */
export function goalTradeoff(
  goals: { title: string; weekly_minutes: number; priority_class?: string | null }[],
  capacity: number,
) {
  const total = goals.reduce((s, g) => s + g.weekly_minutes, 0);
  if (total <= capacity)
    return { conflict: false as const, total, capacity, giveWay: [] as string[], message: "" };
  const sorted = [...goals].sort(
    (a, b) => priorityNumber(a.priority_class) - priorityNumber(b.priority_class),
  );
  let over = total - capacity;
  const giveWay: string[] = [];
  for (const g of sorted) {
    if (over <= 0) break;
    giveWay.push(g.title);
    over -= g.weekly_minutes;
  }
  return {
    conflict: true as const,
    total,
    capacity,
    giveWay,
    message: `Your goals need about ${Math.round(total / 60)} h a week but you have about ${Math.round(capacity / 60)} h free. Sleep and protected time stay untouched, so ${giveWay.join(", ")} would need to slow down or wait. Choose what matters most.`,
  };
}
