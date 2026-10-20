// Time zone maths on the user's IANA zone (V3 step 16). Pure; DST-safe via Intl.
// Never use Date#getHours/setHours for user-facing day logic: servers run in UTC.

export function runtimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
const zoneCache = new Map<string, string>();
export function validZone(tz: string | null | undefined): string {
  if (!tz) return runtimeZone();
  const hit = zoneCache.get(tz);
  if (hit) return hit;
  let z = "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    z = tz;
  } catch {
    /* invalid zone falls back to UTC */
  }
  if (zoneCache.size < 1000) zoneCache.set(tz, z);
  return z;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export type ZonedParts = {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  key: string;
  minutes: number;
  isoDow: number;
};

/** Wall-clock parts of an instant in a zone. isoDow: Mon=1..Sun=7. */
export function zonedParts(date: Date | string | number, tz?: string | null): ZonedParts {
  const z = validZone(tz);
  const p: Record<string, number> = {};
  for (const x of fmt(z).formatToParts(new Date(date)))
    if (x.type !== "literal") p[x.type] = Number(x.value);
  const y = p["year"]!,
    mo = p["month"]!,
    d = p["day"]!,
    h = p["hour"]! % 24,
    mi = p["minute"]!,
    s = p["second"]!;
  const key = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { y, mo, d, h, mi, s, key, minutes: h * 60 + mi, isoDow: isoDowOfKey(key) };
}

export function localDayKey(date: Date | string | number = new Date(), tz?: string | null) {
  return zonedParts(date, tz).key;
}

/** Calendar arithmetic on YYYY-MM-DD keys (zone-free). */
export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + n));
  return t.toISOString().slice(0, 10);
}
export function diffDaysKey(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`),
    tb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((ta - tb) / 864e5);
}
export function isoDowOfKey(key: string): number {
  const dow = new Date(`${key}T00:00:00Z`).getUTCDay();
  return ((dow + 6) % 7) + 1;
}

/** The instant at which a local wall-clock time occurs (minutes may exceed a day or be negative). DST gaps resolve forward. */
export function zonedInstant(dayKey: string, minutes: number, tz?: string | null): Date {
  const z = validZone(tz);
  const [y, m, d] = dayKey.split("-").map(Number);
  const wallUtc = Date.UTC(y!, m! - 1, d!, 0, minutes, 0, 0);
  let guess = wallUtc;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, z);
    const seen = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    const diff = wallUtc - seen;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/** Local midnight that begins the given day in the zone. */
export function startOfLocalDay(date: Date | string | number, tz?: string | null): Date {
  return zonedInstant(localDayKey(date, tz), 0, tz);
}
/** [start, end) instants of the local day containing `date`. */
export function localDayRange(
  date: Date | string | number = new Date(),
  tz?: string | null,
): [Date, Date] {
  const key = localDayKey(date, tz);
  return [zonedInstant(key, 0, tz), zonedInstant(addDaysKey(key, 1), 0, tz)];
}
/** Monday key of the local week containing `date`. */
export function weekKeyOf(date: Date | string | number, tz?: string | null): string {
  const p = zonedParts(date, tz);
  return addDaysKey(p.key, -(p.isoDow - 1));
}
/** First day (YYYY-MM-DD) of the local calendar month containing `date`, plus its start instant. */
export function localMonthStart(
  date: Date | string | number = new Date(),
  tz?: string | null,
): Date {
  const p = zonedParts(date, tz);
  return zonedInstant(`${p.y}-${String(p.mo).padStart(2, "0")}-01`, 0, tz);
}
/** HH:MM in the zone. */
export function localHm(date: Date | string | number, tz?: string | null): string {
  const p = zonedParts(date, tz);
  return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
}
/** Is `now` inside quiet hours [start, end) given as HH:MM local, wrapping midnight? */
export function inQuietHours(
  now: Date,
  startHm: string,
  endHm: string,
  tz?: string | null,
): boolean {
  const toM = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const m = zonedParts(now, tz).minutes,
    a = toM(startHm),
    b = toM(endHm);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}
