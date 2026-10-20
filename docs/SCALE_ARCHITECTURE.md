# Scale Architecture (Completion step 85 / Spec §88)

Verdict: **core contracts require no redesign below the V3 design envelope** (50M accounts,
10M MAU, 1M DAU, 250k concurrent sessions, 25M scheduled occurrences/day). Launch capacity
is not pre-provisioned; growth is absorbed by horizontal scaling behind unchanged contracts.

## Why the contracts scale

1. **Single-tenant rows keyed by `user_id` (uuid).** Every member table (`plan_blocks`,
   `coach_messages`, `daily_logs`, `goals`, `notifications`, `audit_events`, …) carries
   `user_id`, has a `(user_id, …)` index (step 84 added the missing ones), and is protected
   by per-user RLS. `user_id` is the natural partition/shard key: rows for one member never
   need to co-locate with another member's, so tables can be range/hash-partitioned or
   cell-sharded by `user_id` without changing any query or API contract.

2. **Stateless compute.** All request handling is TanStack Start server functions and
   `/api/public/*` routes on serverless/edge workers. No in-process session state, no
   local queues, no sticky sessions — any worker can serve any request, so compute scales
   horizontally by adding instances. Session state lives in the auth token + database.

3. **Durable, shardable background work.** `background_jobs` is a database ledger with
   idempotency keys, leases, bounded backoff and dead-lettering (step 63). Claiming is a
   conditional update, so N runners can drain the queue concurrently without double
   processing; the queue can be sharded by kind or key hash without contract change.
   Payloads are ids-only, so job rows stay small and replayable.

4. **Bounded work per run.** Queue drains are capped (25/run), all history/timeline/
   notification reads are limit-capped (step 84), and scheduled cron runs are single-flight
   per slot. No unbounded scans exist in the request path, so load grows linearly with
   usage, not with dataset age.

5. **No distributed-write hotspots.** The only `SELECT … FOR UPDATE` is the per-user
   per-day AI budget row (step 78) — contention is scoped to one member, never global.
   There is no global counter, sequence, or singleton row that every request must touch.

6. **Provider admission control already exists.** AI usage is tier-capped
   (`ai-budget.server.ts`), coach turns are rate-limited, calling is market-gated and
   minute-capped, and every integration reports state via `provider_calls` + flags
   (step 67). These are the levers §88.1 names (admission control, fallback quotas) and
   they work today without architectural change.

7. **Timezone-correct, region-portable data.** All day maths goes through `src/lib/tz.ts`
   with the profile's IANA timezone; timestamps are `timestamptz`. A future region
   activation (§88.1) does not require re-interpreting stored data.

8. **Immutable, append-only history.** Proposals, `plan_block_events`, audit events and
   outcome records are append-only with provenance. Append-only logs partition trivially
   by time or tenant and never need in-place mutation at scale.

## What is deliberately NOT done

- No pre-provisioned multi-region, no read replicas, no table partitioning created now —
  §88 says launch stays in one authoritative region and capacity scales with real demand.
- No caching layer added — measured load times (step 84: 0.19s open, <0.2s transitions)
  are already within target; adding cache invalidation now would be complexity without need.

## Growth path (behind unchanged contracts)

1. Vertical resize of the database (one operation, no schema change).
2. Connection pooling / read replicas for read-heavy member pages (queries are already
   per-user and capped, so replicas need no routing changes).
3. Declarative partitioning of the largest append-only tables (`plan_block_events`,
   `audit_events`, `coach_messages`) by month — transparent to the app.
4. Queue sharding of `background_jobs` by kind if a single drainer fleet saturates.
5. Cell architecture / second region per §88.1 — possible because every contract is
   tenant-scoped and stateless.

Verified 2026-10-09 against the live schema (76 migrations) and `src/lib/` server modules.
