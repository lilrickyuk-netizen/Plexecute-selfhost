/**
 * Standard Web Push (RFC 8030 + RFC 8291 aes128gcm + RFC 8292 VAPID) for browsers and installed
 * home-screen apps, so reminders arrive with the app closed. No third-party account: the VAPID
 * key pair is derived from the server-only VAPID_SEED secret. Worker-safe (WebCrypto + noble).
 */
import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { env } from "@/lib/integrations.server";

export type WebSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

const enc = new TextEncoder();
export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s: string): Uint8Array {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** VAPID keys derived deterministically from the seed (stable across deploys). */
export function vapidKeys(seed = env("VAPID_SEED")): { priv: Uint8Array; pub: Uint8Array } | null {
  if (!seed) return null;
  for (let i = 0; i < 8; i++) {
    const priv = hkdf(
      sha256,
      enc.encode(seed),
      enc.encode(`plexecute-vapid-${i}`),
      new Uint8Array(),
      32,
    );
    if (p256.utils.isValidSecretKey(priv)) return { priv, pub: p256.getPublicKey(priv, false) };
  }
  return null;
}
export function vapidPublicKey(): string | null {
  const k = vapidKeys();
  return k ? b64u(k.pub) : null;
}
export function webPushConfigured() {
  return !!vapidKeys();
}

function vapidJwt(aud: string, priv: Uint8Array, now = Date.now()): string {
  const h = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const c = b64u(
    enc.encode(
      JSON.stringify({
        aud,
        exp: Math.floor(now / 1000) + 12 * 3600,
        sub: `mailto:${env("VAPID_CONTACT") ?? "support@plexecute.io"}`,
      }),
    ),
  );
  const sig = p256.sign(enc.encode(`${h}.${c}`), priv);
  return `${h}.${c}.${b64u(sig)}`;
}

/** RFC 8291 aes128gcm payload encryption (single record). */
export async function encryptPayload(
  sub: WebSubscription,
  payload: Uint8Array,
  ephemeral = p256.utils.randomSecretKey(),
  salt = crypto.getRandomValues(new Uint8Array(16)),
): Promise<Uint8Array> {
  const uaPub = unb64u(sub.keys.p256dh);
  const auth = unb64u(sub.keys.auth);
  const asPub = p256.getPublicKey(ephemeral, false);
  const shared = p256.getSharedSecret(ephemeral, uaPub).slice(1);
  const ikm = hkdf(sha256, shared, auth, concat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const cek = hkdf(sha256, ikm, salt, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(sha256, ikm, salt, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, [
    "encrypt",
  ]);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      key,
      concat(payload, new Uint8Array([2])) as BufferSource,
    ),
  );
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

export type WebPushResult = { ok: boolean; status: number | null; gone: boolean; error?: string };

export async function sendWebPush(
  sub: WebSubscription,
  message: Record<string, unknown>,
  ttlSec = 1800,
): Promise<WebPushResult> {
  const k = vapidKeys();
  if (!k) return { ok: false, status: null, gone: false, error: "not_configured" };
  let url: URL;
  try {
    url = new URL(sub.endpoint);
    if (url.protocol !== "https:") throw new Error("bad endpoint");
  } catch {
    return { ok: false, status: 400, gone: true, error: "invalid_endpoint" };
  }
  let body: Uint8Array;
  try {
    body = await encryptPayload(sub, enc.encode(JSON.stringify(message)));
  } catch {
    return { ok: false, status: 400, gone: true, error: "invalid_subscription_keys" };
  }
  try {
    const r = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${vapidJwt(url.origin, k.priv)}, k=${b64u(k.pub)}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(ttlSec),
        Urgency: "high",
      },
      body: body as BodyInit,
    });
    if (r.ok) return { ok: true, status: r.status, gone: false };
    const text = (await r.text()).slice(0, 200);
    return { ok: false, status: r.status, gone: r.status === 404 || r.status === 410, error: text };
  } catch (e) {
    return { ok: false, status: null, gone: false, error: String(e).slice(0, 200) };
  }
}
