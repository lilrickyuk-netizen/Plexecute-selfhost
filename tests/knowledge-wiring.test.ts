import { describe, it, expect } from "vitest";
import { routeDomains } from "../src/lib/life-intelligence";
import { routeExperts, rootCause } from "../src/lib/mission";
import {
  knowledgeDomains,
  causeChange,
  CAUSE_DOMAINS,
  CAUSE_QUERY,
} from "../src/lib/knowledge-routing";
import { retrieveGrounded } from "../src/lib/knowledge";
import { domainAnchors } from "../src/lib/knowledge-routing";

const CASES: [string, string[]][] = [
  ["I want to move into project management.", ["career"]],
  ["I keep putting off the work I planned.", ["behaviour", "habits", "productivity", "motivation"]],
  ["I have too much to do tonight.", ["productivity"]],
  ["Build me a 3-day strength programme.", ["resistance_training"]],
  ["Help me improve what I eat this week.", ["nutrition"]],
  ["I want to start learning Spanish.", ["learning"]],
  ["My schedule keeps ruining my sleep.", ["sleep"]],
  ["I'm not sure whether to change careers.", ["decisions", "career"]],
  [
    "I want to leave my job, start a business and still have enough time for my family.",
    ["career", "relationships"],
  ],
];

describe("knowledge routing: message -> domains -> retrieval", () => {
  for (const [msg, want] of CASES)
    it(msg, () => {
      const r = routeDomains(msg);
      const doms = knowledgeDomains(r.domains, routeExperts(msg, r.domains));
      expect(doms.some((d) => want.includes(d))).toBe(true);
      const b = retrieveGrounded(msg, { limit: 6, today: "2026-10-16", domains: doms });
      const ids = new Set(b.evidence.map((e) => e.chunk_id));
      const all = [
        ...b.evidence.map((e) => e.domain),
        ...domainAnchors(doms.slice(0, 4), ids).map((a) => a.domain),
      ];
      // The message's own area always reaches the context that drives the reply and its actions.
      expect(all.some((d) => want.includes(d))).toBe(true);
    });

  it("multi-domain goals reach several knowledge areas", () => {
    const msg = CASES[8]![0];
    const r = routeDomains(msg);
    const doms = knowledgeDomains(r.domains, routeExperts(msg, r.domains));
    expect(doms.length).toBeGreaterThanOrEqual(3);
  });
});

describe("root cause -> knowledge -> real plan change", () => {
  it("oversized sessions are shortened, not just moved", () => {
    const outs = [1, 2, 3].map(() => ({ status: "missed", planned_minutes: 90, reason: null }));
    const rc = rootCause(outs as never);
    expect(rc.cause).toBe("too_long");
    const ch = causeChange(
      rc.cause,
      { session_minutes: 90, weekly_minutes: 270, preferred_time: "evening" },
      null,
    );
    expect(ch?.session_minutes).toBe(45);
    const k = retrieveGrounded(CAUSE_QUERY.too_long, {
      limit: 3,
      today: "2026-10-16",
      domains: CAUSE_DOMAINS.too_long,
    });
    expect(k.evidence.length).toBeGreaterThan(0);
  });
  it("evening clashes move to a kept time", () => {
    const ch = causeChange(
      "time_conflict",
      { session_minutes: 30, weekly_minutes: 90, preferred_time: "evening" },
      7,
    );
    expect(ch?.preferred_time).toBe("morning");
  });
  it("causes that need the member do not silently reschedule", () => {
    expect(
      causeChange(
        "unclear_action",
        { session_minutes: 30, weekly_minutes: 90, preferred_time: null },
        null,
      ),
    ).toBeNull();
  });
});
