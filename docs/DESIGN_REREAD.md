# Step 100 — full re-read of the V3 Lovable Functional Design (2026-10-10)

The whole functional design (4,224 lines, §1–§105 and appendices B–D) was re-read from start to finish and compared with the repository. Gaps found and closed in this step:

| Spec | Gap found | Resolution |
|---|---|---|
| §71 | Password minimum was 8 characters; no breached-password screening | Minimum 12 characters at sign-up, reset and change; breached-password screening switched on in the auth service (k-anonymity, full password never sent) |
| §74 | Coach 30/min, food search 60/min, plan optimisation 12/min and call-setting 20/hour ceilings were not enforced | Added to RATE_LIMITS (src/lib/security.ts) and enforced in the server functions |
| §5.6 / §9 | Free Coach showed turns left but no 80%/100% upgrade notice | Dismissible, safety-suppressed notice at 80% and 100% of the Free daily allowance |
| §10.1 / §10.3 / §10.4 | /signup, /forgot-password, /verify-email, /app/profile, /app/privacy, /app/calendar and /app/execute had no address | Routes added; each opens the combined screen that already holds the function |

Everything else re-checked against code already in place (see docs/REQUIREMENT_MATRIX.md). Item-by-item classification is step 101.
