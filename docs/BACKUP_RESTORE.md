# Step 87 — Backup, restore and recovery (spec §87)

## Backup layers
1. **Platform backups (Lovable Cloud):** automatic daily database backups managed by the platform. Point-in-time
   recovery depends on the hosting plan and is switched on from the platform side, not from app code. Until it is
   confirmed on, the honest RPO is up to 24 hours, not the §87 target of 15 minutes. **Owner action:** confirm point-in-time recovery for the production backend.
2. **Logical backup (this repo):** `pg_dump -Fc -n public` of all app data — portable, encrypted at rest wherever it's stored.
   Taken by `scripts/backup/restore-drill.sh` and usable alone.
3. **Not in the database dump:** sign-in accounts (managed by the platform, included in platform backups), and secrets
   (kept only in the platform's secret store; recovery = re-enter each value listed in docs/CREDENTIALS.md).

## Deletion tombstones
Every completed account deletion leaves a `deletion_jobs` row with only a one-way hash of the member id.
After any restore, `scripts/backup/reapply-tombstones.sql` removes every member whose hash is tombstoned, from
every table with a `user_id`, so a restore never brings deleted people back. Load tombstones from the newest
source (the live backend if it survives, otherwise the latest export), never only from the restored copy.

## Recovery procedure
1. Freeze writes: switch on the maintenance kill-switch (step 88) and pause background jobs.
2. Restore: platform point-in-time restore, or `pg_restore` of the latest logical dump into a fresh database.
3. Reapply tombstones (above).
4. Verify integrity: per-table row count + checksum against the backup's manifest (`source.sums`).
5. Rebuild derived data: Admin → Knowledge → Rebuild search index (the knowledge search index needs the vector extension and is regenerated, not restored).
6. Re-enter secrets if lost, re-run the cron schedules, unfreeze, then replay dead-lettered jobs from Admin → Background work.

## Drill result (2026-10-09, run in this environment)
- Backup of the live data: 441 KB in 4 s.
- A test account was created, backed up, then **really deleted** through the app's own account-deletion job.
- Restored into an isolated empty database in 1 s. 40 of 41 tables identical row-for-row by checksum. The
  knowledge search index (empty, derived) needs the vector extension, which the drill database lacks. That's expected and handled by step 5.
- The deleted test account was present in the restored copy (1 profile, 1 goal), then removed by tombstone
  reapplication (0 left); all 49 other members untouched. Live data unaffected.
- Measured data RTO at current size: 9 s end to end. The §87 4-hour regional RTO also covers redeploying the app, which is one
  publish on Lovable.

## Run it again
`SOURCE_URL=<db url> TARGET="-h <host> -p <port> -U postgres" scripts/backup/restore-drill.sh /tmp/drill`
(optionally `AFTER_BACKUP="bun scripts/backup/drill-user.ts delete <id>"`). Quarterly, per §87.
