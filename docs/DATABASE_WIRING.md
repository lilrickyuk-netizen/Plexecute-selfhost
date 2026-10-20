# Database wiring audit (Step 94)

Enforced by tests/database-wiring.test.ts over every table in the live schema (88):
- **Written and read:** every table has a real write path (app code or database function) and a real read path. Three tables were written but never read; they now have readers:
  - intervention_decisions → Settings → Notifications "Reminders held back" (member sees why a reminder wasn't sent)
  - retrieval_reviews → Learning: 30-day recall accuracy per goal
  - background_job_events → Admin → Jobs: attempt history on each failed job
- **Permissions:** RLS is on for every table. Member tables use owner-only policies; service-only tables (phone_numbers, calendar/wearable credentials, call_market_manifest, feature_flags, deletion_jobs, admin_access_log, ai_usage, rate_limits) have no client policies, and append-only/server-written tables are read-only to members.
- **Lifecycle / export / deletion / retention:** every member table is in USER_TABLES (export, wipe, account deletion); the remaining 16 are service tables (jobs, logs, flags, knowledge index, incidents) pruned by the daily retention jobs.
- **Duplicate schemas:** supabase/migrations is the applied history; drizzle/migrations holds the later SQL files applied through the same backend. Neither is obsolete, so nothing was removed.
