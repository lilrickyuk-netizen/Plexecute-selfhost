// Single source of plan entitlements (V3 §5.2–5.5). Server functions enforce these via
// entitlements.server.ts before any work; screens only mirror them.
export type Tier = "free" | "pro" | "execute";

export type Capability =
  | "experiments" // Personal Experiments (§5.2 excludes from Free)
  | "behaviour_model" // Personal Behaviour Model (§5.4)
  | "professional_connect" // Professional Connect sharing (§5.2 excludes from Free)
  | "premium_wearables" // WHOOP / Oura / Fitbit / Strava / Garmin (§5.2 excludes from Free)
  | "recovery_mode" // adaptive scheduling and Recovery Mode (§5.4)
  | "calls" // PSTN accountability (Pro limited, Execute full)
  | "persistent_calls" // Execute persistent retry
  | "live_voice" // GPT-Live / Gemini Live voice coaching
  | "appointment_booking" // Coach/Appointments booking, online or by phone (Execute)
  | "journey_planning" // Google Maps journey planning (Pro and Execute)
  | "voice_topup"; // buying extra call minutes (Pro and Execute)

const PAID: Tier[] = ["pro", "execute"];
export const CAPABILITY_TIERS: Record<Capability, Tier[]> = {
  experiments: PAID,
  behaviour_model: PAID,
  professional_connect: PAID,
  premium_wearables: PAID,
  recovery_mode: PAID,
  calls: PAID,
  persistent_calls: ["execute"],
  live_voice: ["execute"],
  appointment_booking: ["execute"],
  journey_planning: PAID,
  voice_topup: PAID,
};

export const CAPABILITY_MESSAGE: Record<Capability, string> = {
  experiments: "Personal Experiments are part of Pro and Execute.",
  behaviour_model: "Your Personal Behaviour Model is part of Pro and Execute.",
  professional_connect: "Sharing with a professional is part of Pro and Execute.",
  premium_wearables:
    "Fitness tracker connections are part of Pro and Execute. Apple Health and Health Connect stay free.",
  recovery_mode: "Recovery Mode is part of Pro and Execute. You can still move sessions yourself.",
  calls: "Calls are part of Pro and Execute.",
  persistent_calls: "Persistent calling is part of Execute.",
  live_voice: "Live voice coaching is part of Execute.",
  appointment_booking: "Appointment booking — online or by phone — is part of Execute.",
  journey_planning: "Journey Planning is part of Pro and Execute.",
  voice_topup: "Extra call minutes are available on Pro and Execute.",
};

/** Locked Free limits (§5.2). Paid tiers have no product cap here (fair-use protection applies elsewhere). */
export const FREE_LIMITS = {
  activeGoals: 3,
  externalCalendars: 1,
  majorReplansPer7Days: 2,
  aiFoodLogsPerDay: 1,
  coachTurnsPerDay: 5,
} as const;

export function normTier(t: string | null | undefined): Tier {
  return t === "pro" || t === "execute" ? t : "free";
}

export function allows(tier: string | null | undefined, cap: Capability): boolean {
  return CAPABILITY_TIERS[cap].includes(normTier(tier));
}

/** Plan triggers that count as a member-initiated major replan (onboarding and system rollovers do not). */
export const MAJOR_REPLAN_TRIGGERS = [
  "manual",
  "goal_change",
  "recovery",
  "calendar_change",
] as const;

export const LIMIT_MESSAGE = {
  externalCalendars: "Free includes one connected calendar. Pro and Execute can connect more.",
  majorReplans:
    "Free includes 2 full replans every 7 days. You can still move sessions yourself, or try Pro for unlimited replanning.",
  aiFoodLogs: "Free includes one AI food log a day. Search and barcode logging stay unlimited.",
} as const;
