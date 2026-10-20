import { RATE_LIMITS, type RateLimitKey } from "./security";

/** Returns true when allowed. Fails open only if the limiter itself is unreachable, so outages never lock users out. */
export async function rateLimit(key: RateLimitKey, subject: string): Promise<boolean> {
  const [win, max] = RATE_LIMITS[key];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("hit_rate_limit", {
    _bucket: `${key}:${subject}`,
    _window_seconds: win,
    _max: max,
  });
  if (error) {
    console.error("rate limiter unavailable", error.message);
    return true;
  }
  return data === true;
}

export function tooMany() {
  return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
}

export async function hashSubject(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
