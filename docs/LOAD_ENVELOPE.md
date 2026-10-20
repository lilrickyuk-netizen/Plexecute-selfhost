# Step 86 — Verified launch load envelope

## Measured here (2026-10-09)
| Target (spec §86/§88.2) | Result | Where |
|---|---|---|
| Interactive optimiser p95 < 3 s | 28 ms (200 members) | tests/load-envelope.test.ts |
| Weekly optimiser p95 < 20 s | 142 ms (100 heavy members, 20 goals, kept blocks, history) | tests/load-envelope.test.ts |
| 5,000 due events/minute | 5,000 full week plans in 50 s on one worker | tests/load-envelope.test.ts |
| Page serving (dev server, 50 concurrent) | 250 req/s, p95 317 ms, p99 436 ms, 0 failures | indicative only, not production |
| Backend API round-trip (50 concurrent, from sandbox) | 523 req/s, p95 268 ms, p99 408 ms | latency indicative; anonymous reads correctly refused |

## Not runnable inside Lovable — external infrastructure work
100,000-account dataset, 10,000 DAU, 2,000 concurrent sessions, 750 sustained / 1,500 burst API RPS:
need an isolated production-equivalent copy and a load generator (k6 Cloud or similar). Running them against the
single shared backend would degrade real members and fill it with test data.
200 concurrent AI workflows: needs contracted AI gateway quota for the test window.
100 concurrent Execute voice calls: needs Twilio credentials and a contracted test window (step 80 is waiting on keys).

## Assets ready to run
- tests/load/seed-100k.sql — 100k accounts, 300k goals, 700k plan blocks (isolated copy only).
- tests/load/launch-envelope.k6.js — sessions, sustained, burst and due-event scenarios with the §86 SLO thresholds.
