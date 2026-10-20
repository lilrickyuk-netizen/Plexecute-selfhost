// V3 §67.2 wearable adapters: WHOOP, Oura, Fitbit, Strava, Garmin Health API.
// Pure contracts: scopes, endpoints, raw → canonical mapping, dedupe keys, staleness, failure handling.
import type { IncomingSample } from "./health";

export const WEARABLES = ["whoop", "oura", "fitbit", "strava", "garmin"] as const;
export type Wearable = (typeof WEARABLES)[number];

export type Adapter = {
  name: string;
  data: string;
  auth: string;
  token: string;
  scopes: string[];
  scopeSep: " " | ",";
  pkce: boolean;
  tokenAuth: "body" | "basic";
  envId: string;
  envSecret: string;
  sync: "webhook+poll" | "poll";
  staleHours: number;
  /** Requests allowed per sync run, kept well under each provider's published limit. */
  maxRequests: number;
  note?: string;
};

export const ADAPTERS: Record<Wearable, Adapter> = {
  whoop: {
    name: "WHOOP",
    data: "Sleep, recovery heart rate and workouts",
    auth: "https://api.prod.whoop.com/oauth/oauth2/auth",
    token: "https://api.prod.whoop.com/oauth/oauth2/token",
    scopes: ["read:sleep", "read:recovery", "read:workout", "read:body_measurement", "offline"],
    scopeSep: " ",
    pkce: false,
    tokenAuth: "body",
    envId: "WHOOP_CLIENT_ID",
    envSecret: "WHOOP_CLIENT_SECRET",
    sync: "webhook+poll",
    staleHours: 36,
    maxRequests: 10,
  },
  oura: {
    name: "Oura",
    data: "Sleep, steps, heart rate and workouts",
    auth: "https://cloud.ouraring.com/oauth/authorize",
    token: "https://api.ouraring.com/oauth/token",
    scopes: ["daily", "heartrate", "workout"],
    scopeSep: " ",
    pkce: false,
    tokenAuth: "body",
    envId: "OURA_CLIENT_ID",
    envSecret: "OURA_CLIENT_SECRET",
    sync: "webhook+poll",
    staleHours: 36,
    maxRequests: 10,
  },
  fitbit: {
    name: "Fitbit",
    data: "Steps, sleep, resting heart rate, weight and workouts",
    auth: "https://www.fitbit.com/oauth2/authorize",
    token: "https://api.fitbit.com/oauth2/token",
    scopes: ["activity", "sleep", "heartrate", "weight"],
    scopeSep: " ",
    pkce: true,
    tokenAuth: "basic",
    envId: "FITBIT_CLIENT_ID",
    envSecret: "FITBIT_CLIENT_SECRET",
    sync: "webhook+poll",
    staleHours: 36,
    maxRequests: 10,
  },
  strava: {
    name: "Strava",
    data: "Runs, rides and other workouts",
    auth: "https://www.strava.com/oauth/authorize",
    token: "https://www.strava.com/oauth/token",
    scopes: ["read", "activity:read_all"],
    scopeSep: ",",
    pkce: false,
    tokenAuth: "body",
    envId: "STRAVA_CLIENT_ID",
    envSecret: "STRAVA_CLIENT_SECRET",
    sync: "webhook+poll",
    staleHours: 72,
    maxRequests: 5,
  },
  garmin: {
    name: "Garmin",
    data: "Steps, sleep, resting heart rate and workouts",
    auth: "https://connect.garmin.com/oauth2Confirm",
    token: "https://diauth.garmin.com/di-oauth2-service/oauth/token",
    scopes: [],
    scopeSep: " ",
    pkce: true,
    tokenAuth: "body",
    envId: "GARMIN_CLIENT_ID",
    envSecret: "GARMIN_CLIENT_SECRET",
    sync: "webhook+poll",
    staleHours: 36,
    maxRequests: 12,
    note: "Needs Garmin's commercial developer agreement before it can be switched on.",
  },
};

export const isStale = (p: Wearable, last: string | null, now = new Date()) =>
  !last || now.getTime() - new Date(last).getTime() > ADAPTERS[p].staleHours * 36e5;

/** 401/invalid_grant → revoked (reconnect); 429/5xx/403 → degraded (retry later). */
export function classifyFailure(status: number, body = ""): "revoked" | "degraded" {
  if (status === 401 || /invalid_grant|invalid_token|unauthorized_client/i.test(body))
    return "revoked";
  return "degraded";
}

const iso = (s: string | number) => new Date(typeof s === "number" ? s * 1000 : s).toISOString();
const noon = (day: string) => `${day}T12:00:00.000Z`; // day-level totals land inside the same local day in UK/EU zones
type S = IncomingSample;
const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

// ---- WHOOP (developer v2) ----
type WSleep = {
  id: string;
  start: string;
  end: string;
  nap?: boolean;
  score?: { stage_summary?: { total_in_bed_time_milli?: number; total_awake_time_milli?: number } };
};
type WRec = {
  sleep_id?: string;
  cycle_id?: number;
  created_at: string;
  score?: { resting_heart_rate?: number; hrv_rmssd_milli?: number };
};
type WWork = {
  id: string;
  start: string;
  end: string;
  score?: { kilojoule?: number; distance_meter?: number };
};
export function mapWhoop(d: { sleep?: WSleep[]; recovery?: WRec[]; workout?: WWork[] }): S[] {
  const out: S[] = [];
  for (const s of d.sleep ?? []) {
    const st = s.score?.stage_summary;
    if (s.nap || !st?.total_in_bed_time_milli) continue;
    out.push({
      kind: "sleep_hours",
      value: +((st.total_in_bed_time_milli - (st.total_awake_time_milli ?? 0)) / 36e5).toFixed(2),
      recorded_at: iso(s.start),
      end_at: iso(s.end),
      provider_event_id: `sleep:${s.id}`,
    });
  }
  for (const r of d.recovery ?? []) {
    const id = r.sleep_id ?? String(r.cycle_id);
    if (ok(r.score?.resting_heart_rate))
      out.push({
        kind: "resting_hr",
        value: r.score!.resting_heart_rate!,
        recorded_at: iso(r.created_at),
        provider_event_id: `rhr:${id}`,
      });
    if (ok(r.score?.hrv_rmssd_milli))
      out.push({
        kind: "hrv_ms",
        value: +r.score!.hrv_rmssd_milli!.toFixed(1),
        recorded_at: iso(r.created_at),
        provider_event_id: `hrv:${id}`,
      });
  }
  for (const w of d.workout ?? []) {
    const min = (new Date(w.end).getTime() - new Date(w.start).getTime()) / 60000;
    out.push({
      kind: "workout_minutes",
      value: Math.round(min),
      recorded_at: iso(w.start),
      end_at: iso(w.end),
      provider_event_id: `workout:${w.id}`,
    });
    if (ok(w.score?.kilojoule))
      out.push({
        kind: "active_kcal",
        value: Math.round(w.score!.kilojoule! / 4.184),
        recorded_at: iso(w.start),
        provider_event_id: `workout_kcal:${w.id}`,
      });
  }
  return out;
}

// ---- Oura (v2 usercollection) ----
type OAct = {
  id: string;
  day: string;
  steps?: number;
  active_calories?: number;
  equivalent_walking_distance?: number;
};
type OSleep = {
  id: string;
  type?: string;
  bedtime_start: string;
  bedtime_end: string;
  total_sleep_duration?: number;
  lowest_heart_rate?: number;
  average_hrv?: number;
};
type OWork = {
  id: string;
  start_datetime: string;
  end_datetime: string;
  calories?: number;
  distance?: number;
};
export function mapOura(d: { daily_activity?: OAct[]; sleep?: OSleep[]; workout?: OWork[] }): S[] {
  const out: S[] = [];
  for (const a of d.daily_activity ?? []) {
    if (ok(a.steps))
      out.push({
        kind: "steps",
        value: a.steps,
        recorded_at: noon(a.day),
        provider_event_id: `steps:${a.day}`,
      });
    if (ok(a.active_calories))
      out.push({
        kind: "active_kcal",
        value: a.active_calories,
        recorded_at: noon(a.day),
        provider_event_id: `kcal:${a.day}`,
      });
  }
  for (const s of d.sleep ?? []) {
    if (s.type && s.type !== "long_sleep") continue;
    if (ok(s.total_sleep_duration))
      out.push({
        kind: "sleep_hours",
        value: +(s.total_sleep_duration / 3600).toFixed(2),
        recorded_at: iso(s.bedtime_start),
        end_at: iso(s.bedtime_end),
        provider_event_id: `sleep:${s.id}`,
      });
    if (ok(s.lowest_heart_rate))
      out.push({
        kind: "resting_hr",
        value: s.lowest_heart_rate,
        recorded_at: iso(s.bedtime_end),
        provider_event_id: `rhr:${s.id}`,
      });
    if (ok(s.average_hrv))
      out.push({
        kind: "hrv_ms",
        value: s.average_hrv,
        recorded_at: iso(s.bedtime_end),
        provider_event_id: `hrv:${s.id}`,
      });
  }
  for (const w of d.workout ?? []) {
    out.push({
      kind: "workout_minutes",
      value: Math.round(
        (new Date(w.end_datetime).getTime() - new Date(w.start_datetime).getTime()) / 60000,
      ),
      recorded_at: iso(w.start_datetime),
      end_at: iso(w.end_datetime),
      provider_event_id: `workout:${w.id}`,
    });
    if (ok(w.distance))
      out.push({
        kind: "distance_m",
        value: Math.round(w.distance),
        recorded_at: iso(w.start_datetime),
        provider_event_id: `workout_dist:${w.id}`,
      });
  }
  return out;
}

// ---- Fitbit (Web API, metric units) ----
type FSteps = { dateTime: string; value: string };
type FSleep = {
  logId: number;
  startTime: string;
  endTime: string;
  minutesAsleep: number;
  isMainSleep?: boolean;
};
type FHeart = { dateTime: string; value?: { restingHeartRate?: number } };
type FWeight = { logId: number; date: string; time?: string; weight: number };
type FAct = {
  logId: number;
  startTime: string;
  activeDuration?: number;
  duration?: number;
  calories?: number;
  distance?: number;
  distanceUnit?: string;
};
export function mapFitbit(d: {
  steps?: FSteps[];
  sleep?: FSleep[];
  heart?: FHeart[];
  weight?: FWeight[];
  activities?: FAct[];
}): S[] {
  const out: S[] = [];
  for (const s of d.steps ?? []) {
    const v = Number(s.value);
    if (ok(v) && v > 0)
      out.push({
        kind: "steps",
        value: v,
        recorded_at: noon(s.dateTime),
        provider_event_id: `steps:${s.dateTime}`,
      });
  }
  for (const s of d.sleep ?? [])
    if (s.isMainSleep !== false)
      out.push({
        kind: "sleep_hours",
        value: +(s.minutesAsleep / 60).toFixed(2),
        recorded_at: iso(s.startTime),
        end_at: iso(s.endTime),
        provider_event_id: `sleep:${s.logId}`,
      });
  for (const h of d.heart ?? [])
    if (ok(h.value?.restingHeartRate))
      out.push({
        kind: "resting_hr",
        value: h.value!.restingHeartRate!,
        recorded_at: noon(h.dateTime),
        provider_event_id: `rhr:${h.dateTime}`,
      });
  for (const w of d.weight ?? [])
    out.push({
      kind: "weight_kg",
      value: +w.weight.toFixed(2),
      recorded_at: iso(`${w.date}T${w.time ?? "08:00:00"}Z`),
      provider_event_id: `weight:${w.logId}`,
    });
  for (const a of d.activities ?? []) {
    const ms = a.activeDuration ?? a.duration;
    if (!ok(ms)) continue;
    out.push({
      kind: "workout_minutes",
      value: Math.round(ms / 60000),
      recorded_at: iso(a.startTime),
      end_at: iso(new Date(a.startTime).getTime() / 1000 + ms / 1000),
      provider_event_id: `workout:${a.logId}`,
    });
    if (ok(a.distance) && (a.distanceUnit ?? "Kilometer") === "Kilometer")
      out.push({
        kind: "distance_m",
        value: Math.round(a.distance * 1000),
        recorded_at: iso(a.startTime),
        provider_event_id: `workout_dist:${a.logId}`,
      });
  }
  return out;
}

// ---- Strava (v3 summary activities) ----
type SAct = {
  id: number;
  start_date: string;
  moving_time: number;
  elapsed_time?: number;
  distance?: number;
  kilojoules?: number;
};
export function mapStrava(acts: SAct[]): S[] {
  const out: S[] = [];
  for (const a of acts) {
    const start = iso(a.start_date);
    out.push({
      kind: "workout_minutes",
      value: Math.round(a.moving_time / 60),
      recorded_at: start,
      end_at: iso(new Date(start).getTime() / 1000 + (a.elapsed_time ?? a.moving_time)),
      provider_event_id: `activity:${a.id}`,
    });
    if (ok(a.distance) && a.distance > 0)
      out.push({
        kind: "distance_m",
        value: Math.round(a.distance),
        recorded_at: start,
        provider_event_id: `activity_dist:${a.id}`,
      });
    if (ok(a.kilojoules))
      out.push({
        kind: "active_kcal",
        value: Math.round(a.kilojoules),
        recorded_at: start,
        provider_event_id: `activity_kcal:${a.id}`,
      }); // Strava: kJ of work ≈ kcal burned
  }
  return out;
}

// ---- Garmin Health API ----
type GDaily = {
  summaryId: string;
  calendarDate: string;
  steps?: number;
  activeKilocalories?: number;
  distanceInMeters?: number;
  restingHeartRateInBeatsPerMinute?: number;
};
type GSleep = {
  summaryId: string;
  startTimeInSeconds: number;
  durationInSeconds: number;
  awakeDurationInSeconds?: number;
};
type GAct = {
  summaryId: string;
  startTimeInSeconds: number;
  durationInSeconds: number;
  distanceInMeters?: number;
  activeKilocalories?: number;
};
export function mapGarmin(d: { dailies?: GDaily[]; sleeps?: GSleep[]; activities?: GAct[] }): S[] {
  const out: S[] = [];
  for (const g of d.dailies ?? []) {
    const at = noon(g.calendarDate);
    if (ok(g.steps))
      out.push({
        kind: "steps",
        value: g.steps,
        recorded_at: at,
        provider_event_id: `steps:${g.calendarDate}`,
      });
    if (ok(g.activeKilocalories))
      out.push({
        kind: "active_kcal",
        value: g.activeKilocalories,
        recorded_at: at,
        provider_event_id: `kcal:${g.calendarDate}`,
      });
    if (ok(g.distanceInMeters))
      out.push({
        kind: "distance_m",
        value: Math.round(g.distanceInMeters),
        recorded_at: at,
        provider_event_id: `dist:${g.calendarDate}`,
      });
    if (ok(g.restingHeartRateInBeatsPerMinute))
      out.push({
        kind: "resting_hr",
        value: g.restingHeartRateInBeatsPerMinute,
        recorded_at: at,
        provider_event_id: `rhr:${g.calendarDate}`,
      });
  }
  for (const s of d.sleeps ?? [])
    out.push({
      kind: "sleep_hours",
      value: +((s.durationInSeconds - (s.awakeDurationInSeconds ?? 0)) / 3600).toFixed(2),
      recorded_at: iso(s.startTimeInSeconds),
      end_at: iso(s.startTimeInSeconds + s.durationInSeconds),
      provider_event_id: `sleep:${s.summaryId}`,
    });
  for (const a of d.activities ?? [])
    out.push({
      kind: "workout_minutes",
      value: Math.round(a.durationInSeconds / 60),
      recorded_at: iso(a.startTimeInSeconds),
      end_at: iso(a.startTimeInSeconds + a.durationInSeconds),
      provider_event_id: `activity:${a.summaryId}`,
    });
  return out;
}
