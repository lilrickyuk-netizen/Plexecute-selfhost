// V3 §67.1 / §68: platform health stores (Apple HealthKit, Android Health Connect).
// Pure, shared contracts: permission categories, capability boundary, canonical mapping and dedupe.

export const HEALTH_PLATFORMS = ["apple_health", "health_connect"] as const;
export type HealthPlatform = (typeof HEALTH_PLATFORMS)[number];

/** Read categories from §67.1, each switched on separately by the user. */
export const HEALTH_CATEGORIES = [
  "workouts",
  "active_energy",
  "steps",
  "distance",
  "body_mass",
  "sleep",
  "heart_rate",
  "resting_heart_rate",
] as const;
export type HealthCategory = (typeof HEALTH_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<HealthCategory, string> = {
  workouts: "Workouts",
  active_energy: "Active energy",
  steps: "Steps",
  distance: "Distance",
  body_mass: "Body weight",
  sleep: "Sleep",
  heart_rate: "Heart rate summaries",
  resting_heart_rate: "Resting heart rate",
};

export const HEALTH_KINDS = [
  "workout_minutes",
  "active_kcal",
  "steps",
  "distance_m",
  "weight_kg",
  "sleep_hours",
  "heart_rate_avg",
  "hrv_ms",
  "resting_hr",
] as const;
export type HealthKind = (typeof HEALTH_KINDS)[number];

export const KIND_CATEGORY: Record<HealthKind, HealthCategory> = {
  workout_minutes: "workouts",
  active_kcal: "active_energy",
  steps: "steps",
  distance_m: "distance",
  weight_kg: "body_mass",
  sleep_hours: "sleep",
  heart_rate_avg: "heart_rate",
  hrv_ms: "heart_rate",
  resting_hr: "resting_heart_rate",
};

export const KIND_UNIT: Record<HealthKind, string> = {
  workout_minutes: "min",
  active_kcal: "kcal",
  steps: "count",
  distance_m: "m",
  weight_kg: "kg",
  sleep_hours: "h",
  heart_rate_avg: "bpm",
  hrv_ms: "ms",
  resting_hr: "bpm",
};

/** Capability boundary: what each platform needs. A website cannot read either store directly. */
export const PLATFORM_INFO: Record<
  HealthPlatform,
  { name: string; needs: string; webAvailable: false }
> = {
  apple_health: {
    name: "Apple Health",
    needs: "the Plexecute iPhone app or an Apple Shortcut",
    webAvailable: false,
  },
  health_connect: {
    name: "Health Connect (Android)",
    needs: "the Plexecute Android app",
    webAvailable: false,
  },
};

export function sanitiseCategories(c: readonly string[]): HealthCategory[] {
  return HEALTH_CATEGORIES.filter((x) => c.includes(x));
}

/** Only samples in categories the user granted are accepted; the rest are refused and counted. */
export function filterByPermission<T extends { kind: HealthKind }>(
  samples: T[],
  granted: readonly string[],
) {
  const ok: T[] = [],
    refused: T[] = [];
  for (const s of samples) (granted.includes(KIND_CATEGORY[s.kind]) ? ok : refused).push(s);
  return { ok, refused };
}

export type IncomingSample = {
  kind: HealthKind;
  value: number;
  recorded_at: string;
  end_at?: string | null | undefined;
  provider_event_id?: string | null | undefined;
  source_device?: string | null | undefined;
  provider_updated_at?: string | null | undefined;
  deleted?: boolean | undefined;
};
export type StoredSample = {
  id: string;
  kind: string;
  recorded_at: string;
  end_at: string | null;
  provider_event_id: string | null;
  source: string;
};

const ms = (s: string) => new Date(s).getTime();

/** §68 dedupe priority: 1 exact provider event ID; 3 same type/start/end fingerprint; 4 otherwise keep both and flag possible duplicate. */
export function dedupe(
  sample: IncomingSample,
  source: string,
  existing: StoredSample[],
): { action: "update"; id: string } | { action: "insert"; possibleDuplicate: boolean } {
  if (sample.provider_event_id) {
    const hit = existing.find(
      (e) => e.source === source && e.provider_event_id === sample.provider_event_id,
    );
    if (hit) return { action: "update", id: hit.id };
  }
  const same = existing.filter(
    (e) => e.kind === sample.kind && ms(e.recorded_at) === ms(sample.recorded_at),
  );
  const fp = same.find(
    (e) =>
      (e.end_at ? ms(e.end_at) : null) === (sample.end_at ? ms(sample.end_at) : null) &&
      e.source === source &&
      !e.provider_event_id,
  );
  if (fp) return { action: "update", id: fp.id };
  const overlap = existing.some(
    (e) =>
      e.kind === sample.kind &&
      e.source !== source &&
      Math.abs(ms(e.recorded_at) - ms(sample.recorded_at)) < 5 * 60000,
  );
  return { action: "insert", possibleDuplicate: overlap || same.length > 0 };
}

export async function rawHash(s: IncomingSample): Promise<string> {
  const buf = new TextEncoder().encode(
    JSON.stringify([
      s.kind,
      s.value,
      s.recorded_at,
      s.end_at ?? null,
      s.provider_event_id ?? null,
      s.provider_updated_at ?? null,
    ]),
  );
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(t: string): Promise<string> {
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`plexecute-health:${t}`),
  );
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
