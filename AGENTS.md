<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# AGENTS.md

- Member Knowledge redirects to Today; admin retrieval unchanged. Why: internal only.
- Research keeps questions/IDs/links, audits diversity/retries, bounds text; employer-research.ts gates open diverse adverts. Why: grounded evidence.

- V3 runs on TanStack Start + Lovable Cloud. Why: approved stack.
- Weekly schedules come from the deterministic constraint optimiser buildWeekPlan in src/lib/scheduler.ts, never from AI; proposals pass kept blocks, prior placements, adherence and energy as options. Why: no AI scheduling.
- Coach uses logged, tier-gated registry tools; direct instructions confirm actions, deletions always Confirm, guardCoachDb blocks denied tables. Information-only turns expose reads/research, not mutations. Why: screen-equivalent safety without question-to-plan side effects.
- Provider credentials use env vars only; unset features report "not switched on". Why: add credentials without redesign.
- Subscription tier is written only by the signature-verified Stripe webhook (service role), except admins (user_roles) who are set to full access by a DB trigger and never downgraded by billing. Why: no self-granted tiers; owner wants admins unrestricted.
- External callers (Stripe, Twilio, cron, calendar, health) use /api/public routes that verify signatures, bearer secrets or per-user unguessable tokens. Why: these routes bypass site auth.
- Coach, missions and miss fixes get knowledge only via retrieveForTurn (knowledge.server.ts) over knowledge-routing.ts domains, placed before the member's message, with provenance recorded. Why: one library, explainable decisions.
- Public leaf heads own canonicals; member/auth layouts use noindex; sitemap lists public content only. Why: searchable product, private workspace.
- Material schedule changes are immutable proposals needing approval (Approve or a direct Coach instruction); execution actions append events and outcomes. Why: explainable history.
- Every timed action in any domain is a plan_blocks occurrence with occurrence_kind and source_type (src/lib/occurrences.ts); domain logs link to it; status changes are validated by src/lib/execution.ts and a matching DB trigger. Why: §38 one execution model.
- Follow docs/REQUIREMENT_MATRIX.md; verify with tests/. Why: owner's completion list.
- Every planner loads buffered commitments; occurrences.ts isReplanReplaceable keeps routine/commitment rows fixed, matching approval. Why: no overlap with preserved obligations.
- Admin access uses user_roles (never profiles); admin server functions check the role first and return aggregates, never PII. Why: no escalation or PII leaks.
- Plan decisions use planning.functions.ts; protection pins automatic changes, not explicit member Coach edits; overrides recheck ownership/state and never apply to fixed commitments or bulk replans. Why: members control their plan.
- Every restore runs scripts/backup/reapply-tombstones.sql before reopening. Why: deleted members never return.

- Non-home pages share scoped styles, FeatureHeader and MemberNavigation; reuse services, never depict member data with editorial photos. Why: polish without changing home or domain logic.
- Global theme tokens use one palette; the shell ignores saved/device theme choices. Why: legacy preferences must not override product identity.
- Coach UI uses AI Elements primitives over the existing messages and send/confirm functions. Why: consistent chat, safeguards intact.

- Read nested AGENTS.md before edits (src/lib/AGENTS.md), including training section rules.
- Push diagnostics match the current device; logs secret-free. Why: acceptance ≠ receipt.

- Goal Missions (goal_missions, src/lib/mission.ts + mission.server.ts) orchestrate pathway, research, life-intelligence and the planner; never duplicate those engines, never mark ACHIEVED without a completed goal. Why: one durable goal process Coach answers from.

- Stated actionable intentions are classified by classifyActions (life-intelligence.ts) and escalate Coach to research → schedule → execute instead of advice. Why: Coach must execute, not advise.
- Coach day-of-work queues are protected manual plan_blocks via execution-queue.server.ts (schedule_execution_queue / update_execution_task); status writes go server-side because members' clients may not change plan status. Why: chat plans must become real, trackable plan entries.

- ESLint: zero errors. Why: real quality gate.
- VoiceClosing waits for playback; after-stream sign-off is fallback. Why: natural endings.
- Member usage APIs return states, not accounting; Pro calls use shared-spend reservations. Why: no balance leaks.
