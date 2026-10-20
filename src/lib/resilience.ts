// V3 Step 67 resilience: one shared rule set for what happens when an outside service fails.
// Pure functions; server code records outcomes, member pages only ever show member-safe wording.

/** How a service is doing, from the member's point of view. */
export type ServiceState = "working" | "not_configured" | "degraded" | "paused";

export type ServiceHealth = {
  /** Credentials are set up server-side. */
  configured: boolean;
  /** Switched off by an admin flag (kill switch). */
  pausedByFlag?: boolean;
  /** Recent call outcomes, newest first: ok true/false. */
  recent?: boolean[];
};

/** Degraded when the last few attempts mostly failed. Never exposes provider detail. */
export function serviceState(h: ServiceHealth): ServiceState {
  if (h.pausedByFlag) return "paused";
  if (!h.configured) return "not_configured";
  const r = h.recent ?? [];
  if (
    r.length >= 3 &&
    r.slice(0, 5).filter((ok) => !ok).length >= Math.ceil(Math.min(r.length, 5) / 2)
  )
    return "degraded";
  return "working";
}

/** Member-safe label. No provider names for failures, no error codes, no internals. */
export function stateLabel(s: ServiceState): string {
  switch (s) {
    case "working":
      return "Working";
    case "not_configured":
      return "Not switched on yet";
    case "degraded":
      return "Temporarily unavailable";
    case "paused":
      return "Paused";
  }
}

/** Member-safe explanation of what a failure means for them and what still works. */
export function stateDetail(s: ServiceState, fallback: string): string {
  switch (s) {
    case "degraded":
      return "This service is having trouble right now. We'll keep trying in the background; your plan and everything already on it still work as normal.";
    case "paused":
      return "This feature is paused for a short while. Your plan and sessions still work as normal.";
    default:
      return fallback;
  }
}

/** Bounded retry backoff in minutes for a failed background attempt (attempt is 1-based). Caps at 6 hours. */
export function retryDelayMinutes(attempt: number): number {
  const base = [5, 15, 60, 180, 360];
  return base[Math.min(Math.max(attempt, 1), base.length) - 1]!;
}

/** Give up after this many attempts and leave the item for admin replay instead of looping forever. */
export const MAX_BACKGROUND_ATTEMPTS = 5;

/** Should a failed background item be retried again? */
export function shouldRetry(attempts: number): boolean {
  return attempts < MAX_BACKGROUND_ATTEMPTS;
}
