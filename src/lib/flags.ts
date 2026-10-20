/**
 * V3 §92 feature flags. Only keys in this catalogue exist. Flags may stage rollout,
 * disable a failing integration or cap provider-limited features. They can never
 * change prices, bypass safety, weaken consent or grant entitlements, so no such
 * key is defined and caps can only lower a limit, never raise it.
 */
export type FlagKind = "kill_switch" | "cap";
export interface FlagDef {
  key: string;
  kind: FlagKind;
  label: string;
  detail: string;
  maxCap?: number;
}

export const FLAG_CATALOGUE: readonly FlagDef[] = [
  {
    key: "coach_ai",
    kind: "kill_switch",
    label: "AI coach replies",
    detail: "Off: the coach replies that it is paused. Safety screening still runs.",
  },
  {
    key: "calls_outbound",
    kind: "kill_switch",
    label: "Accountability calls",
    detail: "Off: no new call attempts are placed. Unused allowance is kept.",
  },
  {
    key: "wearable_sync",
    kind: "kill_switch",
    label: "Wearable sync",
    detail: "Off: wearable syncs are skipped and resume when switched back on.",
  },
  {
    key: "voice_input",
    kind: "kill_switch",
    label: "Speak instead of typing",
    detail:
      "Off: microphone buttons report voice input is paused; typing keeps working everywhere.",
  },
  {
    key: "ai_assist",
    kind: "kill_switch",
    label: "AI research and question writing",
    detail:
      "Off: career research and AI study questions pause; saved research, plans and manual questions keep working.",
  },
  {
    key: "push_notifications",
    kind: "kill_switch",
    label: "Phone notifications",
    detail:
      "Off: phone notifications are held, not lost, and send when switched back on. In-app messages carry on.",
  },
  {
    key: "email_notifications",
    kind: "kill_switch",
    label: "Email notifications",
    detail:
      "Off: emails are held, not lost, and send when switched back on. In-app messages carry on.",
  },
  {
    key: "calendar_sync",
    kind: "kill_switch",
    label: "Calendar sync",
    detail:
      "Off: calendar syncs are skipped; your last known busy times stay in use and sync resumes when switched back on.",
  },
  {
    key: "billing_checkout",
    kind: "kill_switch",
    label: "New purchases",
    detail:
      "Off: new plan sign-ups and extra-minute purchases pause. Existing plans, renewals, cancellations and the billing portal keep working.",
  },
  {
    key: "food_photo",
    kind: "kill_switch",
    label: "Food photo recognition",
    detail: "Off: members log food by search instead.",
  },
  {
    key: "coach_daily_turn_cap",
    kind: "cap",
    label: "Coach turns per member per day (lower only)",
    detail:
      "Lowers the daily coach limit while a provider is limited. Cannot exceed the plan limit.",
    maxCap: 200,
  },
];

export const PAUSED_AI =
  "AI research is paused for now. Your saved work is safe; please try again later.";
export const PAUSED_PURCHASES =
  "New purchases are paused for a short while. Your current plan is unaffected; please try again later.";

/** Notification channels whose delivery is held while their kill switch is off. */
export function heldChannels(pushOn: boolean, emailOn: boolean): string[] {
  return [...(pushOn ? [] : ["push"]), ...(emailOn ? [] : ["email"])];
}

export function flagDef(key: string) {
  return FLAG_CATALOGUE.find((f) => f.key === key);
}

/** Effective cap: a flag cap may only lower the plan limit. */
export function applyCap(planLimit: number, cap: number | null | undefined) {
  return cap == null || cap < 0 ? planLimit : Math.min(planLimit, cap);
}
