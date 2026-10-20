/** Stripe return URLs may only point back at Plexecute's own sites. Anything else falls back to the main domain. */
const ALLOWED = new Set([
  "https://plexecute.io",
  "https://www.plexecute.io",
  "https://plexecute-io.lovable.app",
  "https://id-preview--221fce33-3bcd-46a8-a5ea-0c266b06b292.lovable.app",
  "http://localhost:8080",
  "http://localhost:3000",
]);
/** The deployed site (e.g. a workers.dev staging URL during migration) is also allowed. */
function appBaseOrigin(): string | null {
  try {
    const v = typeof process !== "undefined" ? process.env?.["APP_BASE_URL"] : undefined;
    return v ? new URL(v).origin : null;
  } catch {
    return null;
  }
}
export const DEFAULT_ORIGIN = "https://plexecute.io";
export function safeReturnOrigin(input: string | null | undefined): string {
  try {
    const o = new URL(String(input ?? "")).origin;
    return ALLOWED.has(o) || o === appBaseOrigin() ? o : DEFAULT_ORIGIN;
  } catch {
    return DEFAULT_ORIGIN;
  }
}
