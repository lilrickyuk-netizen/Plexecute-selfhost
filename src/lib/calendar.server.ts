import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { env } from "./integrations.server";
import {
  classifyFailure,
  contentHash,
  normaliseFreeBusy,
  normaliseGoogle,
  normaliseGraph,
  planWriteBack,
  readsBusy,
  readsDetails,
  reconcileLink,
  scopesFor,
  surrogate,
  writes,
  type BusyRow,
  type CalendarMode,
  type GoogleEvent,
  type GraphEvent,
  type Normalised,
  type WBlock,
} from "./calendar";

/** V3 §66 provider plumbing (service role). Credentials only from env vars; tokens never leave the server. */
type Db = SupabaseClient<Database>;
type Cloud = "google" | "microsoft";
type Conn = Database["public"]["Tables"]["calendar_connections"]["Row"];
type Cred = Database["public"]["Tables"]["calendar_credentials"]["Row"];

const WINDOW_BACK_DAYS = 1,
  WINDOW_AHEAD_DAYS = 28;
const GRAPH = "https://graph.microsoft.com/v1.0";
const GCAL = "https://www.googleapis.com/calendar/v3";

export class ProviderError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`calendar provider ${status}`);
  }
}

export function providerConfig(p: Cloud) {
  const id = env(p === "google" ? "GOOGLE_CALENDAR_CLIENT_ID" : "MICROSOFT_CALENDAR_CLIENT_ID");
  const secret = env(
    p === "google" ? "GOOGLE_CALENDAR_CLIENT_SECRET" : "MICROSOFT_CALENDAR_CLIENT_SECRET",
  );
  const tenant = env("MICROSOFT_CALENDAR_TENANT") ?? "common";
  if (!id || !secret || !env("CALENDAR_STATE_SECRET")) return null;
  return p === "google"
    ? {
        id,
        secret,
        auth: "https://accounts.google.com/o/oauth2/v2/auth",
        token: "https://oauth2.googleapis.com/token",
      }
    : {
        id,
        secret,
        auth: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
        token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      };
}
export const redirectUri = (p: Cloud, origin: string) =>
  `${env("APP_BASE_URL") ?? origin}/api/public/calendar/oauth/${p}`;

async function hmac(msg: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env("CALENDAR_STATE_SECRET")!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return btoa(
    String.fromCharCode(
      ...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg))),
    ),
  ).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]!);
}
/** Signed, expiring OAuth state binding the callback to the user and chosen mode. */
export async function signState(s: { u: string; p: Cloud; m: CalendarMode }) {
  const body = btoa(JSON.stringify({ ...s, x: Date.now() + 15 * 60000, n: crypto.randomUUID() }));
  return `${body}.${await hmac(body)}`;
}
export async function verifyState(state: string) {
  const [body, sig] = state.split(".");
  if (!body || !sig || (await hmac(body)) !== sig) return null;
  const s = JSON.parse(atob(body)) as { u: string; p: Cloud; m: CalendarMode; x: number };
  return s.x > Date.now() ? s : null;
}

export async function authUrl(p: Cloud, mode: CalendarMode, userId: string, origin: string) {
  const c = providerConfig(p)!;
  const q = new URLSearchParams({
    client_id: c.id,
    redirect_uri: redirectUri(p, origin),
    response_type: "code",
    scope: scopesFor(p, mode).join(" "),
    state: await signState({ u: userId, p, m: mode }),
  });
  if (p === "google") {
    q.set("access_type", "offline");
    q.set("prompt", "consent");
    q.set("include_granted_scopes", "false");
  } else q.set("prompt", "select_account");
  return `${c.auth}?${q}`;
}

async function tokenCall(p: Cloud, params: Record<string, string>) {
  const c = providerConfig(p)!;
  (await import("./security")).assertAllowedOutbound(c.token);
  const res = await fetch(c.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...params }),
  });
  const text = await res.text();
  if (!res.ok) throw new ProviderError(res.status, text);
  return JSON.parse(text) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
}

/** OAuth callback: stores tokens server-side and starts the first sync. */
export async function completeConnect(
  db: Db,
  p: Cloud,
  code: string,
  state: { u: string; m: CalendarMode },
  origin: string,
) {
  const t = await tokenCall(p, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(p, origin),
  });
  await db
    .from("calendar_connections")
    .update({ status: "disconnected" })
    .eq("user_id", state.u)
    .eq("provider", p)
    .neq("status", "disconnected");
  const { data: conn, error } = await db
    .from("calendar_connections")
    .insert({
      user_id: state.u,
      provider: p,
      mode: state.m,
      status: "active",
      calendar_id_hash: await surrogate(p, state.u, "primary"),
    })
    .select("*")
    .single();
  if (error || !conn) throw new Error("CALENDAR_CONNECT_SAVE_FAILED");
  await (
    await import("./consent.server")
  ).recordConsent(db, {
    userId: state.u,
    purpose: "calendar_access",
    granted: true,
    scope: [state.m],
    provider: p,
    subjectId: conn.id,
  });
  await db.from("calendar_credentials").insert({
    connection_id: conn.id,
    user_id: state.u,
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? null,
    expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
    scopes: (t.scope ?? scopesFor(p, state.m).join(" ")).split(" "),
    webhook_secret: crypto.randomUUID(),
  });
  await syncConnection(db, conn.id, origin).catch(() => {});
  return conn.id;
}

async function token(db: Db, conn: Conn, cred: Cred): Promise<string> {
  if (cred.access_token && cred.expires_at && new Date(cred.expires_at) > new Date())
    return cred.access_token;
  if (!cred.refresh_token) throw new ProviderError(401, "no refresh token");
  const t = await tokenCall(conn.provider as Cloud, {
    grant_type: "refresh_token",
    refresh_token: cred.refresh_token,
  });
  await db
    .from("calendar_credentials")
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? cred.refresh_token,
      expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
    })
    .eq("connection_id", conn.id);
  return t.access_token;
}

async function api<T>(tok: string, url: string, init: RequestInit = {}): Promise<T> {
  (await import("./security")).assertAllowedOutbound(url);
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${tok}`,
      "Content-Type": "application/json",
      Prefer: 'outlook.timezone="UTC"',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new ProviderError(res.status, text);
  return (text ? JSON.parse(text) : {}) as T;
}

async function applyBusy(db: Db, conn: Conn, ops: Normalised[]) {
  const up = ops
    .filter((o): o is { kind: "upsert"; row: BusyRow } => o.kind === "upsert")
    .map((o) => ({
      ...o.row,
      user_id: conn.user_id,
      connection_id: conn.id,
      calendar_id_hash: conn.calendar_id_hash,
    }));
  const del = ops
    .filter((o): o is { kind: "delete"; event_hash: string } => o.kind === "delete")
    .map((o) => o.event_hash);
  for (let i = 0; i < up.length; i += 200)
    await db
      .from("calendar_busy")
      .upsert(up.slice(i, i + 200), { onConflict: "connection_id,event_hash" });
  if (del.length)
    await db.from("calendar_busy").delete().eq("connection_id", conn.id).in("event_hash", del);
}
/** Interval-only sources are replaced wholesale inside the window, so re-running is idempotent. */
async function replaceWindow(db: Db, conn: Conn, rows: BusyRow[], from: Date, to: Date) {
  await db
    .from("calendar_busy")
    .delete()
    .eq("connection_id", conn.id)
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString());
  await applyBusy(
    db,
    conn,
    rows.map((row) => ({ kind: "upsert", row })),
  );
}

async function readBusy(db: Db, conn: Conn, cred: Cred, tok: string, tz: string | null) {
  const mode = conn.mode as CalendarMode,
    now = Date.now();
  const from = new Date(now - WINDOW_BACK_DAYS * 864e5),
    to = new Date(now + WINDOW_AHEAD_DAYS * 864e5);
  if (conn.provider === "google" && !readsDetails(mode)) {
    const r = await api<{ calendars: Record<string, { busy: { start: string; end: string }[] }> }>(
      tok,
      `${GCAL}/freeBusy`,
      {
        method: "POST",
        body: JSON.stringify({
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          items: [{ id: "primary" }],
        }),
      },
    );
    return replaceWindow(
      db,
      conn,
      await normaliseFreeBusy(conn.calendar_id_hash ?? "", r.calendars["primary"]?.busy ?? [], tz),
      from,
      to,
    );
  }
  if (conn.provider === "microsoft" && mode === "FREE_BUSY_ONLY") {
    const me = await api<{ mail?: string; userPrincipalName: string }>(
      tok,
      `${GRAPH}/me?$select=mail,userPrincipalName`,
    );
    const r = await api<{
      value: {
        scheduleItems: { start: { dateTime: string }; end: { dateTime: string }; status: string }[];
      }[];
    }>(tok, `${GRAPH}/me/calendar/getSchedule`, {
      method: "POST",
      body: JSON.stringify({
        schedules: [me.mail ?? me.userPrincipalName],
        startTime: { dateTime: from.toISOString().slice(0, 19), timeZone: "UTC" },
        endTime: { dateTime: to.toISOString().slice(0, 19), timeZone: "UTC" },
      }),
    });
    const items = (r.value[0]?.scheduleItems ?? [])
      .filter((s) => s.status !== "free")
      .map((s) => ({ start: `${s.start.dateTime}Z`, end: `${s.end.dateTime}Z` }));
    return replaceWindow(
      db,
      conn,
      await normaliseFreeBusy(conn.calendar_id_hash ?? "", items, tz),
      from,
      to,
    );
  }
  if (conn.provider === "google") {
    let cursor = cred.sync_cursor,
      page: string | undefined,
      next: string | undefined;
    do {
      const q = new URLSearchParams({
        singleEvents: "true",
        maxResults: "250",
        showDeleted: "true",
      });
      if (cursor) q.set("syncToken", cursor);
      else {
        q.set("timeMin", from.toISOString());
        q.set("timeMax", to.toISOString());
      }
      if (page) q.set("pageToken", page);
      let r: { items: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };
      try {
        r = await api(tok, `${GCAL}/calendars/primary/events?${q}`);
      } catch (e) {
        if (e instanceof ProviderError && e.status === 410 && cursor) {
          cursor = null;
          page = undefined;
          await db.from("calendar_busy").delete().eq("connection_id", conn.id);
          continue;
        }
        throw e;
      }
      await applyBusy(
        db,
        conn,
        await Promise.all(r.items.map((ev) => normaliseGoogle(ev, mode, tz))),
      );
      page = r.nextPageToken;
      next = r.nextSyncToken;
    } while (page);
    if (next)
      await db
        .from("calendar_credentials")
        .update({ sync_cursor: next })
        .eq("connection_id", conn.id);
    return;
  }
  let url: string | undefined =
      cred.sync_cursor ??
      `${GRAPH}/me/calendarView/delta?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}`,
    delta: string | undefined;
  while (url) {
    let r: { value: GraphEvent[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
    try {
      r = await api(tok, url, {
        headers: { Prefer: 'outlook.timezone="UTC", odata.maxpagesize=200' },
      });
    } catch (e) {
      if (e instanceof ProviderError && e.status === 410 && cred.sync_cursor) {
        cred.sync_cursor = null;
        url = `${GRAPH}/me/calendarView/delta?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}`;
        await db.from("calendar_busy").delete().eq("connection_id", conn.id);
        continue;
      }
      throw e;
    }
    await applyBusy(db, conn, await Promise.all(r.value.map((ev) => normaliseGraph(ev, mode, tz))));
    url = r["@odata.nextLink"];
    delta = r["@odata.deltaLink"] ?? delta;
  }
  if (delta)
    await db
      .from("calendar_credentials")
      .update({ sync_cursor: delta })
      .eq("connection_id", conn.id);
}

async function ensureWriteCalendar(db: Db, conn: Conn, tok: string, tz: string | null) {
  if (conn.write_calendar_id) return conn.write_calendar_id;
  const id =
    conn.provider === "google"
      ? (
          await api<{ id: string }>(tok, `${GCAL}/calendars`, {
            method: "POST",
            body: JSON.stringify({ summary: "Plexecute", timeZone: tz ?? "UTC" }),
          })
        ).id
      : "default";
  await db.from("calendar_connections").update({ write_calendar_id: id }).eq("id", conn.id);
  return id;
}

/** Minimum approved content: title and time only, plus our private marker (§66.3). */
function eventBody(p: Cloud, b: WBlock, key: string) {
  const s = new Date(b.starts_at),
    e = new Date(s.getTime() + b.duration_min * 60000);
  return p === "google"
    ? {
        summary: b.title,
        start: { dateTime: s.toISOString() },
        end: { dateTime: e.toISOString() },
        extendedProperties: { private: { plexecute_block: b.id } },
        reminders: { useDefault: false },
      }
    : {
        subject: b.title,
        start: { dateTime: s.toISOString().slice(0, 19), timeZone: "UTC" },
        end: { dateTime: e.toISOString().slice(0, 19), timeZone: "UTC" },
        categories: ["Plexecute"],
        transactionId: key,
        isReminderOn: false,
      };
}

async function writeBack(db: Db, conn: Conn, tok: string, tz: string | null) {
  const p = conn.provider as Cloud,
    cal = await ensureWriteCalendar(db, conn, tok, tz);
  const now = new Date();
  const [{ data: blocks }, { data: links }] = await Promise.all([
    db
      .from("plan_blocks")
      .select("id,title,starts_at,duration_min,status")
      .eq("user_id", conn.user_id)
      .gte("starts_at", new Date(now.getTime() - 864e5).toISOString())
      .lte("starts_at", new Date(now.getTime() + WINDOW_AHEAD_DAYS * 864e5).toISOString())
      .limit(500),
    db
      .from("calendar_event_links")
      .select("block_id,external_event_id,content_hash,state,external_starts_at")
      .eq("connection_id", conn.id),
  ]);
  const bmap = new Map((blocks ?? []).map((b) => [b.id, b]));
  // Reconcile first: user edits in their calendar win and are never overwritten or recreated.
  for (const l of (links ?? [])
    .filter((x) => x.state === "synced" && x.external_event_id)
    .slice(0, 60)) {
    let ext: { starts_at: string } | null = null;
    try {
      if (p === "google") {
        const g = await api<GoogleEvent>(
          tok,
          `${GCAL}/calendars/${encodeURIComponent(cal)}/events/${l.external_event_id}`,
        );
        ext =
          g.status === "cancelled"
            ? null
            : { starts_at: new Date(g.start!.dateTime!).toISOString() };
      } else {
        const g = await api<GraphEvent>(
          tok,
          `${GRAPH}/me/events/${l.external_event_id}?$select=start,isCancelled`,
        );
        ext = g.isCancelled ? null : { starts_at: new Date(`${g.start!.dateTime}Z`).toISOString() };
      }
    } catch (e) {
      if (!(e instanceof ProviderError && (e.status === 404 || e.status === 410))) throw e;
    }
    const st = reconcileLink(l, bmap.get(l.block_id), ext);
    if (st !== "synced") {
      l.state = st;
      await db
        .from("calendar_event_links")
        .update({ state: st, external_starts_at: ext?.starts_at ?? null })
        .eq("connection_id", conn.id)
        .eq("block_id", l.block_id);
    }
  }
  for (const a of planWriteBack(blocks ?? [], links ?? [], now)) {
    const b = bmap.get(a.block_id);
    if (a.op === "delete") {
      try {
        await api(
          tok,
          p === "google"
            ? `${GCAL}/calendars/${encodeURIComponent(cal)}/events/${a.external_event_id}`
            : `${GRAPH}/me/events/${a.external_event_id}`,
          { method: "DELETE" },
        );
      } catch (e) {
        if (!(e instanceof ProviderError && [404, 410].includes(e.status))) throw e;
      }
      await db
        .from("calendar_event_links")
        .update({ state: "removed" })
        .eq("connection_id", conn.id)
        .eq("block_id", a.block_id);
      continue;
    }
    if (!b) continue;
    let extId = a.external_event_id ?? null;
    if (a.op === "create") {
      if (p === "google") {
        const gid = b.id.replace(/-/g, ""); // deterministic id: a retried insert returns 409 instead of duplicating
        try {
          extId = (
            await api<{ id: string }>(tok, `${GCAL}/calendars/${encodeURIComponent(cal)}/events`, {
              method: "POST",
              body: JSON.stringify({ id: gid, ...eventBody(p, b, a.key) }),
            })
          ).id;
        } catch (e) {
          if (e instanceof ProviderError && e.status === 409) {
            extId = gid;
            await api(tok, `${GCAL}/calendars/${encodeURIComponent(cal)}/events/${gid}`, {
              method: "PATCH",
              body: JSON.stringify(eventBody(p, b, a.key)),
            });
          } else throw e;
        }
      } else
        extId = (
          await api<{ id: string }>(tok, `${GRAPH}/me/events`, {
            method: "POST",
            body: JSON.stringify(eventBody(p, b, a.key)),
          })
        ).id; // transactionId makes retries idempotent
    } else {
      await api(
        tok,
        p === "google"
          ? `${GCAL}/calendars/${encodeURIComponent(cal)}/events/${extId}`
          : `${GRAPH}/me/events/${extId}`,
        { method: "PATCH", body: JSON.stringify(eventBody(p, b, a.key)) },
      );
    }
    await db.from("calendar_event_links").upsert(
      {
        user_id: conn.user_id,
        connection_id: conn.id,
        block_id: b.id,
        external_event_id: extId,
        idempotency_key: a.key,
        content_hash: contentHash(b),
        state: "synced",
        external_starts_at: new Date(b.starts_at).toISOString(),
      },
      { onConflict: "connection_id,idempotency_key" },
    );
  }
}

/** Change notifications where the provider supports them (Google events.watch, Graph subscriptions). Renewed by cron. */
async function ensureWatch(db: Db, conn: Conn, cred: Cred, tok: string, origin: string) {
  const mode = conn.mode as CalendarMode;
  const base = env("APP_BASE_URL") ?? origin;
  if (!base.startsWith("https://")) return; // providers only deliver to public https endpoints
  if (
    cred.channel_expires_at &&
    new Date(cred.channel_expires_at).getTime() - Date.now() > 12 * 3600000
  )
    return;
  if (conn.provider === "google" && readsDetails(mode)) {
    const id = crypto.randomUUID();
    const r = await api<{ resourceId: string; expiration: string }>(
      tok,
      `${GCAL}/calendars/primary/events/watch`,
      {
        method: "POST",
        body: JSON.stringify({
          id,
          type: "web_hook",
          address: `${base}/api/public/calendar/webhook/google`,
          token: cred.webhook_secret,
        }),
      },
    );
    await db
      .from("calendar_credentials")
      .update({
        channel_id: id,
        channel_resource: r.resourceId,
        channel_expires_at: new Date(Number(r.expiration)).toISOString(),
      })
      .eq("connection_id", conn.id);
  } else if (conn.provider === "microsoft" && mode !== "FREE_BUSY_ONLY" && readsBusy(mode)) {
    const expirationDateTime = new Date(Date.now() + 2.5 * 864e5).toISOString();
    if (cred.channel_id) {
      try {
        await api(tok, `${GRAPH}/subscriptions/${cred.channel_id}`, {
          method: "PATCH",
          body: JSON.stringify({ expirationDateTime }),
        });
        await db
          .from("calendar_credentials")
          .update({ channel_expires_at: expirationDateTime })
          .eq("connection_id", conn.id);
        return;
      } catch {
        /* recreate */
      }
    }
    const r = await api<{ id: string }>(tok, `${GRAPH}/subscriptions`, {
      method: "POST",
      body: JSON.stringify({
        changeType: "created,updated,deleted",
        notificationUrl: `${base}/api/public/calendar/webhook/microsoft`,
        resource: "me/events",
        expirationDateTime,
        clientState: cred.webhook_secret,
      }),
    });
    await db
      .from("calendar_credentials")
      .update({ channel_id: r.id, channel_expires_at: expirationDateTime })
      .eq("connection_id", conn.id);
  }
}

/** Full sync for one connection; failures move it to degraded/revoked instead of throwing at the user. */
export async function syncConnection(db: Db, connectionId: string, origin: string) {
  const { data: conn } = await db
    .from("calendar_connections")
    .select("*")
    .eq("id", connectionId)
    .maybeSingle();
  if (
    !conn ||
    conn.status === "disconnected" ||
    conn.status === "revoked" ||
    conn.provider === "device"
  )
    return conn?.status ?? "missing";
  const { data: cred } = await db
    .from("calendar_credentials")
    .select("*")
    .eq("connection_id", conn.id)
    .maybeSingle();
  if (!cred || !providerConfig(conn.provider as Cloud)) return "not_configured";
  if (!(await (await import("./flags.server")).flagOn("calendar_sync"))) return "paused";
  const { data: prof } = await db
    .from("profiles")
    .select("timezone")
    .eq("id", conn.user_id)
    .maybeSingle();
  const tz = prof?.timezone ?? null;
  try {
    const tok = await token(db, conn, cred);
    if (readsBusy(conn.mode as CalendarMode)) await readBusy(db, conn, cred, tok, tz);
    if (writes(conn.mode as CalendarMode)) await writeBack(db, conn, tok, tz);
    await ensureWatch(db, conn, cred, tok, origin).catch((e) => console.error("calendar watch", e));
    await db
      .from("calendar_connections")
      .update({
        status: "active",
        last_sync_at: new Date().toISOString(),
        last_error: null,
        error_count: 0,
      })
      .eq("id", conn.id);
    return "active";
  } catch (e) {
    const h =
      e instanceof ProviderError
        ? classifyFailure(e.status, e.body)
        : { status: "degraded" as const, message: "Sync failed; we'll retry." };
    console.error("calendar sync", conn.id, e instanceof ProviderError ? e.status : e);
    await db
      .from("calendar_connections")
      .update({ status: h.status, last_error: h.message, error_count: conn.error_count + 1 })
      .eq("id", conn.id);
    return h.status;
  }
}

/** Disconnect: revoke at the provider where possible, stop notifications, then remove tokens and imported busy times. */
export async function disconnect(db: Db, connectionId: string) {
  const { data: conn } = await db
    .from("calendar_connections")
    .select("*")
    .eq("id", connectionId)
    .maybeSingle();
  if (!conn) return;
  await (
    await import("./consent.server")
  ).recordConsent(db, {
    userId: conn.user_id,
    purpose: "calendar_access",
    granted: false,
    provider: conn.provider,
    subjectId: conn.id,
  });
  const { data: cred } = await db
    .from("calendar_credentials")
    .select("*")
    .eq("connection_id", conn.id)
    .maybeSingle();
  if (cred && conn.provider !== "device" && providerConfig(conn.provider as Cloud)) {
    try {
      if (conn.provider === "google") {
        if (cred.channel_id && cred.access_token)
          await fetch(`${GCAL}/channels/stop`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${cred.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ id: cred.channel_id, resourceId: cred.channel_resource }),
          });
        const t = cred.refresh_token ?? cred.access_token;
        if (t)
          await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, {
            method: "POST",
          });
      } else if (cred.channel_id && cred.access_token)
        await fetch(`${GRAPH}/subscriptions/${cred.channel_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${cred.access_token}` },
        });
    } catch (e) {
      console.error("calendar revoke", e);
    }
  }
  await db.from("calendar_credentials").delete().eq("connection_id", conn.id);
  await db.from("calendar_busy").delete().eq("connection_id", conn.id);
  await db
    .from("calendar_connections")
    .update({ status: "disconnected", last_error: null })
    .eq("id", conn.id);
}

export async function connectionForWebhook(
  db: Db,
  by: { channelId?: string; secret: string; subscriptionId?: string },
) {
  const q = db.from("calendar_credentials").select("connection_id,webhook_secret,channel_id");
  const { data } = await q.eq("channel_id", (by.channelId ?? by.subscriptionId)!).maybeSingle();
  return data && data.webhook_secret === by.secret ? data.connection_id : null;
}
