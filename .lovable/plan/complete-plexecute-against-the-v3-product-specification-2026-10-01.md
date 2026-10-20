# Complete Plexecute against the V3 product specification

## Goal
Turn the current web foundation into the fullest functionally equivalent Plexecute implementation supported by Lovable. A screen is complete only when its rules, persistence, permissions, failure states and signed-in end-to-end tests work.

## Delivery sequence

1. **Truthful foundation and controls**
   - Add versioned product manifests for entitlements, safety, planning, training, nutrition, recovery, learning, experiments, notifications and integrations.
   - Add consent, audit, entitlement, usage and operational records with owner-safe access rules.
   - Enforce paid capabilities and quantitative limits on the server before external calls.

2. **Life model, goals and planning**
   - Expand onboarding to the complete Life Audit while preserving resumability and optional domains.
   - Build a versioned Life Digital Twin with commitments, constraints, provenance, confidence, validity and user locks.
   - Expand goals into metrics, milestones, priorities, deadlines, dependencies and minimum effort.
   - Replace the simple weekly placer with a deterministic five-minute constraint optimiser adapted to this runtime, including resilience buffers, hard constraints, infeasibility explanations and deterministic fallback.
   - Store immutable plan versions and require approval for material changes through readable diffs.

3. **Execution, recovery and behaviour**
   - Implement the complete execution lifecycle and append-only transition history.
   - Add start, acknowledge, snooze, partial, blocked, reschedule, skip-with-reason, complete and safety-stop actions.
   - Rebuild Recovery Mode to freeze completed/protected work, collect the disruption, solve the remaining day, show a diff and apply only after approval.
   - Add intervention budgets, obstacle plans and evidence-thresholded personal behaviour patterns.

4. **Specialist engines**
   - Training: programmes, exercise ontology, prescriptions, set logging, rest timer, substitutions, double progression, regression/deload, cardio and mobility.
   - Nutrition: safe deterministic targets, adaptive TDEE, weight trend, food provenance, meals/recipes and confirmed search/barcode/text/photo-assisted logging boundaries.
   - Recovery: qualitative GREEN/AMBER/RED/UNKNOWN state using sleep, fatigue, soreness, load and sourced wearable observations.
   - Learning: user goals, curricula, resources, retrieval prompts, assessments and deterministic 1/3/7/14/30-day review scheduling.
   - Experiments: predefined safe variants, assignment schedule, confounders, minimum observations, limitations and non-causal conclusions.

5. **Verification, outcomes, Coach and safety**
   - Add truthful evidence classes and prevent manual or calendar-only actions appearing externally verified.
   - Build the append-only Life Outcome Ledger and all required progress views.
   - Create typed AI task routing, structured truth metadata, safety checks before and after generation, Coach modes and permissioned tools.
   - Add conversation deletion/memory controls and deterministic crisis, exercise-red-flag, pregnancy/postpartum and harmful-weight-control safeguards.

6. **Connected services and paid experience**
   - Complete web subscription/trial lifecycle, annual plans, provider-sourced prices, grace/refund/cancellation states, allowance ledgers and top-ups.
   - Complete phone verification, consent, market controls, quiet hours, Pro and Execute retry policies, STOP ALL, call usage and privacy-safe history.
   - Build Google/Microsoft calendar permissions, sync, write-back and conflict reconciliation.
   - Build provider adapters for web-accessible wearables and canonical health deduplication.
   - Build Professional Connect, notification delivery tracking and privacy-safe email summaries.

7. **Privacy, operations and quality**
   - Complete exports, rights requests, retention, integration revocation and deletion jobs.
   - Add privacy-safe analytics, feature controls and a least-privilege operations console.
   - Add deterministic golden tests, database/security tests, integration contracts, AI safety evaluations, accessibility checks, visual regression and signed-in end-to-end coverage.
   - Verify desktop and mobile web flows with persisted data and explicit empty, loading, error, offline and degraded states.

## Technical details
- TanStack Start and Lovable Cloud remain the approved stack substitution.
- Deterministic policy modules remain authoritative; AI explains or proposes but does not invent schedules, calculations, evidence or entitlements.
- Changes will be delivered in dependency-sized batches with migrations, UI, rules and tests together.
- External credentials will be requested only after their complete callback/webhook infrastructure exists.
- Native mobile, watch, widget and direct HealthKit/Health Connect capabilities will remain explicitly blocked in this web-only runtime rather than represented as complete.

## Completion standard
- Each feature is verified through UI to persisted data and back to UI after reload.
- Cross-user access, invalid transitions, duplicate callbacks and allowance bypasses fail closed.
- Remaining external blockers are documented separately and never described as working until tested with real provider credentials.