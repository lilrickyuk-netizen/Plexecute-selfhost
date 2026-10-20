// Goal Mission persistence + orchestration over the existing engines (see mission.ts header).
// Writes use the service-role client after the caller is known; members can only read their own rows.
import * as M from "./mission";
import { classifyActions } from "./life-intelligence";
type Db = any;

export type MissionRow = {
  id: string;
  user_id: string;
  goal_id: string | null;
  title: string;
  state: M.MissionState;
  tier: M.MissionTier;
  experts: string[];
  contract: Partial<M.Contract>;
  checkpoint: Record<string, unknown>;
  council: Partial<M.CouncilRecord>;
  options: unknown[];
  blockers: M.Blocker[];
  history: { at: string; from: string; to: string; why: string }[];
  last_signal: M.MissionSignal | null;
  last_signal_at: string | null;
  updated_at: string;
};

export async function listMissions(db: Db, userId: string): Promise<MissionRow[]> {
  const { data } = await db
    .from("goal_missions")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(20);
  return (data ?? []) as MissionRow[];
}

export async function findMission(
  db: Db,
  userId: string,
  ref: { mission_id?: string | null; goal_id?: string | null; title?: string | null },
) {
  const all = await listMissions(db, userId);
  if (ref.mission_id) return all.find((m) => m.id === ref.mission_id) ?? null;
  if (ref.goal_id) return all.find((m) => m.goal_id === ref.goal_id) ?? null;
  if (ref.title) {
    const t = ref.title.toLowerCase();
    const words = (x: string) =>
      new Set(
        x
          .toLowerCase()
          .split(/[^a-z]+/)
          .filter(
            (w) =>
              w.length > 3 &&
              ![
                "want",
                "become",
                "build",
                "start",
                "would",
                "like",
                "qualified",
                "within",
                "while",
              ].includes(w),
          ),
      );
    const want = words(t);
    return (
      all.find((m) => m.title.toLowerCase().includes(t) || t.includes(m.title.toLowerCase())) ??
      // Same aim in different words (e.g. after clarification) continues the same mission, never a second one.
      all.find(
        (m) =>
          m.state !== "ACHIEVED" &&
          [...words(`${m.title} ${m.contract?.desired_outcome ?? ""}`)].filter((w) => want.has(w))
            .length >= Math.min(2, want.size),
      ) ??
      null
    );
  }
  return all.find((m) => m.state !== "ACHIEVED") ?? null;
}

export type AdvanceInput = {
  mission_id?: string | null;
  goal_id?: string | null;
  title?: string | null;
  member_text?: string | null;
  domains?: string[];
  to_state?: M.MissionState | null;
  why?: string | null;
  contract?: Partial<M.Contract>;
  blockers?: { area: string; detail: string }[];
  options?: M.RouteOption[];
  member_factors?: { budget?: number | null; horizonMonths?: number | null; has?: string[] };
  council?: {
    views: M.ExpertView[];
    selected_route: string;
    alternatives?: string[];
    assumptions?: string[];
  };
  checkpoint?: Record<string, unknown>;
  new_goal?: boolean;
  /** Plexecute knowledge passages that informed this step (global library ids, never member data). */
  knowledge?: { id: string; title: string; domain: string }[];
};

/** Creates or advances the mission. Rejects illegal jumps and fake completion. Returns the saved state plus what is needed next. */
export async function advanceMission(admin: Db, userId: string, a: AdvanceInput, now = new Date()) {
  let m = await findMission(admin, userId, a);
  if (!m && a.contract?.desired_outcome)
    m = await findMission(admin, userId, { title: a.contract.desired_outcome });
  // The mission being discussed right now (open, unlinked, touched in the last 2 hours) continues; a reworded title never starts a second one.
  if (!m && !a.goal_id && !a.new_goal) {
    const recent = (await listMissions(admin, userId)).find(
      (x) => x.state !== "ACHIEVED" && Date.now() - Date.parse(x.updated_at) < 2 * 3600e3,
    );
    if (recent) m = recent;
  }
  const text = [a.title, a.member_text, a.contract?.desired_outcome].filter(Boolean).join(" ");
  if (!m) {
    if (!a.title && !a.contract?.desired_outcome)
      return { error: "Say what the goal is (title) to start a mission." };
    const experts = M.routeExperts(text, a.domains ?? []);
    const { data, error } = await admin
      .from("goal_missions")
      .insert({
        user_id: userId,
        goal_id: a.goal_id ?? null,
        title: (a.title ?? a.contract!.desired_outcome!).slice(0, 200),
        experts,
        tier: M.tierFor(experts),
        contract: M.buildContract({
          desired_outcome: a.contract?.desired_outcome ?? a.title ?? "",
        }),
      })
      .select("*")
      .single();
    if (error || !data) return { error: "The mission could not be saved." };
    m = data as MissionRow;
  }
  const patch: Record<string, unknown> = { updated_at: now.toISOString() };
  if (a.goal_id && !m.goal_id) patch["goal_id"] = a.goal_id;
  // Only passages from this mission's own specialist areas join its decision record.
  if (a.knowledge?.length) {
    const { EXPERT_DOMAINS } = await import("./knowledge-routing");
    const own = new Set(
      [...(m.experts ?? []), ...M.routeExperts(m.title ?? "")].flatMap(
        (e) => (EXPERT_DOMAINS as Record<string, string[]>)[e] ?? [],
      ),
    );
    a.knowledge = a.knowledge.filter((k) => own.has(k.domain));
  }
  if (a.knowledge?.length) {
    // Decision provenance: which library passages shaped this mission, so "why this way?" is answered from records.
    const met = ((m as any).metrics ?? {}) as Record<string, any>;
    const prev = (met["knowledge_basis"] ?? []) as { id: string }[];
    const merged = [...prev];
    for (const k of a.knowledge)
      if (!merged.some((x) => x.id === k.id)) merged.push({ ...k, at: now.toISOString() } as never);
    patch["metrics"] = { ...met, knowledge_basis: merged.slice(-16) };
  }
  const contract = a.contract
    ? M.mergeContract(m.contract, a.contract)
    : M.mergeContract(m.contract, {});
  // Once the member has answered one round of questions, a concrete outcome in their words is the definition of done.
  const clarified = Boolean(m.checkpoint?.["clarify_asked"]);
  if (
    clarified &&
    !contract.definition_of_done &&
    (contract.target_horizon || contract.current_state) &&
    a.contract?.desired_outcome &&
    !/^\s*(get |be |become )?(fit|fitter|healthier|better|rich|successful)\s*$/i.test(
      a.contract.desired_outcome,
    )
  ) {
    contract.definition_of_done = a.contract.desired_outcome;
    contract.unknowns = contract.unknowns.filter((u) => u !== "what done looks like");
    contract.confidence = M.confidenceOf(contract);
  }
  patch["contract"] = contract;
  if (a.member_text || a.domains?.length) {
    const experts = [...new Set([...m.experts, ...M.routeExperts(text, a.domains ?? [])])];
    patch["experts"] = experts;
    patch["tier"] = M.tierFor(experts as M.Expert[]);
  }
  let blockers = m.blockers ?? [];
  if (a.blockers) blockers = a.blockers.map((b) => M.classifyBlocker(b.area, b.detail));
  patch["blockers"] = blockers;
  let comparison: ReturnType<typeof M.compareRoutes> | null = null;
  if (a.options?.length) {
    comparison = M.compareRoutes(a.options, a.member_factors ?? {});
    patch["options"] = a.options.map((o) => ({
      ...o,
      ...comparison!.ranked.find((r) => r.key === o.key),
    }));
  }
  if (a.council) {
    patch["council"] = M.synthesise(a.council.views, a.council.selected_route, {
      ...(a.council.alternatives ? { alternatives: a.council.alternatives } : {}),
      ...(a.council.assumptions ? { assumptions: a.council.assumptions } : {}),
      confidence: contract.confidence,
      now,
    });
  }
  const askNow = !clarified && !M.readyForPathway(contract);
  // "I have an hour now / tonight / today": start a first session that is useful whatever the details, instead of a question round.
  const startNow = askNow && classifyActions(String((a as any).member_text ?? "")).loop === "now";
  patch["checkpoint"] = {
    ...m.checkpoint,
    ...(a.checkpoint ?? {}),
    ...(askNow ? { clarify_asked: true } : {}),
    saved_at: now.toISOString(),
  };

  let state = m.state;
  let refused: string | null = null;
  if (a.to_state && a.to_state !== m.state) {
    const to = a.to_state;
    if (!M.canMove(m.state, to)) refused = `Can't move from ${m.state} to ${to}.`;
    else if (to === "PATHWAY_READY" && !M.readyForPathway(contract))
      refused = `Outcome is not concrete yet; still unknown: ${contract.unknowns.join(", ")}.`;
    else if (to === "PATHWAY_READY" && blockers.some((b) => b.kind === "HARD"))
      refused = "A hard blocker is open.";
    else if (to === "ACHIEVED") {
      const ok = m.goal_id
        ? (await admin.from("goals").select("status").eq("id", m.goal_id).maybeSingle()).data
            ?.status === "completed"
        : false;
      if (!ok) refused = "Achieved needs real evidence: the linked goal must be completed first.";
    }
    if (!refused) {
      state = to;
      patch["state"] = to;
      patch["history"] = [
        ...(m.history ?? []),
        { at: now.toISOString(), from: m.state, to, why: (a.why ?? "").slice(0, 300) },
      ].slice(-40);
    }
  } else if (m.state === "CAPTURED" && a.contract) {
    state = "UNDERSTANDING";
    patch["state"] = state;
  }
  await admin.from("goal_missions").update(patch).eq("id", m.id);
  if (a.options?.length || a.council)
    await (
      await import("./life-intelligence.server")
    ).recordIntel(admin, userId, "pathway_confidence", { level: contract.confidence });
  const needs: string[] = [];
  if (askNow) needs.push("clarify");
  else if (!M.readyForPathway(contract)) needs.push("proceed_with_assumptions");
  else if (
    ["CAPTURED", "UNDERSTANDING", "RESEARCHING", "MODELLING", "FEASIBILITY_CHECK"].includes(state)
  )
    needs.push("build_pathway");
  if (
    ((patch["experts"] as string[] | undefined) ?? m.experts).includes("research") &&
    !m.checkpoint?.["research_id"] &&
    !a.checkpoint?.["research_id"]
  )
    needs.push("research_topic");
  return {
    mission_id: m.id,
    state,
    stage: M.STAGE_LABEL[state],
    ...(refused ? { refused } : {}),
    tier: patch["tier"] ?? m.tier,
    experts_to_consider: patch["experts"] ?? m.experts,
    council_needed: (patch["tier"] ?? m.tier) === "complex",
    contract,
    instruction:
      (needs.includes("research_topic") && !askNow
        ? "FIRST, in this same turn, call research_topic (query about the entry routes/requirements, jurisdiction from the member's location), then get_research_findings, and pass the findings to draft_goal_pathway. "
        : "") +
      `Always pass mission_id ${m.id} to advance_mission from now on. ` +
      (startNow
        ? `The member wants to start NOW in the time they stated. Do NOT open with questions. Use what you know (get_life_twin / existing training, learning or career context), then in this turn put a first session on the plan from now with schedule_execution_queue (mission_id ${m.id}, a real foundation/diagnostic session that is useful whatever the details: exact content, steps, minutes, done when, what to record; for fitness build_workout and use its exercises), start the first task in full, and end with at most ONE of the clarifying_questions to tailor the next session.`
        : askNow
          ? "Ask only these questions, then stop."
          : "Clarification is done: do not ask another round. Record remaining gaps as assumptions/unknowns, then build it now: propose_new_goal (link goal_id here), draft_goal_pathway and accept_goal_pathway, put the first execution-ready session on the plan (request_replan), then advance_mission to PATHWAY_READY and SCHEDULED. Ask at most one question only if a HARD blocker makes planning impossible."),
    start_now: startNow,
    clarifying_questions: startNow
      ? M.clarifiersFor(text, {
          success: contract.definition_of_done,
          horizon: contract.target_horizon,
          current: contract.current_state,
        }).slice(0, 1)
      : askNow
        ? M.clarifiersFor(text, {
            success: contract.definition_of_done,
            horizon: contract.target_horizon,
            current: contract.current_state,
          })
        : [],
    blockers,
    ...(comparison ? { route_comparison: comparison } : {}),
    next_needed: needs,
  };
}

/** The full mission picture for Coach: state, contract, decision record, next action, blockers, real plan rationale. */
export async function missionView(
  db: Db,
  userId: string,
  ref: { mission_id?: string | null; goal_id?: string | null; title?: string | null },
  tz: string | null,
) {
  const m = await findMission(db, userId, ref);
  if (!m) {
    const all = await listMissions(db, userId);
    return {
      missions: all.map((x) => ({ id: x.id, title: x.title, stage: M.STAGE_LABEL[x.state] })),
      note: all.length
        ? "Pass mission_id for detail."
        : "No missions yet. Use advance_mission to start one for a meaningful goal.",
    };
  }
  const nowIso = new Date().toISOString();
  const [{ data: next }, { data: ms }, { data: pv }, { data: past }] = await Promise.all([
    // Open work only: the mission's goal sessions plus today's execution-queue tasks tagged with this mission (they may have no goal yet).
    db
      .from("plan_blocks")
      .select("id,title,starts_at,status,goal_id,evidence_detail")
      .eq("user_id", userId)
      .gte("starts_at", new Date(Date.now() - 6 * 3600000).toISOString())
      .not("status", "in", "(rescheduled,cancelled,done,completed,skipped,blocked,partial,missed)")
      .order("starts_at")
      .limit(40)
      .then((r: any) => ({
        data: (r.data ?? [])
          .filter(
            (b: any) =>
              (m.goal_id && b.goal_id === m.goal_id) || b.evidence_detail?.mission_id === m.id,
          )
          .slice(0, 5),
      })),
    m.goal_id
      ? db
          .from("goal_milestones")
          .select("title,status,stage,blocked_reason,depends_on")
          .eq("goal_id", m.goal_id)
          .limit(30)
      : Promise.resolve({ data: [] }),
    db
      .from("plan_versions")
      .select("rationale,diff_summary,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
    m.goal_id
      ? db
          .from("plan_blocks")
          .select("status,starts_at,duration_min,note")
          .eq("user_id", userId)
          .eq("goal_id", m.goal_id)
          .lt("starts_at", nowIso)
          .order("starts_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
  ]);
  const outs: M.Outcome[] = (past ?? []).map((b: any) => ({
    status: b.status,
    reason: b.note ?? null,
    planned_minutes: b.duration_min ?? null,
  }));
  const rat = pv?.[0]?.rationale;
  const rationale = Array.isArray(rat)
    ? rat.filter((r: any) => !m.goal_id || r.goal_id === m.goal_id).slice(0, 8)
    : (rat ?? null);
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", {
      timeZone: tz ?? "Europe/London",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return {
    mission_id: m.id,
    title: m.title,
    stage: M.STAGE_LABEL[m.state],
    state: m.state,
    contract: m.contract,
    next_sessions: (next ?? []).map((b: any) => ({
      id: b.id,
      title: b.title,
      when: fmt(b.starts_at),
      status: b.status,
    })),
    results_so_far: (m as any).metrics ?? {},
    milestones: ms ?? [],
    blockers: m.blockers,
    open_blockers: [
      ...(m.blockers ?? []),
      ...(ms ?? [])
        .filter((x: any) => x.status === "blocked")
        .map((x: any) => M.classifyBlocker("milestone", x.blocked_reason ?? `${x.title} blocked`)),
    ],
    decision_record:
      m.council && Object.keys(m.council).length ? m.council : "no council decision saved",
    route_options: m.options,
    recent_changes: (m.history ?? []).slice(-5),
    plan_rationale: rationale ?? "no planner rationale saved yet",
    knowledge_basis: ((m as any).metrics?.knowledge_basis ?? []).length
      ? (m as any).metrics.knowledge_basis
      : "no Plexecute knowledge recorded for this mission yet",
    // Decision basis by source, so explanations never mix planner rules, member facts and sourced knowledge.
    decision_basis: {
      MEMBER_FACT: m.contract ?? {},
      PLEXECUTE_KNOWLEDGE: ((m as any).metrics?.knowledge_basis ?? []).map((k: any) => k.id ?? k),
      CURRENT_EXTERNAL_RESEARCH: (m.checkpoint as any)?.research_id ?? null,
      DETERMINISTIC_PLANNING_RULE: [
        ...((m as any).metrics?.frequency_basis ? [(m as any).metrics.frequency_basis] : []),
        ...(((m as any).metrics?.adaptations ?? []) as unknown[]).slice(-3),
        "weekly plan placed by Plexecute's deterministic planner (free time, commitments, rest days between strength sessions, priorities)",
      ],
    },
    root_cause: M.rootCause(outs),
    checkpoint: m.checkpoint,
    last_signal: m.last_signal,
  };
}

/** Hourly: one useful proactive note per mission per day; also moves SCHEDULED→EXECUTING and flags BLOCKED from real data. */
export async function scanMissions(admin: Db, now = new Date()) {
  const { data } = await admin
    .from("goal_missions")
    .select("*")
    .neq("state", "ACHIEVED")
    .limit(500);
  let notes = 0;
  for (const m of (data ?? []) as MissionRow[]) {
    try {
      if (m.last_signal_at && now.getTime() - new Date(m.last_signal_at).getTime() < 20 * 3600000)
        continue;
      let goal: any = null,
        nextAt: string | null = null,
        prereqs: { title: string; due?: string | null }[] = [],
        done = 0;
      if (m.goal_id) {
        const nowIso = now.toISOString();
        const [{ data: g }, { data: nb }, { data: ms }, { count }] = await Promise.all([
          admin.from("goals").select("status,deadline,title").eq("id", m.goal_id).maybeSingle(),
          admin
            .from("plan_blocks")
            .select("starts_at")
            .eq("goal_id", m.goal_id)
            .gte("starts_at", nowIso)
            .not("status", "in", "(rescheduled,cancelled)")
            .order("starts_at")
            .limit(1),
          admin
            .from("goal_milestones")
            .select("title,status,due_date,stage")
            .eq("goal_id", m.goal_id)
            .neq("status", "done")
            .limit(20),
          admin
            .from("plan_blocks")
            .select("id", { count: "exact", head: true })
            .eq("goal_id", m.goal_id)
            .eq("status", "completed"),
        ]);
        goal = g;
        nextAt = nb?.[0]?.starts_at ?? null;
        done = count ?? 0;
        prereqs = (ms ?? [])
          .filter((x: any) => /prereq|prerequisite/.test(String(x.stage ?? "")) || x.due_date)
          .map((x: any) => ({ title: x.title, due: x.due_date ?? null }));
      }
      const patch: Record<string, unknown> = {};
      if (goal?.status === "completed" && m.state !== "VERIFYING") patch["state"] = "VERIFYING";
      else if (m.state === "SCHEDULED" && done > 0) patch["state"] = "EXECUTING";
      const sig = M.missionSignals({
        title: m.title,
        state: (patch["state"] as M.MissionState) ?? m.state,
        openPrereqs: prereqs,
        nextSessionAt: nextAt,
        now,
      })[0];
      if (sig && sig.key !== m.last_signal?.key) {
        patch["last_signal"] = sig;
        patch["last_signal_at"] = now.toISOString();
        notes++;
      }
      if (Object.keys(patch).length)
        await admin
          .from("goal_missions")
          .update({ ...patch, updated_at: now.toISOString() })
          .eq("id", m.id);
    } catch (e) {
      console.error("mission scan", m.id, e);
    }
  }
  return { scanned: data?.length ?? 0, notes };
}

/** Undelivered proactive notes for the next Coach turn (cleared once surfaced). */
export async function pendingSignals(admin: Db, userId: string) {
  const { data } = await admin
    .from("goal_missions")
    .select("id,last_signal")
    .eq("user_id", userId)
    .not("last_signal", "is", null)
    .limit(5);
  const out = (data ?? []).map((r: any) => r.last_signal as M.MissionSignal).filter(Boolean);
  if (out.length)
    await admin
      .from("goal_missions")
      .update({ last_signal: null })
      .in(
        "id",
        (data ?? []).map((r: any) => r.id),
      );
  return out;
}

/** Walks a mission forward through legal states only. */
async function walkTo(
  admin: Db,
  m: MissionRow,
  target: M.MissionState,
  why: string,
  extra: Record<string, unknown> = {},
) {
  const path: M.MissionState[] = [
    "UNDERSTANDING",
    "MODELLING",
    "FEASIBILITY_CHECK",
    "PATHWAY_READY",
    "PLANNING",
    "SCHEDULED",
  ];
  let st = m.state;
  const hist = [...(m.history ?? [])];
  const now = new Date().toISOString();
  for (const s of path.slice(0, path.indexOf(target) + 1)) {
    const rank = (x: M.MissionState) =>
      x === "RESEARCHING" || x === "CAPTURED" ? (x === "CAPTURED" ? -1 : 1) : path.indexOf(x);
    if (rank(st) >= rank(s)) continue; // forward only
    if (s === st || !M.canMove(st, s)) continue;
    hist.push({ at: now, from: st, to: s, why });
    st = s;
  }
  await admin
    .from("goal_missions")
    .update({ ...extra, state: st, history: hist.slice(-40), updated_at: now })
    .eq("id", m.id);
  return st;
}

/** Deterministic mission bookkeeping after Coach's real goal/pathway/plan tools succeed. */
export async function syncFromTool(
  admin: Db,
  userId: string,
  tool: string,
  args: Record<string, unknown>,
  out: Record<string, unknown>,
) {
  let goalId =
    typeof out["goal_id"] === "string"
      ? (out["goal_id"] as string)
      : typeof args["goal_id"] === "string" && /^[0-9a-f-]{36}$/i.test(args["goal_id"] as string)
        ? (args["goal_id"] as string)
        : null;
  if (!goalId && tool === "change_training_programme") {
    // The training programme is the training goal: link the newest active training goal.
    const { data: tg } = await admin
      .from("goals")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "active")
      .in("domain", ["training", "fitness"])
      .order("created_at", { ascending: false })
      .limit(1);
    goalId = tg?.[0]?.id ?? null;
  }
  if (tool === "request_replan") {
    let all = await listMissions(admin, userId);
    // An unlinked mission whose goal was saved by a domain tool (e.g. a training programme) links to that goal.
    const unlinked = all.filter((x) => !x.goal_id && x.state !== "ACHIEVED");
    if (unlinked.length) {
      const { data: goals } = await admin
        .from("goals")
        .select("id,domain,created_at")
        .eq("user_id", userId)
        .eq("status", "active");
      const linked = new Set(all.map((x) => x.goal_id).filter(Boolean));
      const DOMAIN_EXPERT: Record<string, string> = {
        training: "fitness",
        fitness: "fitness",
        nutrition: "nutrition",
        learning: "learning",
        career: "career",
        finance: "finance",
        sleep: "sleep",
        wellness: "wellbeing",
      };
      for (const m of unlinked) {
        const cand = (goals ?? []).filter(
          (g: any) =>
            !linked.has(g.id) &&
            m.experts.includes(DOMAIN_EXPERT[g.domain] ?? "_") &&
            Date.parse(g.created_at) >= Date.parse((m as any).created_at ?? m.updated_at) - 60e3,
        );
        if (cand.length === 1) {
          await walkTo(admin, m, "PATHWAY_READY", "Goal saved for this mission", {
            goal_id: cand[0].id,
          });
          linked.add(cand[0].id);
        }
      }
      all = await listMissions(admin, userId);
    }
    for (const m of all.filter(
      (x) =>
        x.goal_id &&
        ["PATHWAY_READY", "PLANNING", "ADAPTING", "FEASIBILITY_CHECK"].includes(x.state),
    )) {
      const { count } = await admin
        .from("plan_blocks")
        .select("id", { count: "exact", head: true })
        .eq("goal_id", m.goal_id)
        .gte("starts_at", new Date().toISOString())
        .not("status", "in", "(rescheduled,cancelled)");
      if ((count ?? 0) > 0) await walkTo(admin, m, "SCHEDULED", "Sessions placed on the plan");
    }
    return;
  }
  if (!goalId) return;
  const all = await listMissions(admin, userId);
  const { data: g } = await admin
    .from("goals")
    .select("title,status")
    .eq("id", goalId)
    .maybeSingle();
  // Link: the mission already on this goal, else the most recent open unlinked mission (the one being discussed).
  let m =
    all.find((x) => x.goal_id === goalId) ??
    all.find((x) => !x.goal_id && x.state !== "ACHIEVED") ??
    null;
  if (!m) {
    const r = await advanceMission(admin, userId, {
      goal_id: goalId,
      title: g?.title ?? String(args["goal"] ?? args["title"] ?? "Goal"),
      member_text: String(args["goal"] ?? args["title"] ?? ""),
    });
    m = (await findMission(admin, userId, {
      mission_id: (r as { mission_id?: string }).mission_id ?? null,
    })) as MissionRow | null;
    if (!m) return;
  }
  const extra: Record<string, unknown> = { goal_id: goalId };
  const pw = out["pathway"] as
    | {
        done_when?: string;
        route?: string | null;
        options?: string[];
        prerequisites?: unknown[];
        assumptions?: unknown[];
        risks?: unknown[];
        milestones?: { title: string }[];
      }
    | undefined;
  let note: string | null = null;
  if (pw && m.tier === "complex" && !(m.council as { views?: unknown[] })?.views?.length)
    note = `Before replying, save the specialist reconciliation for this complex goal: advance_mission mission_id ${m.id} council {views: one per relevant specialist (${m.experts.filter((e) => e !== "research").join(", ")}) with stance, binding constraint and urgency, selected_route "${pw.route ?? ""}", alternatives, assumptions}. Then reply with ONE plan.`;
  if (pw) {
    const txt = (x: unknown) =>
      (typeof x === "string"
        ? x
        : ((x as { title?: string; text?: string; detail?: string })?.title ??
          (x as { text?: string })?.text ??
          (x as { detail?: string })?.detail ??
          JSON.stringify(x))
      ).slice(0, 200);
    extra["contract"] = M.mergeContract(m.contract, {
      ...(pw.done_when ? { definition_of_done: pw.done_when } : {}),
      prerequisites: (pw.prerequisites ?? []).map(txt),
      assumptions: (pw.assumptions ?? []).map(txt),
      risks: (pw.risks ?? []).map(txt),
      dependencies: (pw.milestones ?? []).slice(0, 10).map((x) => x.title),
    });
    if (pw.options?.length && !(m.options ?? []).length)
      extra["options"] = pw.options.map((o) => ({ name: o, selected: o === pw.route }));
    if (!(m.council as { views?: unknown[] })?.views?.length)
      extra["council"] = {
        ...(m.council ?? {}),
        views: councilFromPathway(m.experts, pw, txt),
        selected_route: pw.route ?? pw.options?.[0] ?? null,
        alternatives: (pw.options ?? []).filter((o) => o !== pw.route),
        rationale:
          "Route chosen by the pathway engine against the member's deadline, budget and prerequisites.",
        decided_at: new Date().toISOString(),
      };
    await (
      await import("./life-intelligence.server")
    ).recordIntel(admin, userId, "pathway_confidence", {
      level: (extra["contract"] as M.Contract).confidence,
    });
  }
  const target: M.MissionState =
    tool === "change_training_programme" || (!pw && g?.status === "active")
      ? "PATHWAY_READY"
      : pw && out["status"] === "saved"
        ? g?.status === "active"
          ? "PATHWAY_READY"
          : "FEASIBILITY_CHECK"
        : "MODELLING";
  await walkTo(admin, m, target, pw ? "Pathway built and saved" : `Goal saved by ${tool}`, extra);
  return note;
}

const EXPERT_WORDS: Record<string, RegExp> = {
  finance: /money|cost|£|\$|budget|saving|fund|income|cash|price|tax|loan|reserve/i,
  business: /business|customer|client|market|pricing|sales|launch|insurance|registration|supplier/i,
  career: /job|role|employer|qualification|experience|cv|interview|apprentice|chartered|career/i,
  time: /hour|week|schedule|time|deadline|month|evening|morning/i,
  risk: /risk|safety|legal|regulation|compliance|hse|licen|permit|liabilit/i,
  learning: /course|study|learn|exam|module|training|practice/i,
  fitness: /train|session|strength|cardio|exercise|injur/i,
  nutrition: /meal|calorie|protein|diet|food/i,
  wellbeing: /stress|sleep|rest|family|household|energy/i,
  writing: /chapter|draft|manuscript|word|outline|publish|edit/i,
};
/** Specialist views derived only from the saved pathway's own prerequisites, risks, assumptions and milestones. */
export function councilFromPathway(
  experts: string[],
  pw: {
    prerequisites?: unknown[];
    risks?: unknown[];
    assumptions?: unknown[];
    milestones?: { title: string }[];
  },
  txt: (x: unknown) => string,
): M.ExpertView[] {
  const pool = [
    ...(pw.risks ?? []).map((x) => ({ t: txt(x), kind: "risk" })),
    ...(pw.prerequisites ?? []).map((x) => ({ t: txt(x), kind: "prerequisite" })),
    ...(pw.assumptions ?? []).map((x) => ({ t: txt(x), kind: "assumption" })),
    ...(pw.milestones ?? []).map((x, i) => ({ t: x.title, kind: i < 2 ? "now" : "milestone" })),
  ];
  const views: M.ExpertView[] = [];
  const used = new Set<string>();
  for (const e of experts) {
    const re = EXPERT_WORDS[e];
    if (!re) continue;
    const hits = pool.filter((p) => re.test(p.t) && !used.has(p.t));
    if (!hits.length) continue;
    const c = hits.find((h) => h.kind === "risk" || h.kind === "prerequisite");
    const first = hits.find((h) => h.kind === "now" || h.kind === "milestone");
    const stance = (first ?? hits[0]!).t;
    used.add(stance);
    if (c) used.add(c.t);
    views.push({
      expert: e as M.Expert,
      stance,
      ...(c && c.t !== stance ? { constraint: c.t } : {}),
      urgency: hits.some((h) => h.kind === "now") ? "now" : first ? "soon" : "later",
    });
  }
  return views;
}
