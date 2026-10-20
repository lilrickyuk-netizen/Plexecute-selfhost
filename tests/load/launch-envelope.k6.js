// Step 86 — launch load envelope (spec §88.2). Run against an ISOLATED production-equivalent copy, never the live database.
//   k6 run -e BASE_URL=https://staging.example -e API_URL=<backend url> -e ANON_KEY=<publishable key> \
//          -e TOKENS_FILE=tokens.json -e CRON_SECRET=<staging cron secret> tests/load/launch-envelope.k6.js
// tokens.json: array of member access tokens for the 100,000-account seed (tests/load/seed-100k.sql).
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";

const BASE = __ENV.BASE_URL,
  API = __ENV.API_URL,
  KEY = __ENV.ANON_KEY;
const tokens = new SharedArray("tokens", () =>
  JSON.parse(open(__ENV.TOKENS_FILE || "tokens.json")),
);
const auth = () => ({
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${tokens[Math.floor(Math.random() * tokens.length)]}`,
  },
});

export const options = {
  scenarios: {
    sessions: { executor: "constant-vus", vus: 2000, duration: "15m", exec: "session" }, // 2,000 concurrent sessions
    sustained: {
      executor: "constant-arrival-rate",
      rate: 750,
      timeUnit: "1s",
      duration: "15m",
      preAllocatedVUs: 1500,
      exec: "api",
    },
    burst: {
      executor: "ramping-arrival-rate",
      startRate: 750,
      timeUnit: "1s",
      startTime: "10m",
      preAllocatedVUs: 3000,
      stages: [
        { target: 1500, duration: "30s" },
        { target: 1500, duration: "2m" },
        { target: 750, duration: "30s" },
      ],
      exec: "api",
    },
    due_events: {
      executor: "constant-arrival-rate",
      rate: 5000,
      timeUnit: "1m",
      duration: "15m",
      preAllocatedVUs: 200,
      exec: "due",
    },
    // 200 concurrent AI workflows and 100 voice calls need contracted provider quota: see docs/LOAD_ENVELOPE.md.
  },
  thresholds: {
    "http_req_duration{kind:api}": ["p(95)<300", "p(99)<800"],
    "http_req_duration{kind:today}": ["p(95)<800"],
    "http_req_duration{kind:webhook}": ["p(95)<2000"],
    http_req_failed: ["rate<0.001"],
  },
};

const today = () => new Date().toISOString().slice(0, 10);
export function session() {
  http.get(`${BASE}/app`, { tags: { kind: "page" } });
  http.get(
    `${API}/rest/v1/plan_blocks?select=id,title,starts_at,status&starts_at=gte.${today()}&limit=50`,
    { ...auth(), tags: { kind: "today" } },
  );
  sleep(5 + Math.random() * 25);
}
export function api() {
  const r = http.get(`${API}/rest/v1/goals?select=id,title,status&limit=20`, {
    ...auth(),
    tags: { kind: "api" },
  });
  check(r, { ok: (x) => x.status === 200 });
}
export function due() {
  const r = http.post(`${BASE}/api/public/cron/reminders`, null, {
    headers: { Authorization: `Bearer ${__ENV.CRON_SECRET}` },
    tags: { kind: "webhook" },
  });
  check(r, { ack: (x) => x.status < 500 });
}
