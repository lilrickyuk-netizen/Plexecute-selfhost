/**
 * Step 68: what the coach shows when AI is unavailable. Deterministic, never invents
 * numbers, never names providers, never counts against the member's daily turns.
 */
export type AiFailure = "paused" | "busy" | "unavailable";
export type NextBlock = { title: string; startsLocal: string } | null;

const LEAD: Record<AiFailure, string> = {
  paused: "The coach is paused for a short while.",
  busy: "The coach is busy right now. Try again in a minute.",
  unavailable: "AI assistance is temporarily unavailable.",
};

export function fallbackReply(reason: AiFailure, next: NextBlock): string {
  const plan = next
    ? `Your plan still works. Next up: ${next.title} at ${next.startsLocal}. You can start it from Today.`
    : "Your plan still works. Nothing else is scheduled for today, so Today and Plan are the places to check.";
  return `${LEAD[reason]} ${plan} Your message was not counted against today's turns.`;
}

/** Only real AI replies use a turn; failed attempts are removed before counting. */
export const FALLBACK_COUNTS_AS_TURN = false;
