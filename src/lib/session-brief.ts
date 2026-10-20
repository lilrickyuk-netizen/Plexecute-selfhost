// Execution-Ready Sessions: a deterministic view that turns one plan_blocks occurrence into
// WHAT / WHY / START / RESOURCES / DONE WHEN / NEXT, built only from existing records.
// No AI, no new storage: every field is derived from the goal, milestone, learning syllabus,
// training programme, meal prep plan, booking and journey already linked to the session.
// Unknown resources are reported as missing, never invented.
import { EVIDENCE_LABEL } from "./pathway";
import { OPEN_STATES } from "./execution";
import { localDayKey, localHm } from "./tz";
import { STARTER_TOPICS } from "./starter-pathways";

export type BriefResource = { title: string; url: string; source: string };
export type BriefCta =
  | { type: "href"; label: string; url: string }
  | { type: "route"; label: string; to: string; search?: Record<string, string> }
  | { type: "start"; label: string }
  | { type: "complete"; label: string }
  | { type: "coach"; label: string };

export type SessionBrief = {
  blockId: string;
  title: string;
  kind: string;
  status: string;
  startsAt: string;
  /** "YYYY-MM-DD HH:MM" in the member's timezone. */
  startsLocal: string;
  durationMin: number;
  objective: string;
  why: string[]; // session → milestone → goal → life direction
  firstStep: string;
  steps: string[];
  details: { label: string; items: string[] }[];
  resources: BriefResource[];
  missing: string[];
  completion: string;
  next: string | null;
  primary: BriefCta;
  secondary: BriefCta[];
  ready: boolean;
};

export type BriefInput = {
  block: {
    id: string;
    title: string;
    occurrence_kind: string;
    domain: string;
    status: string;
    starts_at: string;
    duration_min: number;
    goal_id: string | null;
    commitment_id: string | null;
  };
  goal?: {
    id: string;
    title: string;
    why: string | null;
    success_definition: string | null;
    domain: string;
  } | null;
  milestones?: {
    id: string;
    key: string | null;
    title: string;
    status: string;
    stage: number;
    position: number;
    depends_on: string[];
    actions: unknown;
    sources: unknown;
    evidence_type: string | null;
    blocked_reason: string | null;
  }[];
  topics?: {
    id: string;
    title: string;
    position: number;
    done_at: string | null;
    parent_id: string | null;
  }[];
  learningResources?: {
    title: string;
    url: string | null;
    kind: string;
    content?: string | null;
    done_units: number;
    total_units: number | null;
  }[];
  workout?: {
    name: string;
    day: number;
    exercises: { name: string; sets: number; reps: string }[];
  } | null;
  prep?: {
    label: string;
    cook: { name: string; grams: number }[];
    creates: string[];
    have: string[];
    shopping: string[];
    minutes: number;
  } | null;
  booking?: {
    id: string;
    service: string;
    status: string;
    provider_name: string | null;
    kind: string;
    checkout_url: string | null;
    checkout_expires_at: string | null;
  } | null;
  journey?: {
    id: string;
    dest_label: string | null;
    leave_at: string;
    duration_min: number;
    buffer_min: number;
    mode: string;
    status: string;
  } | null;
  vision?: string[] | null;
  tier?: string;
  /** Member's IANA timezone; times are shown in it, never in UTC. */
  tz?: string | null;
};

// Foods that are portioned, not cooked, during batch prep.
const NO_COOK =
  /yog(h)?urt|milk|oats|granola|fruit|berr|banana|apple|nuts?\b|seeds|cheese|honey|hummus|bread|wrap|lettuce|salad|spinach|avocado|tomato/i;
const DONE = new Set(["done", "completed", "achieved"]);
const OPEN_BLOCK = new Set<string>([...OPEN_STATES, "started"]);
const isUrl = (u: unknown): u is string =>
  typeof u === "string" && /^https:\/\/[^\s]+\.[^\s]+/.test(u);

type Action = { title: string; minutes?: number; done?: boolean };
const actionsOf = (a: unknown): Action[] =>
  Array.isArray(a)
    ? a.filter((x): x is Action => !!x && typeof (x as Action).title === "string")
    : [];
const sourcesOf = (s: unknown): BriefResource[] =>
  Array.isArray(s)
    ? s
        .filter((x) => x && isUrl((x as { url?: unknown }).url))
        .map((x) => ({
          title: String((x as { title?: string }).title || (x as { url: string }).url),
          url: (x as { url: string }).url,
          source: String((x as { publisher?: string }).publisher || "Researched source"),
        }))
    : [];

/** The milestone a session is working on: first open milestone whose prerequisites are done. */
export function currentMilestone(ms: NonNullable<BriefInput["milestones"]>) {
  const sorted = [...ms].sort((a, b) => a.stage - b.stage || a.position - b.position);
  const doneKeys = new Set(
    sorted
      .filter((m) => DONE.has(m.status))
      .map((m) => m.key)
      .filter(Boolean),
  );
  const open = sorted.filter((m) => !DONE.has(m.status) && m.status !== "blocked");
  const ready = open.find((m) => (m.depends_on ?? []).every((k) => doneKeys.has(k)));
  const after = ready ? (open.filter((m) => m.id !== ready.id)[0] ?? null) : null;
  const waiting = !ready && open[0] ? open[0] : null;
  return { current: ready ?? null, next: after, waiting, doneCount: doneKeys.size };
}

/** Next learning topic: first unfinished leaf in syllabus order; completed ones are never repeated. */
export function nextTopics(topics: NonNullable<BriefInput["topics"]>) {
  const sorted = [...topics].sort((a, b) => a.position - b.position);
  const open = sorted.filter((t) => !t.done_at);
  return {
    current: open[0] ?? null,
    next: open[1] ?? null,
    done: sorted.length - open.length,
    total: sorted.length,
  };
}

function levelLine(done: number) {
  if (done === 0) return "Starts at the beginning: you have not completed any topics yet.";
  return `Builds on ${done} topic${done === 1 ? "" : "s"} you have already completed, so the basics are not repeated.`;
}

export function buildSessionBrief(i: BriefInput): SessionBrief {
  const b = i.block;
  const kind = b.occurrence_kind;
  const why: string[] = [];
  const details: SessionBrief["details"] = [];
  const missing: string[] = [];
  let resources: BriefResource[] = [];
  let objective = b.title;
  let steps: string[] = [];
  let completion = "You mark the session complete when it is done.";
  let next: string | null = null;
  let primary: BriefCta = { type: "start", label: "Start session" };
  const secondary: BriefCta[] = [{ type: "coach", label: "Ask Coach" }];

  const ms = i.milestones?.length ? currentMilestone(i.milestones) : null;
  if (ms?.current) why.push(`Moves "${ms.current.title}" forward.`);
  if (i.goal)
    why.push(`Part of your goal "${i.goal.title}"${i.goal.why ? ` — ${i.goal.why}` : ""}.`);
  if (i.vision?.length && i.goal) why.push(`Supports your 5-year direction: ${i.vision[0]}.`);

  const learning = kind === "learning" || kind === "study" || b.domain === "learning";
  if (learning && i.topics?.length) {
    const t = nextTopics(i.topics);
    if (t.current) {
      objective = `Today: ${t.current.title}.`;
      const starter = STARTER_TOPICS.get(t.current.title);
      steps = starter
        ? [...starter.steps, "Mark complete when finished"]
        : [
            `Work through "${t.current.title}" in the resource below`,
            "Try one practice exercise on it",
            "Note anything that did not make sense for Coach",
          ];
      completion = `"${t.current.title}" finished and one practice exercise attempted.`;
      next = t.next
        ? `Next session: ${t.next.title}.`
        : "That completes your syllabus — next is a review.";
      details.push({
        label: "Your level",
        items: [levelLine(t.done), `${t.done} of ${t.total} topics done.`],
      });
    } else {
      objective = "Review what you have learned so far.";
      completion = "Review finished.";
    }
  }
  if (learning) {
    const lr = (i.learningResources ?? []).filter((r) => isUrl(r.url));
    const ordered = [...lr]
      .sort((a, b) => Number(!!b.done_units && !doneRes(b)) - Number(!!a.done_units && !doneRes(a)))
      .filter((r) => !doneRes(r));
    // The resource saved for today's topic comes first; otherwise unfinished resources in order.
    const topic = i.topics?.length ? nextTopics(i.topics).current?.title : undefined;
    const forTopic = topic ? lr.filter((r) => r.content === `topic:${topic}`) : [];
    const untagged = ordered.filter((r) => !r.content?.startsWith("topic:"));
    resources = (forTopic.length ? forTopic : untagged.length ? untagged : ordered)
      .slice(0, 3)
      .map((r) => ({ title: r.title, url: r.url!, source: r.kind }));
  }

  if (
    (!learning || !i.topics?.length) &&
    ms?.current &&
    kind !== "workout" &&
    kind !== "meal_prep"
  ) {
    const acts = actionsOf(ms.current.actions).filter((a) => !a.done);
    objective = acts[0] ? `${acts[0].title}.` : `Progress "${ms.current.title}".`;
    steps = acts.slice(0, 5).map((a) => a.title);
    completion = ms.current.evidence_type
      ? `${ms.current.title}: ${evidenceText(ms.current.evidence_type)}.`
      : `Next step of "${ms.current.title}" done and saved.`;
    next = ms.next ? `After this milestone: ${ms.next.title}.` : null;
    primary = { type: "start", label: "Start task" };
  }
  if (ms?.waiting && !ms.current)
    missing.push(
      `"${ms.waiting.title}" is waiting on an earlier step${ms.waiting.blocked_reason ? `: ${ms.waiting.blocked_reason}` : ""}.`,
    );
  if (ms?.current)
    for (const r of sourcesOf(ms.current.sources))
      if (!resources.some((x) => x.url === r.url)) resources.push(r);

  if (kind === "workout") {
    if (i.workout?.exercises.length) {
      objective = `${i.workout.name}: ${i.workout.exercises.length} exercises.`;
      details.push({
        label: "Today's workout",
        items: i.workout.exercises.map((e) => `${e.name} — ${e.sets}×${e.reps}`),
      });
      steps = [
        "Warm up for 5 minutes",
        `Start with ${i.workout.exercises[0]!.name}`,
        "Log each set as you go",
      ];
      completion = "Workout logged in Training.";
      next = "Your logged sets and recovery check-in set the next session's loads.";
    } else {
      missing.push("No training programme yet — build one so this session shows real exercises.");
    }
    primary = {
      type: "route",
      label: "Start workout",
      to: "/app/training",
      search: { section: "strength" },
    };
    secondary.unshift({
      type: "route",
      label: "Exercise guidance",
      to: "/app/training",
      search: { section: "strength" },
    });
  }
  if ((kind === "cardio" || kind === "mobility") && !ms) {
    primary = {
      type: "route",
      label: kind === "cardio" ? "Start cardio" : "Start mobility",
      to: kind === "cardio" ? "/app/training" : "/app/wellness",
      ...(kind === "cardio" ? { search: { section: "cardio" } } : {}),
    };
    completion = "Session logged.";
  }
  if (kind === "meditation" && !ms) {
    primary = { type: "route", label: "Start practice", to: "/app/wellness" };
    completion = "Practice completed.";
  }

  if (kind === "meal_prep") {
    if (i.prep) {
      objective = `Prepare ${i.prep.creates.join(", ")}.`;
      details.push({ label: "Cook", items: i.prep.cook.map((c) => `${c.name} — ${c.grams} g`) });
      if (i.prep.have.length) details.push({ label: "You already have", items: i.prep.have });
      if (i.prep.shopping.length) details.push({ label: "Still needed", items: i.prep.shopping });
      steps = [
        "Get everything out before you start",
        ...i.prep.cook
          .slice(0, 4)
          .map(
            (c) => `${NO_COOK.test(c.name) ? "Portion out" : "Cook"} the ${c.name.toLowerCase()}`,
          ),
        "Portion into containers and label the day",
      ];
      completion = "Planned portions prepared (eating them is logged separately).";
    } else {
      missing.push(
        "No meal prep plan for this week yet — make one so this session lists what to cook.",
      );
    }
    primary = { type: "route", label: "Start prep", to: "/app/meal-prep" };
  }

  if (i.booking) {
    const confirmed = i.booking.status === "confirmed";
    details.push({
      label: "Booking",
      items: [
        `${i.booking.service}${i.booking.provider_name ? ` with ${i.booking.provider_name}` : ""}`,
        `Status: ${i.booking.status.replace(/_/g, " ")}`,
      ],
    });
    if (!confirmed && i.booking.checkout_url && isUrl(i.booking.checkout_url))
      primary = {
        type: "href",
        label: "Finish on the business's checkout",
        url: i.booking.checkout_url,
      };
    else if (!confirmed) primary = { type: "route", label: "Book now", to: "/app/appointments" };
    completion = confirmed ? "Attend the appointment." : "Booking confirmed.";
    if (!confirmed) objective = `Get "${i.booking.service}" booked.`;
  }

  if (i.journey && i.journey.status !== "cancelled") {
    const leave = new Date(i.journey.leave_at);
    details.push({
      label: "Journey",
      items: [
        `${i.journey.dest_label ?? "Destination"}`,
        `Leave at ${localHm(leave, i.tz)}`,
        `Travel ${i.journey.duration_min} min by ${i.journey.mode}`,
        `${i.journey.buffer_min} min arrival buffer`,
      ],
    });
    secondary.unshift({ type: "route", label: "Open journey", to: "/app/journeys" });
    if (primary.type === "start")
      primary = { type: "route", label: "Open journey", to: "/app/journeys" };
  }

  if (learning) {
    if (resources[0]) primary = { type: "href", label: "Start lesson", url: resources[0].url };
    else if (ms?.current && !i.topics?.length && steps.length) {
      // The pathway's first step can begin without a link; the resource is flagged, never invented.
      details.push({
        label: "Resource",
        items: [
          "No checked resource is attached yet — today's step doesn't need one. Coach can look for an official source.",
        ],
      });
    } else {
      missing.push("Resource still needs confirming.");
      primary = { type: "coach", label: "Ask Coach to find a resource" };
    }
  }

  // A goal with no pathway or syllabus yet: say so plainly and make building it the one action.
  const unstructured =
    !!i.goal &&
    !i.milestones?.length &&
    !i.topics?.length &&
    !["workout", "cardio", "mobility", "meal_prep", "meditation"].includes(kind) &&
    !i.booking;
  if (unstructured) {
    missing.unshift(
      learning
        ? "This goal has no learning syllabus yet, so today's exact topic isn't set. Coach can build it from your level."
        : "This goal has no step-by-step pathway yet, so today's exact task isn't set. Coach can build it now.",
    );
    objective = learning
      ? `Set your starting point for "${i.goal!.title}".`
      : `Choose the first concrete step for "${i.goal!.title}".`;
    steps = [
      "Tell Coach what you already know or have done",
      "Approve the pathway it proposes",
      "This session then shows the exact step",
    ];
    completion = "Pathway approved and today's first step chosen.";
    primary = { type: "coach", label: learning ? "Build my learning path" : "Build my pathway" };
    if (learning) secondary.unshift({ type: "route", label: "Open Learning", to: "/app/learning" });
    const ix = missing.indexOf("Resource still needs confirming.");
    if (ix >= 0) missing.splice(ix, 1);
  }

  if (b.status === "started" || b.status === "in_progress")
    primary = primary.type === "start" ? { type: "complete", label: "Complete session" } : primary;
  if (!OPEN_BLOCK.has(b.status))
    primary = {
      type: "coach",
      label: DONE.has(b.status) ? "Review with Coach" : "Ask Coach what's next",
    };

  const firstStep =
    steps[0] ??
    (primary.type === "href" || primary.type === "route"
      ? `${primary.label}.`
      : "Open the session and begin.");
  const ready = missing.length === 0 && objective !== b.title;
  return {
    blockId: b.id,
    title: b.title,
    kind,
    status: b.status,
    startsAt: b.starts_at,
    startsLocal: `${localDayKey(b.starts_at, i.tz)} ${localHm(b.starts_at, i.tz)}`,
    durationMin: b.duration_min,
    objective,
    why,
    firstStep,
    steps,
    details,
    resources,
    missing,
    completion,
    next,
    primary,
    secondary: secondary.slice(0, 3),
    ready,
  };
}

function doneRes(r: { done_units: number; total_units: number | null }) {
  return r.total_units != null && r.total_units > 0 && r.done_units >= r.total_units;
}
function evidenceText(t: string) {
  if (t in EVIDENCE_LABEL) return EVIDENCE_LABEL[t as keyof typeof EVIDENCE_LABEL];
  const m: Record<string, string> = {
    self_report: "you confirm it is done",
    document: "a saved document",
    certificate: "certificate received",
    metric: "the measured result recorded",
    external: "confirmation from the provider",
    artifact: "the draft saved",
  };
  return m[t] ?? t.replace(/_/g, " ");
}

/** Plain-text brief for Coach: answers "what do I do first", "why", and "when am I done" from the real records. */
export function briefForCoach(s: SessionBrief) {
  return {
    session: s.title,
    starts_at_member_local_time: s.startsLocal,
    status: s.status,
    objective: s.objective,
    first_step: s.firstStep,
    steps: s.steps,
    why_chain: s.why,
    details: s.details,
    resources: s.resources,
    still_missing: s.missing,
    done_when: s.completion,
    next: s.next,
    primary_action: s.primary.label,
    rule: "Answer only from these fields. Times are already in the member's own local time; never mention UTC. If a resource is missing say it still needs confirming; never invent links.",
  };
}
