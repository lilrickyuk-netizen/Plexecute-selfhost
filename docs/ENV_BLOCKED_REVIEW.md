# Item 102 — Environment-blocked review (2026-10-10)

Every item classified **D** (genuinely environment-blocked) in docs/RECONCILIATION.md was re-examined with the question: "truly impossible in the Lovable environment, or merely difficult?"

## Verdicts

| Item | Verdict | Why |
|---|---|---|
| 41 Apple Health / Health Connect native reader | Genuine blocker | Reading on-device health data requires a compiled iOS/Android app (Xcode / Android Studio). Not buildable here. |
| 57 Native widgets, watch, Live Activities | Genuine blocker | WidgetKit, ActivityKit, Wear OS tiles all require native compilation. |
| 81 Native screen readers | Genuine blocker | VoiceOver/TalkBack testing requires a physical device or native simulator. Web accessibility (47 checks) is fully tested. |
| 86 Full-scale load run | Genuine blocker | A 50M-account load run needs isolated infrastructure; running it on the live backend would harm real data. Fixtures exist for an isolated copy. |
| 91 Native app build + store review | Genuine blocker | Store binaries need Xcode/Android Studio; store approval is an owner action with Apple/Google. |

No item was "merely difficult" — nothing in class D can be implemented further here.

## Residual work requires no redesign

For each blocker, every possible backend, database, API, contract, event, payload, integration boundary and test fixture is already complete:

- **41 Health**: `POST /api/public/health/ingest` (per-connection keyed, category-limited, dedupe per §68), mapping in `src/lib/health.ts`, live-tested with signed payloads. The native reader only needs to HTTPS-POST the documented payload.
- **57 Native surfaces**: one payload contract `buildGlance` (src/lib/glance.ts, version 1) covers day status, next, live activity, complication text, permitted actions, lock-screen-safe titles and staleness; feed at `GET /api/public/glance`; actions reuse `transitionPlanBlock` with device idempotency keys; refresh via push + 15-min polling; fixtures in `tests/offline-glance.test.ts`. Full contract in docs/NATIVE_SURFACES.md.
- **81 Screen readers**: web layer passes all 47 accessibility checks in dark and light mode; native screen-reader behaviour is a store-build QA task, no app change needed.
- **86 Load**: `tests/load/seed-100k.sql`, `tests/load/launch-envelope.k6.js`, `tests/load-envelope.test.ts` and docs/LOAD_ENVELOPE.md — run only on an isolated restored copy, never live.
- **91 Stores**: store product IDs with locked prices and trial, restore-purchase flow, store privacy answers, health-permission wording, deep-link assets (switched off until the four Apple/Google identifiers are added), web install live. Checklist in docs/STORE_READINESS.md.

Conclusion: all class D items are genuinely blocked by native toolchains or external infrastructure, and each is prepared so the remaining work is configuration/compilation only — no redesign.
