import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { env } from "./integrations.server";
import {
  ADAPTERS,
  classifyFailure,
  mapFitbit,
  mapGarmin,
  mapOura,
  mapStrava,
  mapWhoop,
  type Wearable,
} from "./wearables";
import type { IncomingSample } from "./health";

/** V3 §67.2 wearable plumbing (service role). Credentials only from env vars; tokens never leave the server. */
type Db = SupabaseClient<Database>;
export class ProviderError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`wearable provider ${status}`);
  }
}

const stateSecret = () => env("WEARABLE_STATE_SECRET") ?? env("CALENDAR_STATE_SECRET");
export function wearableConfig(p: Wearable) {
  const a = ADAPTERS[p],
    id = env(a.envId),
    secret = env(a.envSecret);
  return id && secret && stateSecret() ? { id, secret } : null;
}
export const redirectUri = (p: Wearable, origin: string) =>
  `${env("APP_BASE_URL") ?? origin}/api/public/wearables/oauth/${p}`;

const b64u = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]!);
async function hmac(msg: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(stateSecret()!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg))));
}
export async function signState(s: { u: string; p: Wearable; c: string }) {
  const body = btoa(JSON.stringify({ ...s, x: Date.now() + 15 * 60000 }));
  return `${body}.${await hmac(body)}`;
}
export async function verifyState(state: string) {
  const [body, sig] = state.split(".");
  if (!body || !sig || (await hmac(body)) !== sig) return null;
  const s = JSON.parse(atob(body)) as { u: string; p: Wearable; c: string; x: number };
  return s.x > Date.now() ? s : null;
}

/** Creates a pending connection (holding the PKCE verifier server-side) and returns the provider consent URL. */
export async function authUrl(db: Db, p: Wearable, userId: string, origin: string) {
  const a = ADAPTERS[p],
    c = wearableConfig(p)!;
  await db
    .from("wearable_connections")
    .delete()
    .eq("user_id", userId)
    .eq("provider", p)
    .eq("status", "pending");
  const { data: conn } = await db
    .from("wearable_connections")
    .update({ status: "disconnected" })
    .eq("user_id", userId)
    .eq("provider", p)
    .in("status", ["revoked"])
    .select("id");
  void conn;
  const { data: row, error } = await db
    .from("wearable_connections")
    .insert({ user_id: userId, provider: p, status: "pending", scopes: a.scopes })
    .select("id")
    .single();
  if (error || !row)
    throw new Error(
      error?.message.includes("wearable_connections_one_live")
        ? "Disconnect the existing connection first."
        : "Couldn't start the connection.",
    );
  const q = new URLSearchParams({
    client_id: c.id,
    redirect_uri: redirectUri(p, origin),
    response_type: "code",
    state: await signState({ u: userId, p, c: row.id }),
  });
  if (a.scopes.length) q.set("scope", a.scopes.join(a.scopeSep));
  if (p === "strava") q.set("approval_prompt", "auto");
  if (a.pkce) {
    const verifier = b64u(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64u(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
    );
    await db
      .from("wearable_credentials")
      .insert({ connection_id: row.id, user_id: userId, pkce_verifier: verifier });
    q.set("code_challenge", challenge);
    q.set("code_challenge_method", "S256");
  }
  return `${a.auth}?${q}`;
}

type Tok = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  user_id?: string | number;
  athlete?: { id: number };
  scope?: string;
};
async function tokenCall(p: Wearable, params: Record<string, string>): Promise<Tok> {
  const a = ADAPTERS[p],
    c = wearableConfig(p)!;
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  const body = new URLSearchParams(params);
  if (a.tokenAuth === "basic") headers["Authorization"] = `Basic ${btoa(`${c.id}:${c.secret}`)}`;
  else {
    body.set("client_id", c.id);
    body.set("client_secret", c.secret);
  }
  (await import("./security")).assertAllowedOutbound(a.token);
  const res = await fetch(a.token, { method: "POST", headers, body });
  const text = await res.text();
  if (!res.ok) throw new ProviderError(res.status, text);
  return JSON.parse(text) as Tok;
}
const expiry = (t: Tok) =>
  new Date(
    t.expires_at ? t.expires_at * 1000 : Date.now() + (t.expires_in ?? 3600) * 1000,
  ).toISOString();

async function api(token: string, url: string, init: RequestInit = {}) {
  (await import("./security")).assertAllowedOutbound(url);
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new ProviderError(res.status, text);
  return text ? JSON.parse(text) : null;
}

export async function completeConnect(
  db: Db,
  p: Wearable,
  code: string,
  state: { u: string; c: string },
  origin: string,
) {
  const { data: cred } = await db
    .from("wearable_credentials")
    .select("pkce_verifier")
    .eq("connection_id", state.c)
    .maybeSingle();
  const params: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(p, origin),
  };
  if (ADAPTERS[p].pkce) {
    if (!cred?.pkce_verifier) throw new Error("missing verifier");
    params["code_verifier"] = cred.pkce_verifier;
  }
  const t = await tokenCall(p, params);
  let ext: string | null =
    t.athlete?.id != null ? String(t.athlete.id) : t.user_id != null ? String(t.user_id) : null;
  if (!ext) {
    try {
      if (p === "whoop")
        ext = String(
          (await api(t.access_token, "https://api.prod.whoop.com/developer/v2/user/profile/basic"))
            .user_id,
        );
      if (p === "oura")
        ext = String(
          (await api(t.access_token, "https://api.ouraring.com/v2/usercollection/personal_info"))
            .id,
        );
      if (p === "garmin")
        ext = String(
          (await api(t.access_token, "https://apis.garmin.com/wellness-api/rest/user/id")).userId,
        );
    } catch (e) {
      console.error("wearable user id", p, e);
    }
  }
  await db.from("wearable_credentials").upsert({
    connection_id: state.c,
    user_id: state.u,
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? null,
    expires_at: expiry(t),
    pkce_verifier: null,
  });
  await db
    .from("wearable_connections")
    .update({
      status: "active",
      external_user_id: ext,
      scopes: t.scope ? t.scope.split(/[ ,]/) : ADAPTERS[p].scopes,
      last_error: null,
      error_count: 0,
    })
    .eq("id", state.c)
    .eq("user_id", state.u);
  await db.from("audit_events").insert({
    user_id: state.u,
    action: "wearable.connect",
    actor_type: "user",
    resource_type: "wearable_connection",
    resource_id: state.c,
    outcome: "succeeded",
    metadata: { provider: p },
  });
  await (
    await import("./consent.server")
  ).recordConsent(db, {
    userId: state.u,
    purpose: "wearable_data",
    granted: true,
    scope: t.scope ? t.scope.split(/[ ,]/) : ADAPTERS[p].scopes,
    provider: p,
    subjectId: state.c,
  });
  await syncWearable(db, state.c);
}

async function accessToken(db: Db, p: Wearable, connectionId: string) {
  const { data: c } = await db
    .from("wearable_credentials")
    .select("access_token,refresh_token,expires_at")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (!c?.access_token) throw new ProviderError(401, "no token");
  if (c.expires_at && new Date(c.expires_at).getTime() > Date.now() + 120000) return c.access_token;
  if (!c.refresh_token) throw new ProviderError(401, "invalid_grant: no refresh token");
  const t = await tokenCall(p, { grant_type: "refresh_token", refresh_token: c.refresh_token });
  // Providers that rotate refresh tokens (WHOOP, Fitbit, Strava, Garmin) return a new one; keep the old one only when none is sent.
  await db
    .from("wearable_credentials")
    .update({
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? c.refresh_token,
      expires_at: expiry(t),
    })
    .eq("connection_id", connectionId);
  return t.access_token;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
async function fetchSamples(
  p: Wearable,
  tok: string,
  since: Date,
  now: Date,
): Promise<IncomingSample[]> {
  const s = since.toISOString(),
    e = now.toISOString();
  if (p === "whoop") {
    const W = "https://api.prod.whoop.com/developer/v2";
    const q = `?start=${encodeURIComponent(s)}&end=${encodeURIComponent(e)}&limit=25`;
    const [sleep, recovery, workout] = await Promise.all([
      api(tok, `${W}/activity/sleep${q}`),
      api(tok, `${W}/recovery${q}`),
      api(tok, `${W}/activity/workout${q}`),
    ]);
    return mapWhoop({ sleep: sleep.records, recovery: recovery.records, workout: workout.records });
  }
  if (p === "oura") {
    const O = "https://api.ouraring.com/v2/usercollection",
      q = `?start_date=${day(since)}&end_date=${day(now)}`;
    const [a, sl, w] = await Promise.all([
      api(tok, `${O}/daily_activity${q}`),
      api(tok, `${O}/sleep${q}`),
      api(tok, `${O}/workout${q}`),
    ]);
    return mapOura({ daily_activity: a.data, sleep: sl.data, workout: w.data });
  }
  if (p === "fitbit") {
    const F = "https://api.fitbit.com",
      r = `${day(since)}/${day(now)}`;
    const [st, sl, h, w, ac] = await Promise.all([
      api(tok, `${F}/1/user/-/activities/steps/date/${r}.json`),
      api(tok, `${F}/1.2/user/-/sleep/date/${r}.json`),
      api(tok, `${F}/1/user/-/activities/heart/date/${r}.json`),
      api(tok, `${F}/1/user/-/body/log/weight/date/${r}.json`),
      api(
        tok,
        `${F}/1/user/-/activities/list.json?afterDate=${day(since)}&sort=asc&offset=0&limit=100`,
      ),
    ]);
    return mapFitbit({
      steps: st["activities-steps"],
      sleep: sl.sleep,
      heart: h["activities-heart"],
      weight: w.weight,
      activities: ac.activities,
    });
  }
  if (p === "strava") {
    const acts = await api(
      tok,
      `https://www.strava.com/api/v3/athlete/activities?after=${Math.floor(since.getTime() / 1000)}&per_page=100`,
    );
    return mapStrava(acts);
  }
  // Garmin pull: 24-hour upload windows; limited to the last 3 days per run to respect rate limits.
  const G = "https://apis.garmin.com/wellness-api/rest",
    out: IncomingSample[] = [];
  const start = Math.max(since.getTime(), now.getTime() - 3 * 864e5);
  for (let t = start; t < now.getTime(); t += 864e5) {
    const q = `?uploadStartTimeInSeconds=${Math.floor(t / 1000)}&uploadEndTimeInSeconds=${Math.floor(Math.min(t + 864e5, now.getTime()) / 1000)}`;
    const [d, sl, a] = await Promise.all([
      api(tok, `${G}/dailies${q}`),
      api(tok, `${G}/sleeps${q}`),
      api(tok, `${G}/activities${q}`),
    ]);
    out.push(...mapGarmin({ dailies: d, sleeps: sl, activities: a }));
  }
  return out;
}

/** Idempotent sync: re-reads a window and lets the canonical store dedupe. Failures become degraded/revoked, never thrown. */
export async function syncWearable(
  db: Db,
  connectionId: string,
): Promise<"ok" | "degraded" | "revoked" | "skipped"> {
  const { data: c } = await db
    .from("wearable_connections")
    .select("id,user_id,provider,status,last_sync_at,error_count")
    .eq("id", connectionId)
    .maybeSingle();
  if (!c || !["active", "degraded"].includes(c.status)) return "skipped";
  const p = c.provider as Wearable;
  if (!wearableConfig(p)) return "skipped";
  if (!(await (await import("./flags.server")).flagOn("wearable_sync"))) return "skipped";
  const now = new Date(),
    since = new Date(
      Math.min(
        now.getTime() - 2 * 864e5,
        c.last_sync_at ? new Date(c.last_sync_at).getTime() - 864e5 : now.getTime() - 14 * 864e5,
      ),
    );
  try {
    const tok = await accessToken(db, p, c.id);
    const samples = (await fetchSamples(p, tok, since, now)).map((s) => ({
      ...s,
      source_device: ADAPTERS[p].name,
    }));
    const { storeHealthSamples } = await import("./health.server");
    await storeHealthSamples(db, c.user_id, p, samples);
    await db
      .from("wearable_connections")
      .update({
        status: "active",
        last_sync_at: now.toISOString(),
        last_error: null,
        error_count: 0,
      })
      .eq("id", c.id);
    return "ok";
  } catch (e) {
    const status = e instanceof ProviderError ? e.status : 0,
      body = e instanceof ProviderError ? e.body : String(e);
    const kind = status ? classifyFailure(status, body) : "degraded";
    console.error(`wearable sync ${p} [${status}]`, body.slice(0, 300));
    await db
      .from("wearable_connections")
      .update({
        status: kind,
        error_count: (c.error_count ?? 0) + 1,
        last_error:
          kind === "revoked"
            ? "Access was removed or expired. Reconnect to continue."
            : status === 429
              ? "The service asked us to slow down. Retrying later."
              : "Couldn't reach the service. Retrying later.",
      })
      .eq("id", c.id);
    return kind;
  }
}

/** Revocation: cancel access at the provider where it offers a way, then delete tokens. Readings are kept unless the user deletes them. */
export async function disconnectWearable(db: Db, connectionId: string, deleteData: boolean) {
  const { data: c } = await db
    .from("wearable_connections")
    .select("id,user_id,provider")
    .eq("id", connectionId)
    .maybeSingle();
  if (!c) return;
  const p = c.provider as Wearable;
  await (
    await import("./consent.server")
  ).recordConsent(db, {
    userId: c.user_id,
    purpose: "wearable_data",
    granted: false,
    provider: p,
    subjectId: c.id,
    metadata: { deleteData },
  });
  const { data: cred } = await db
    .from("wearable_credentials")
    .select("access_token,refresh_token")
    .eq("connection_id", c.id)
    .maybeSingle();
  if (cred?.access_token && wearableConfig(p)) {
    const cfg = wearableConfig(p)!,
      tok = cred.access_token;
    try {
      if (p === "strava")
        await fetch("https://www.strava.com/oauth/deauthorize", {
          method: "POST",
          headers: { Authorization: `Bearer ${tok}` },
        });
      if (p === "fitbit")
        await fetch("https://api.fitbit.com/oauth2/revoke", {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${cfg.id}:${cfg.secret}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ token: cred.refresh_token ?? tok }),
        });
      if (p === "oura")
        await fetch(
          `https://api.ouraring.com/oauth/revoke?access_token=${encodeURIComponent(tok)}`,
        );
      if (p === "whoop")
        await fetch("https://api.prod.whoop.com/developer/v2/user/access", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${tok}` },
        });
      if (p === "garmin")
        await fetch("https://apis.garmin.com/wellness-api/rest/user/registration", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${tok}` },
        });
    } catch (e) {
      console.error("wearable revoke", p, e);
    }
  }
  await db.from("wearable_credentials").delete().eq("connection_id", c.id);
  await db
    .from("wearable_connections")
    .update({ status: "disconnected", last_error: null })
    .eq("id", c.id);
  let deleted = 0;
  if (deleteData)
    deleted =
      (
        await db
          .from("health_samples")
          .delete({ count: "exact" })
          .eq("user_id", c.user_id)
          .eq("source", p)
      ).count ?? 0;
  await db.from("audit_events").insert({
    user_id: c.user_id,
    action: "wearable.disconnect",
    actor_type: "user",
    resource_type: "wearable_connection",
    resource_id: c.id,
    outcome: "succeeded",
    metadata: { provider: p, deleted },
  });
}

export async function connectionsForExternal(db: Db, p: Wearable, externalId: string) {
  const { data } = await db
    .from("wearable_connections")
    .select("id")
    .eq("provider", p)
    .eq("external_user_id", externalId)
    .in("status", ["active", "degraded"]);
  return (data ?? []).map((r) => r.id);
}

async function hmacB64(secret: string, msg: string, hash: "SHA-256" | "SHA-1") {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  return btoa(
    String.fromCharCode(
      ...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg))),
    ),
  );
}
const same = (a: string, b: string) =>
  a.length === b.length &&
  [...a].reduce((r, ch, i) => r | (ch.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;
/** WHOOP: base64 HMAC-SHA256(client secret, timestamp + body). */
export async function verifyWhoop(body: string, sig: string | null, ts: string | null) {
  const s = env("WHOOP_CLIENT_SECRET");
  if (!s || !sig || !ts || Math.abs(Date.now() - Number(ts)) > 5 * 60000) return false;
  return same(await hmacB64(s, ts + body, "SHA-256"), sig);
}
/** Fitbit: base64 HMAC-SHA1(client secret + "&", body). */
export async function verifyFitbit(body: string, sig: string | null) {
  const s = env("FITBIT_CLIENT_SECRET");
  if (!s || !sig) return false;
  return same(await hmacB64(`${s}&`, body, "SHA-1"), sig);
}
