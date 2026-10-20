# Goal Mission upgrade — wire existing intelligence into one mission process

## What the audit found
Most of the intelligence in your brief already exists. Several parts don't feed into each other:
- **Connected:** Coach's topic routing and intent reading, the goal pathway engine (prerequisites, milestones, feasibility), the life map, conflict and priority checks, progress projection, miss-pattern learning (the weekly planner already uses it), session briefs, replanning.
- **Disconnected:**
  1. Coach is told to use research but has no research tool, so it can't research qualification or career routes from chat.
  2. The planner records why each session was placed, but Coach never reads it back, so it can't answer "why are we doing it this way?" from real records.
  3. Onboarding goals skip feasibility, conflict and confidence checks entirely.
  4. Money and time conflicts are spotted, but the weekly planner ignores them.
  5. The pathway confidence measure is never recorded.
  6. Proactive warnings only show up when Coach is asked, never on their own.
  7. Nothing stores where a goal is in its journey, so long goals start over in each conversation.

## What gets built (reusing existing engines, nothing duplicated)
1. **Goal Mission record:** one saved record per meaningful goal. It holds the state (Captured → Understanding → Researching → Feasibility check → Pathway ready → Scheduled → Executing → Blocked/Adapting → Verifying → Achieved), a checkpoint so work picks up where it stopped, and the Goal Definition Contract (outcome, definition of done, horizon, current state, metrics, constraints, resources, assumptions, unknowns, confidence, risks, evidence required). States only move forward on real data. Nothing is marked done unless it's true.
2. **Dream → concrete outcome:** vague dreams ("financial freedom") get a short set of the most useful clarification questions, chosen by fixed rules. Coach asks those before building a plan. It never makes up a definition.
3. **Hidden expert routing and council:** expert profiles (career, business, finance, learning, health, nutrition, time, risk, and others) sit on top of the existing topic routing. Simple requests use one route, moderate goals use a few experts, and complex cross-domain goals (like leaving a job to start a company) use a council. A single summariser combines their views into one plan. Disagreements, alternatives, trade-offs, the chosen route and the reasons are saved with the mission.
4. **Research tool for Coach:** connect the existing research engine (real sources, dates, trust scores) to Coach. Pathways that depend on current facts must be researched first, and results are reused.
5. **Pathway options:** where real alternatives exist, Coach compares 2–3 routes by time, cost, experience, location, schedule and risk, then recommends one and says why.
6. **Feasibility with blocker types:** blockers are labelled hard, soft, unknown or resolvable, with a route around them where one exists.
7. **Execution-ready actions:** every scheduled action carries an objective, exact action, first step, duration, definition of done, the evidence needed and the next action. Vague tasks are rejected.
8. **Changes flow downstream:** changing a target date or available hours rechecks feasibility, moves milestone dates, starts a replan proposal and updates progress projection.
9. **Planner uses conflicts:** the weekly planner gives less weight to goals flagged by detected money and time conflicts.
10. **Evidence-based completion:** the evidence needed is matched to how important the task is (workout logged, meal logged, call result, booking confirmed, quiz, upload, or member confirmation).
11. **Outcome learning and root cause:** repeated misses get a likely cause (time clash, too long, unclear, missing prerequisite, fatigue, cost, wrong route). The plan then changes to fix the cause instead of just moving the session.
12. **Proactive mission check:** the existing hourly job looks for real, useful issues (deadline risk, falling behind, schedule clashes, unmet dependencies). It saves at most one note per mission a day, and Coach brings it up in your next chat.
13. **Coach answers from the mission:** "What's next / why / what's blocking me / am I on track / what changed / find another route / I only have 3 hours now" are answered from the saved mission and real data.
14. **Onboarding and Goals:** onboarding goals become missions. The goal page shows mission stage, next action and blockers. No expert names or internal workings are shown.

## Cost control
Stored information and fixed rules come first. The council only runs for complex goals. Research is cached and reused.

## Tests
New-member tests for all of your scenarios: own a business, financial freedom, quantity surveyor, write a book, get fit, leave job for construction. They check each pipeline stage, the clarify-first behaviour, saved rationale, resume from checkpoint and blocker labels. The full existing test suite must keep passing.

## Technical details
- New table `goal_missions` (user_id, goal_id, state, checkpoint jsonb, contract jsonb, council jsonb, options jsonb, blockers jsonb, updated_at) with RLS for the owner, added to privacy USER_TABLES and deletion.
- `src/lib/mission.ts` (pure: state machine, contract builder, clarification picker, blocker classifier, expert tiering, synthesis rules) and `mission.server.ts` (persist and resume, orchestrate the existing pathway/research/life-intelligence/planning cores).
- New Coach tools: `research_topic`, `get_mission`, `advance_mission`, `explain_decision` (reads `plan_versions.rationale` and mission council). Plus prompt updates.
- Write the `pathway_confidence` intel event. Feed `detectConflicts` weights into `proposeWeekPlanCore`. Add the mission scan to the hourly tick.
- AGENTS.md rule: missions orchestrate existing engines and never duplicate them.
