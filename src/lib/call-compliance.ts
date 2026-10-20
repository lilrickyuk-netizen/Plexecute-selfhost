/**
 * Call compliance manifest (V3 §64.2, Step 49). Automated calling runs only in markets whose
 * manifest row is signed off and switched on; credentials alone never enable calling.
 */
import {
  CALL_CONSENT_VERSION,
  COMPATIBLE_DISCLOSURE_VERSIONS,
  EXECUTE_CEILINGS,
} from "@/lib/calling";

export type MarketRow = {
  country: string;
  enabled: boolean;
  killed: boolean;
  signed_off_by: string | null;
  signed_off_at: string | null;
  review_ref: string | null;
  approval_basis?: string | null;
  permitted_start: string | null;
  permitted_end: string | null;
  consent_version: string | null;
  disclosure_version: string | null;
  max_attempts_per_occurrence: number | null;
  max_per_24h: number | null;
  pro_retry_allowed: boolean;
  min_answer_rate: number | null;
};

export type MarketDecision =
  | {
      ok: true;
      maxPerOccurrence: number;
      max24h: number;
      proRetry: boolean;
      minAnswerRate: number | null;
    }
  | {
      ok: false;
      reason:
        | "global_kill_switch"
        | "market_kill_switch"
        | "market_not_cleared"
        | "consent_not_approved"
        | "disclosure_not_approved"
        | "outside_permitted_hours";
    };

const hm = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
/** Permitted window in the user's local minutes; supports windows crossing midnight. */
export function inPermittedHours(localMinutes: number, start: string, end: string): boolean {
  const s = hm(start),
    e = hm(end);
  return s <= e ? localMinutes >= s && localMinutes < e : localMinutes >= s || localMinutes < e;
}

export function marketDecision(
  row: MarketRow | null,
  global: Pick<MarketRow, "killed"> | null,
  localMinutes: number,
): MarketDecision {
  if (global?.killed) return { ok: false, reason: "global_kill_switch" };
  if (!row) return { ok: false, reason: "market_not_cleared" };
  if (row.killed) return { ok: false, reason: "market_kill_switch" };
  if (
    !row.enabled ||
    !row.signed_off_by ||
    !row.signed_off_at ||
    !row.permitted_start ||
    !row.permitted_end
  )
    return { ok: false, reason: "market_not_cleared" };
  if (row.consent_version !== CALL_CONSENT_VERSION)
    return { ok: false, reason: "consent_not_approved" };
  if (!COMPATIBLE_DISCLOSURE_VERSIONS.some((version) => version === row.disclosure_version))
    return { ok: false, reason: "disclosure_not_approved" };
  if (!inPermittedHours(localMinutes, row.permitted_start, row.permitted_end))
    return { ok: false, reason: "outside_permitted_hours" };
  return {
    ok: true,
    maxPerOccurrence: Math.min(
      row.max_attempts_per_occurrence ?? EXECUTE_CEILINGS.perOccurrence,
      EXECUTE_CEILINGS.perOccurrence,
    ),
    max24h: Math.min(row.max_per_24h ?? EXECUTE_CEILINGS.rolling24h, EXECUTE_CEILINGS.rolling24h),
    proRetry: row.pro_retry_allowed,
    minAnswerRate: row.min_answer_rate,
  };
}

/** A market's own answer-rate floor (stricter than the default reputation guard only). */
export function marketReputationHold(
  recent: { answered: boolean }[],
  minAnswerRate: number | null,
  minAttempts = 10,
): boolean {
  if (minAnswerRate == null || recent.length < minAttempts) return false;
  return recent.filter((r) => r.answered).length / recent.length < minAnswerRate;
}

export const COMPLIANCE_REASON_COPY: Record<string, string> = {
  global_kill_switch: "Calls are switched off everywhere for now. In-app reminders carry on.",
  market_kill_switch: "Calls are switched off in your country for now. In-app reminders carry on.",
  market_not_cleared: "Calls aren't available in your country yet.",
  consent_not_approved:
    "Calls in your country are waiting for the updated consent wording to be approved.",
  disclosure_not_approved:
    "Calls in your country are waiting for the call opening wording to be approved.",
  outside_permitted_hours: "It's outside the hours calls are allowed in your country.",
  market_reputation_hold:
    "Calls are paused because recent calls mostly went unanswered. Reminders in the app carry on.",
};
