// Server-only helpers for external providers. Credentials come from env vars only.

// Stripe sandbox test-mode price IDs (not secret). Used only when STRIPE_MODE=test.
const STRIPE_TEST_PRICES: Record<string, string> = {
  STRIPE_PRICE_PRO: "price_1UQYYcQ9icXYHuUuJJT2nWzE",
  STRIPE_PRICE_PRO_ANNUAL: "price_1UQYYcQ9icXYHuUuWoRQ4K1j",
  STRIPE_PRICE_EXECUTE: "price_1UQYYdQ9icXYHuUuKZNtvWuY",
  STRIPE_PRICE_EXECUTE_ANNUAL: "price_1UQYYeQ9icXYHuUupQslABfj",
  STRIPE_PRICE_AI_CREDIT: "price_1UQYYfQ9icXYHuUuTOjdSrLP",
  STRIPE_PRICE_VOICE_TOPUP: "price_1UQYYfQ9icXYHuUuStCk4S6t",
  STRIPE_PRICE_PRO_USD: "price_1UQYYgQ9icXYHuUu1upYGxKf",
  STRIPE_PRICE_PRO_ANNUAL_USD: "price_1UQYYhQ9icXYHuUuLwhccofT",
  STRIPE_PRICE_EXECUTE_USD: "price_1UQYYiQ9icXYHuUukaFxE6iy",
  STRIPE_PRICE_EXECUTE_ANNUAL_USD: "price_1UQYYiQ9icXYHuUu0fmST16m",
  STRIPE_PRICE_AI_CREDIT_USD: "price_1UQYYjQ9icXYHuUugsB0dWaL",
  STRIPE_PRICE_VOICE_TOPUP_USD: "price_1UQYYkQ9icXYHuUusPMCTfBJ",
};

function rawEnv(name: string) {
  // The platform-managed cron secret is stored as LOVABLE_CRON_SECRET.
  const v =
    process.env[name] ?? (name === "CRON_SECRET" ? process.env["LOVABLE_CRON_SECRET"] : undefined);
  return v && v.trim() ? v.trim() : undefined;
}

export function stripeTestMode() {
  return rawEnv("STRIPE_MODE") === "test";
}

export function env(name: string) {
  if (stripeTestMode() && name.startsWith("STRIPE_")) {
    if (name === "STRIPE_SECRET_KEY") return rawEnv("STRIPE_TEST_SECRET_KEY");
    if (name === "STRIPE_WEBHOOK_SECRET") return rawEnv("STRIPE_TEST_WEBHOOK_SECRET");
    if (STRIPE_TEST_PRICES[name]) return STRIPE_TEST_PRICES[name];
  }
  return rawEnv(name);
}

// ---------- Stripe ----------
export function stripeConfigured() {
  return !!(env("STRIPE_SECRET_KEY") && env("STRIPE_PRICE_PRO") && env("STRIPE_PRICE_EXECUTE"));
}

function formEncode(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") out.push(...formEncode(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export async function stripe(path: string, method: "GET" | "POST", body?: Record<string, unknown>) {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new Error("Stripe not configured");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? formEncode(body).join("&") : null,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    console.error(`Stripe ${path} failed [${res.status}]`, JSON.stringify(json));
    throw new Error(`Stripe request failed [${res.status}]`);
  }
  return json;
}

export function tierForPrice(priceId: string | undefined) {
  if (!priceId) return "free" as const;
  const execute = [
    "STRIPE_PRICE_EXECUTE",
    "STRIPE_PRICE_EXECUTE_ANNUAL",
    "STRIPE_PRICE_EXECUTE_USD",
    "STRIPE_PRICE_EXECUTE_ANNUAL_USD",
  ];
  const pro = [
    "STRIPE_PRICE_PRO",
    "STRIPE_PRICE_PRO_ANNUAL",
    "STRIPE_PRICE_PRO_USD",
    "STRIPE_PRICE_PRO_ANNUAL_USD",
  ];
  if (execute.some((n) => priceId === env(n))) return "execute" as const;
  if (pro.some((n) => priceId === env(n))) return "pro" as const;
  return "free" as const;
}

async function hmacHex(secret: string, msg: string, algo: "SHA-256" | "SHA-1" = "SHA-256") {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: algo },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyStripeSignature(raw: string, header: string | null, secret: string) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = parts["t"];
  const sigs = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const mac = await hmacHex(secret, `${t}.${raw}`);
  const hex = Array.from(mac)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return sigs.some((s) => safeEqual(s, hex));
}

// ---------- Twilio ----------
export function twilioConfigured() {
  return !!(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM_NUMBER"));
}

/** Caller ID per market (TWILIO_FROM_NUMBER_GB, TWILIO_FROM_NUMBER_US, ...), else the default number. */
export function twilioFromFor(to: string): string {
  const v = to.replace(/[\s()-]/g, "");
  const cc = v.startsWith("+44") ? "GB" : v.startsWith("+1") ? "US" : null;
  const market =
    cc === "GB"
      ? env("TWILIO_FROM_NUMBER_GB")
      : cc === "US"
        ? env("TWILIO_FROM_NUMBER_US")
        : undefined;
  return market || env("TWILIO_FROM_NUMBER")!;
}

export async function twilioCreateCall(
  to: string,
  twimlUrl: string,
  statusUrl: string,
  extra: Record<string, string> = {},
) {
  const sid = env("TWILIO_ACCOUNT_SID")!;
  const token = env("TWILIO_AUTH_TOKEN")!;
  const body = new URLSearchParams({
    To: to,
    From: twilioFromFor(to),
    Url: twimlUrl,
    StatusCallback: statusUrl,
    Method: "POST",
  });
  for (const e of ["initiated", "ringing", "answered", "completed"])
    body.append("StatusCallbackEvent", e);
  for (const [k, v] of Object.entries(extra)) body.set(k, v);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await res.json()) as { sid?: string; message?: string };
  if (!res.ok) throw new Error(`Twilio call failed [${res.status}]: ${json.message ?? ""}`);
  return json.sid!;
}

/** Replaces the instructions of a live call (used when async answering-machine detection finds voicemail). */
export async function twilioUpdateCall(callSid: string, twiml: string) {
  const sid = env("TWILIO_ACCOUNT_SID")!;
  const token = env("TWILIO_AUTH_TOKEN")!;
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls/${encodeURIComponent(callSid)}.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ Twiml: twiml }),
    },
  );
  if (!res.ok) console.error("twilio update call", res.status);
}

/** Twilio signature: base64(HMAC-SHA1(authToken, url + sorted(key+value))) */
export async function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  header: string | null,
) {
  const token = env("TWILIO_AUTH_TOKEN");
  if (!token || !header) return false;
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const mac = await hmacHex(token, data, "SHA-1");
  return safeEqual(btoa(String.fromCharCode(...mac)), header);
}

// ---------- Email (Resend) ----------
export function emailConfigured() {
  return !!(env("RESEND_API_KEY") && env("EMAIL_FROM"));
}

export async function sendEmail(to: string, subject: string, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: env("EMAIL_FROM"), to, subject, text }),
  });
  if (!res.ok) throw new Error(`Email failed [${res.status}]: ${await res.text()}`);
}

export function xmlEscape(s: string) {
  return s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!,
  );
}

export async function placeCall(userId: string, phone: string, origin: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: log } = await supabaseAdmin
    .from("call_logs")
    .insert({ user_id: userId })
    .select("id")
    .single();
  try {
    const sid = await twilioCreateCall(
      phone,
      `${origin}/api/public/twilio/voice?log=${log!.id}`,
      `${origin}/api/public/twilio/status?log=${log!.id}`,
    );
    await supabaseAdmin.from("call_logs").update({ call_sid: sid }).eq("id", log!.id);
    return { ok: true, error: null };
  } catch (e) {
    console.error(e);
    await supabaseAdmin.from("call_logs").update({ status: "failed" }).eq("id", log!.id);
    return { ok: false, error: "failed" as const };
  }
}
