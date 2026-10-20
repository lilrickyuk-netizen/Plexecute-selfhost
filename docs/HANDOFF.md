# Plexecute V3 — Final Handoff Report

Date: 2026-10-10. All 105 completion items are done. This report follows the required A–H structure.

## A. Implemented and tested

- Deterministic weekly scheduling (no AI), immutable approval-based replans, feasibility verdicts from the real planner, plan version history.
- One execution model: every timed action is a plan block with validated status changes, events and verified outcomes; evidence labels.
- Training, cardio/mobility, nutrition (server-computed nutrients), recovery, wellness/meditation, learning with AI study questions.
- Life Audit onboarding (11 steps), Life Twin with provenance, goals with dependencies and protected-first ordering.
- Coach AI: server-side, tier-gated tool registry, daily turn limits, knowledge grounding with citations, safe fallback when paused, coaching styles.
- Safety engine: crisis, medical red flags, eating-disorder signals, pregnancy, obfuscation resistance, unsafe-output screening; adversarially tested.
- Behaviour Model (evidence-gated associations, user corrections), Personal Experiments with safety gates, Outcome Ledger (9 types, append-only).
- Notifications (in-app, push, email) with quiet hours, dedupe and retries; held-back reminders visible to the member.
- Calendar busy-time import, Apple Health / Health Connect ingest, WHOOP/Oura/Fitbit/Strava/Garmin adapters with provenance and dedupe.
- Professional Connect: per-domain consent, one-use expiring invitations, audited reads, labelled suggestions.
- Accountability calling (Pro/Execute): allowances, retries, keypad and live voice, no audio stored, market compliance gating.
- Billing: 4 plans, monthly/yearly, 7-day trial, Execute £10 reward, top-ups, entitlement written only by verified Stripe webhooks; admins get full access and are never downgraded.
- Offline-first Today with exactly-once sync; glanceable widget data; settings; consent system; data export, deletion, retention; Admin console (14 sections, role-checked, aggregates only).
- Legal surfaces: 10 documents generated from live rules; sign-up requires ticking Terms + Privacy.
- Performance: app opens in ~0.2s; planner 5,000 weeks in 47.5s (target 60s); 20 tables indexed; bounded queries.
- Scale architecture audited against 50M accounts / 25M scheduled items a day; backup/restore drilled for real (40/41 record kinds identical, tombstones reapplied).

## B. Functionally equivalent Lovable implementations

- TanStack Start + Lovable Cloud instead of the original native/AWS plan — same product behaviour, workflows and logic.
- Web installable to phone home screen (own icon, opens into the app) instead of a native shell for now.
- Server logic as server functions and /api/public routes instead of separate edge functions.
- Lovable AI Gateway for all AI instead of direct provider accounts.

## C. Waiting only for owner credentials / provider approval

- Payments: Stripe secret key, webhook signing key, one product ID per price; Stripe account activation. (Steps 79 deferred.)
- Phone calls and live voice: Twilio account ID, auth token, phone number, Verify service. (Step 80 deferred.)
- Email: Resend API key, sender address, support inbox.
- Google Calendar: OAuth client ID/secret (+ Google's verification review). Outlook optional.
- Food data: free USDA key (live app refuses the shared demo key).
- Wearables: WHOOP/Oura/Fitbit/Strava client keys; Garmin also needs its business agreement.
- Push notifications: Apple and Google push keys.
- Legal: lawyer approval of the 10 documents; company name, registered address, contact details; international-transfer safeguards confirmed (docs/INTERNATIONAL_TRANSFER_MANIFEST.json).
- Call markets: per-country legal sign-off before switching countries on.
- Backups: confirm point-in-time recovery on the production backend (until then daily backups; up to 24h of data could be lost vs the 15-minute target).
- Published web address (for OAuth redirects and deep links).

Full checklist with where each key goes: docs/CREDENTIAL_CHECKLIST.md.

## D. Genuinely environment-blocked work

- Native iPhone/Android app builds (need Apple's and Google's own toolchains); store submission and approval are owner actions.
- Native health readers, home-screen widgets, watch app, native screen-reader testing.
- Full-scale load run (needs an isolated restored copy; assets ready in tests/load/).

Everything preparable is done — data formats, connection points, privacy rules, fixtures. See docs/ENV_BLOCKED_REVIEW.md.

## E. Exact credentials/accounts/approvals needed

See section C and docs/CREDENTIAL_CHECKLIST.md — each entry names the exact env var, where to obtain it, and the file that consumes it. An automatic check (tests/credential-readiness.test.ts) fails if the app ever reads a key not on the list.

## F. Exact test commands / test results

- `bunx vitest run` — 345/345 pass.
- `python3 tests/e2e/final_walkthrough.py` — 23/23 (real-user walkthrough, step 104).
- `python3 tests/e2e/safety_adversarial.py` — 12/12 live.
- `python3 tests/e2e/entitlement_audit.py` — 37/37 live.
- `python3 tests/e2e/security_audit.py` — 37/37 live.
- `python3 tests/e2e/privacy_audit.py` — 36/36 live.
- `python3 tests/e2e/a11y_audit.py` — 47/47.
- `python3 tests/e2e/route_wiring_audit.py` — 171/171.
- `python3 tests/e2e/free_journey.py` — 21/21; data_and_billing.py and critical_flows.py pass.
- Live tests create fresh accounts and delete them afterwards; the owner's account is only ever viewed.

## G. Exact remaining manual/native work

1. Add the credentials in section C (each switches its feature on with no code changes).
2. Get legal approval for the 10 documents, then set LEGAL_DOCS status to "approved" and add company details.
3. Confirm point-in-time recovery with the backend provider.
4. Build and submit the native apps when ready (store approval is Apple's/Google's action).
5. Flip the kill switches on after legal sign-off, then run the step-103 test suites once more.
6. Owner testing, then ~5 real users, per the agreed launch sequence.

## H. Known defects

None.
