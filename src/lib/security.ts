// V3 Step 62: shared security primitives (pure, testable).

/** Constant-time string compare for shared secrets and tokens. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const ea = new TextEncoder().encode(a),
    eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** Checks `Authorization: Bearer <secret>` in constant time; unset secret always fails. */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  return safeEqual(header ?? "", `Bearer ${secret}`);
}

/** SSRF guard: server-side fetches may only reach these provider hosts over https. */
export const OUTBOUND_HOSTS = [
  "api.stripe.com",
  "api.resend.com",
  "api.twilio.com",
  "verify.twilio.com",
  "ai.gateway.lovable.dev",
  "connector-gateway.lovable.dev",
  "oauth2.googleapis.com",
  "www.googleapis.com",
  "graph.microsoft.com",
  "login.microsoftonline.com",
  "api.prod.whoop.com",
  "api.ouraring.com",
  "api.fitbit.com",
  "www.strava.com",
  "apis.garmin.com",
  "connectapi.garmin.com",
  "diauth.garmin.com",
  "exp.host",
  "oauth.fatsecret.com",
  "platform.fatsecret.com",
  "api.nal.usda.gov",
  "api.firecrawl.dev",
  "www.youtube.com",
  "api.openai.com",
  "api.elevenlabs.io",
  "generativelanguage.googleapis.com",
  "maps.googleapis.com",
  "routes.googleapis.com",
  "places.googleapis.com",
  "eu.i.posthog.com",
  "us.i.posthog.com",
] as const;

export function isAllowedOutbound(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  return (OUTBOUND_HOSTS as readonly string[]).includes(u.hostname.toLowerCase());
}

export function assertAllowedOutbound(url: string): void {
  if (!isAllowedOutbound(url)) throw new Error("Blocked outbound request");
}

/** Per-feature limits: [window seconds, max calls]. */
export const RATE_LIMITS = {
  health_ingest: [60, 30],
  glance: [60, 60],
  data_export: [3600, 5],
  rights_request: [86400, 10],
  support_request: [86400, 10],
  research: [3600, 20],
  food_photo: [3600, 30],
  meal_recipe: [3600, 30],
  auth_webhook: [60, 120],
  client_error: [60, 20],
  // V3 §74 per-user ceilings.
  coach_turn: [60, 30],
  food_search: [60, 60],
  plan_optimise: [60, 12],
  call_settings: [3600, 20],
  voice_input: [3600, 60],
  onboarding_intake: [86400, 12],
  first_step_pathway: [86400, 8],
  booking_call: [86400, 15],
} as const satisfies Record<string, readonly [number, number]>;
export type RateLimitKey = keyof typeof RATE_LIMITS;

/** Baseline response headers for every page and API response. */
export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(self), microphone=(self), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
};

/** Secure uploads: the declared image type must match the file's real leading bytes. */
export function imageMatchesType(dataUrl: string): boolean {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return false;
  let head: string;
  try {
    head = atob((m[2] ?? "").slice(0, 24));
  } catch {
    return false;
  }
  const b = [...head].map((c) => c.charCodeAt(0));
  if (m[1] === "jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (m[1] === "png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  return head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WEBP";
}
