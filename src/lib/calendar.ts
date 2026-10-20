import { addDaysKey, localDayKey, localHm, zonedInstant, diffDaysKey } from "./tz";

/** V3 §66 calendar integration rules. Pure: no I/O. Providers and storage live in calendar.server.ts. */

export const CALENDAR_MODES = [
  "FREE_BUSY_ONLY",
  "READ_DETAILS",
  "WRITE_PLEXECUTE_BLOCKS",
  "READ_AND_WRITE",
] as const;
export type CalendarMode = (typeof CALENDAR_MODES)[number];
export type Provider = "google" | "microsoft" | "device";

export const MODE_LABEL: Record<CalendarMode, string> = {
  FREE_BUSY_ONLY: "Busy times only",
  READ_DETAILS: "Read event details",
  WRITE_PLEXECUTE_BLOCKS: "Add my Plexecute sessions",
  READ_AND_WRITE: "Busy times and add my sessions",
};

export const readsBusy = (m: CalendarMode) => m !== "WRITE_PLEXECUTE_BLOCKS";
export const readsDetails = (m: CalendarMode) => m === "READ_DETAILS";
/** Write is never implied by read (§66.1). */
export const writes = (m: CalendarMode) => m === "WRITE_PLEXECUTE_BLOCKS" || m === "READ_AND_WRITE";

/**
 * Minimum OAuth scopes per mode. Google writes only to a Plexecute-owned secondary calendar (calendar.app.created),
 * so writing never grants access to the user's own events. Microsoft Graph has no write-only scope.
 */
export function scopesFor(p: Exclude<Provider, "device">, m: CalendarMode): string[] {
  if (p === "google") {
    const g = "https://www.googleapis.com/auth/";
    const read =
      m === "FREE_BUSY_ONLY" || m === "READ_AND_WRITE"
        ? [`${g}calendar.freebusy`]
        : m === "READ_DETAILS"
          ? [`${g}calendar.events.readonly`]
          : [];
    return [...read, ...(writes(m) ? [`${g}calendar.app.created`] : [])];
  }
  const s =
    m === "FREE_BUSY_ONLY"
      ? "Calendars.ReadBasic"
      : m === "READ_DETAILS"
        ? "Calendars.Read"
        : "Calendars.ReadWrite";
  return ["offline_access", s];
}

export type BusyRow = {
  event_hash: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  busy: boolean;
  time_zone: string | null;
  title: string | null;
};
export type Normalised =
  { kind: "upsert"; row: BusyRow } | { kind: "delete"; event_hash: string } | { kind: "skip" };

/** Surrogate ID: provider IDs are hashed before storage (§66.2). */
export async function surrogate(...parts: string[]): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("|")));
  return Array.from(new Uint8Array(buf).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type GTime = { dateTime?: string; date?: string; timeZone?: string };
export type GoogleEvent = {
  id: string;
  status?: string;
  transparency?: string;
  summary?: string;
  start?: GTime;
  end?: GTime;
  extendedProperties?: { private?: Record<string, string> };
};

function allDayToInstant(date: string, tz: string | null) {
  return zonedInstant(date, 0, tz).toISOString();
}

export async function normaliseGoogle(
  e: GoogleEvent,
  m: CalendarMode,
  tz: string | null,
): Promise<Normalised> {
  const event_hash = await surrogate("google", e.id);
  if (e.status === "cancelled") return { kind: "delete", event_hash };
  if (e.extendedProperties?.private?.["plexecute_block"]) return { kind: "skip" }; // our own write-back is not a constraint
  if (!e.start || !e.end) return { kind: "skip" };
  const allDay = !!e.start.date;
  const starts_at = allDay
    ? allDayToInstant(e.start.date!, e.start.timeZone ?? tz)
    : new Date(e.start.dateTime!).toISOString();
  const ends_at = allDay
    ? allDayToInstant(e.end.date!, e.end.timeZone ?? tz)
    : new Date(e.end.dateTime!).toISOString();
  return {
    kind: "upsert",
    row: {
      event_hash,
      starts_at,
      ends_at,
      all_day: allDay,
      busy: e.transparency !== "transparent",
      time_zone: e.start.timeZone ?? tz,
      title: readsDetails(m) ? (e.summary ?? null) : null,
    },
  };
}

export type GraphEvent = {
  id: string;
  "@removed"?: unknown;
  isCancelled?: boolean;
  isAllDay?: boolean;
  showAs?: string;
  subject?: string;
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  singleValueExtendedProperties?: { id: string; value: string }[];
  categories?: string[];
};

/** Graph returns times in the zone requested via Prefer: outlook.timezone="UTC". */
export async function normaliseGraph(
  e: GraphEvent,
  m: CalendarMode,
  tz: string | null,
): Promise<Normalised> {
  const event_hash = await surrogate("microsoft", e.id);
  if (e["@removed"] || e.isCancelled) return { kind: "delete", event_hash };
  if (e.categories?.includes("Plexecute")) return { kind: "skip" };
  if (!e.start || !e.end) return { kind: "skip" };
  const iso = (s: string) => new Date(/Z|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`).toISOString();
  return {
    kind: "upsert",
    row: {
      event_hash,
      starts_at: iso(e.start.dateTime),
      ends_at: iso(e.end.dateTime),
      all_day: !!e.isAllDay,
      busy: !["free", "workingElsewhere"].includes(e.showAs ?? "busy"),
      time_zone: tz,
      title: readsDetails(m) ? (e.subject ?? null) : null,
    },
  };
}

/** Google freeBusy (FREE_BUSY_ONLY): the API returns only intervals, nothing else is ever fetched. */
export async function normaliseFreeBusy(
  calHash: string,
  busy: { start: string; end: string }[],
  tz: string | null,
): Promise<BusyRow[]> {
  return Promise.all(
    busy.map(async (b) => ({
      event_hash: await surrogate("fb", calHash, b.start, b.end),
      starts_at: new Date(b.start).toISOString(),
      ends_at: new Date(b.end).toISOString(),
      all_day: false,
      busy: true,
      time_zone: tz,
      title: null,
    })),
  );
}

export type Commitmentish = {
  recurrence: "once";
  days: number[];
  on_date: string;
  start_time: string;
  end_time: string;
  active: true;
};

/** Busy events → one-off planner commitments per local day (§66.2 hard by default; all-day only when the user chose so). */
export function busyToCommitments(
  rows: {
    starts_at: string;
    ends_at: string;
    all_day: boolean;
    busy: boolean;
    hard_all_day?: boolean | undefined;
  }[],
  tz: string | null,
): Commitmentish[] {
  const out: Commitmentish[] = [];
  for (const r of rows) {
    if (!r.busy || (r.all_day && !r.hard_all_day)) continue;
    const s = new Date(r.starts_at),
      e = new Date(r.ends_at);
    if (!(e > s)) continue;
    const sk = localDayKey(s, tz),
      ek = localDayKey(new Date(e.getTime() - 1), tz);
    const n = Math.min(diffDaysKey(ek, sk), 31);
    for (let i = 0; i <= n; i++) {
      const day = addDaysKey(sk, i);
      const start_time = i === 0 ? localHm(s, tz) : "00:00";
      const end_time = i === n ? (localDayKey(e, tz) === day ? localHm(e, tz) : "23:59") : "23:59";
      out.push({
        recurrence: "once",
        days: [],
        on_date: day,
        start_time,
        end_time: end_time === "00:00" ? "23:59" : end_time,
        active: true,
      });
    }
  }
  return out;
}

export type WBlock = {
  id: string;
  title: string;
  starts_at: string;
  duration_min: number;
  status: string;
};
export type WLink = {
  block_id: string;
  external_event_id: string | null;
  content_hash: string | null;
  state: string;
  external_starts_at?: string | null;
};
export type WriteAction = {
  op: "create" | "update" | "delete";
  block_id: string;
  key: string;
  hash: string;
  external_event_id?: string | null;
};

const GONE = new Set(["cancelled", "rescheduled", "skipped", "expired"]);
export const writeKey = (blockId: string) => `pxb:${blockId}`;
export const contentHash = (b: WBlock) =>
  `${b.title}|${new Date(b.starts_at).toISOString()}|${b.duration_min}`;

/**
 * Idempotent write-back plan (§66.3). Never recreates an event the user deleted in their calendar:
 * those links are left for the user to confirm.
 */
export function planWriteBack(blocks: WBlock[], links: WLink[], now: Date): WriteAction[] {
  const byBlock = new Map(links.map((l) => [l.block_id, l]));
  const live = new Map(blocks.map((b) => [b.id, b]));
  const out: WriteAction[] = [];
  for (const b of blocks) {
    if (new Date(b.starts_at).getTime() + b.duration_min * 60000 < now.getTime()) continue;
    const l = byBlock.get(b.id),
      h = contentHash(b);
    if (GONE.has(b.status)) {
      if (l?.external_event_id && l.state === "synced")
        out.push({
          op: "delete",
          block_id: b.id,
          key: writeKey(b.id),
          hash: h,
          external_event_id: l.external_event_id,
        });
      continue;
    }
    if (!l) out.push({ op: "create", block_id: b.id, key: writeKey(b.id), hash: h });
    else if (l.state === "synced" && l.content_hash !== h)
      out.push({
        op: "update",
        block_id: b.id,
        key: writeKey(b.id),
        hash: h,
        external_event_id: l.external_event_id,
      });
  }
  for (const l of links)
    if (!live.has(l.block_id) && l.state === "synced" && l.external_event_id)
      out.push({
        op: "delete",
        block_id: l.block_id,
        key: writeKey(l.block_id),
        hash: "",
        external_event_id: l.external_event_id,
      });
  return out;
}

/** Reconcile one of our written events against what the provider now holds. */
export function reconcileLink(
  link: WLink,
  block: WBlock | undefined,
  external: { starts_at: string } | null,
): "synced" | "deleted_externally" | "moved_externally" {
  if (!external) return "deleted_externally";
  if (
    block &&
    Math.abs(new Date(external.starts_at).getTime() - new Date(block.starts_at).getTime()) >= 60000
  )
    return "moved_externally";
  return "synced";
}

/** Planned sessions that now overlap a hard busy time (calendar changed after the plan was made). */
export function conflicts(
  blocks: WBlock[],
  busy: {
    starts_at: string;
    ends_at: string;
    busy: boolean;
    all_day: boolean;
    hard_all_day?: boolean;
  }[],
) {
  return blocks
    .filter((b) => !GONE.has(b.status) && !["done", "partial"].includes(b.status))
    .filter((b) => {
      const s = new Date(b.starts_at).getTime(),
        e = s + b.duration_min * 60000;
      return busy.some(
        (x) =>
          x.busy &&
          (!x.all_day || x.hard_all_day) &&
          new Date(x.starts_at).getTime() < e &&
          new Date(x.ends_at).getTime() > s,
      );
    });
}

export type Health = {
  status: "active" | "degraded" | "revoked";
  resync?: boolean;
  message: string;
};
/** Classifies provider failures into the degraded/revoked states shown to the user. */
export function classifyFailure(httpStatus: number, body = ""): Health {
  if (httpStatus === 410)
    return { status: "active", resync: true, message: "Calendar asked for a full refresh." };
  if (/invalid_grant|AADSTS700082|AADSTS50173|revoked/i.test(body) || httpStatus === 401)
    return {
      status: "revoked",
      message: "Access was removed or expired. Reconnect to keep busy times up to date.",
    };
  if (httpStatus === 403)
    return {
      status: "degraded",
      message: "The calendar refused this request. Permissions may have changed.",
    };
  return {
    status: "degraded",
    message:
      httpStatus === 429
        ? "The calendar is rate-limiting us; we'll retry."
        : "The calendar couldn't be reached; we'll retry.",
  };
}

/** Degraded data is still used, but the planner warns when busy times are older than this. */
export const STALE_AFTER_HOURS = 24;
export const isStale = (lastSync: string | null, now: Date) =>
  !lastSync || now.getTime() - new Date(lastSync).getTime() > STALE_AFTER_HOURS * 3600000;

/** Minimal ICS parser for device calendar exports: VEVENT UID/DTSTART/DTEND/TRANSP only (titles are not stored). */
export async function parseIcs(text: string, tz: string | null): Promise<BusyRow[]> {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out: BusyRow[] = [];
  let cur: Record<string, { v: string; tzid?: string | undefined; date?: boolean }> | null = null;
  const when = (x: { v: string; tzid?: string | undefined; date?: boolean }) => {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(x.v);
    if (!m) return null;
    const key = `${m[1]}-${m[2]}-${m[3]}`;
    if (!m[4]) return zonedInstant(key, 0, x.tzid ?? tz);
    if (m[7]) return new Date(`${key}T${m[4]}:${m[5]}:${m[6] ?? "00"}Z`);
    return zonedInstant(key, Number(m[4]) * 60 + Number(m[5]), x.tzid ?? tz);
  };
  for (const raw of lines) {
    if (raw === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (raw === "END:VEVENT" && cur) {
      const s = cur["DTSTART"] && when(cur["DTSTART"]),
        e = cur["DTEND"] ? when(cur["DTEND"]) : s;
      if (s && e && cur["STATUS"]?.v !== "CANCELLED") {
        const allDay = !!cur["DTSTART"]!.date;
        out.push({
          event_hash: await surrogate("device", cur["UID"]?.v ?? `${s.toISOString()}`),
          starts_at: s.toISOString(),
          ends_at: (allDay && e.getTime() === s.getTime()
            ? new Date(s.getTime() + 864e5)
            : e
          ).toISOString(),
          all_day: allDay,
          busy: cur["TRANSP"]?.v !== "TRANSPARENT",
          time_zone: cur["DTSTART"]!.tzid ?? tz,
          title: null,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const i = raw.indexOf(":");
    if (i < 0) continue;
    const [name, ...params] = raw.slice(0, i).split(";");
    const p = Object.fromEntries(params.map((x) => x.split("=") as [string, string]));
    cur[name!.toUpperCase()] = {
      v: raw.slice(i + 1).trim(),
      tzid: p["TZID"],
      date: p["VALUE"] === "DATE" || /^\d{8}$/.test(raw.slice(i + 1).trim()),
    };
  }
  return out;
}
