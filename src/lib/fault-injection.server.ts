// Development-only fault injection for live recovery drills. Compiled out of production builds (import.meta.env.DEV)
// and limited to test members (@plexecute-test.invalid). A member message containing [[fault:ai]], [[fault:research]]
// or [[fault:action]] makes that turn hit a real failing provider/database call, so the real recovery path runs.
export type Fault =
  "ai" | "research" | "action" | "knowledge" | "knowledge_empty" | "knowledge_timeout";
const active = new Map<string, Set<Fault>>();

export async function armFaults(userId: string, text: string): Promise<Set<Fault>> {
  const none = new Set<Fault>();
  active.delete(userId);
  if (!import.meta.env.DEV) return none;
  const m = /\[\[fault:([a-z_,]+)\]\]/.exec(text);
  if (!m) return none;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (!String(data.user?.email ?? "").endsWith("@plexecute-test.invalid")) return none;
  const set = new Set(
    m[1]!
      .split(",")
      .filter((f): f is Fault =>
        ["ai", "research", "action", "knowledge", "knowledge_empty", "knowledge_timeout"].includes(
          f,
        ),
      ),
  );
  active.set(userId, set);
  return set;
}
export function faultOn(userId: string | null | undefined, f: Fault): boolean {
  return !!import.meta.env.DEV && !!userId && !!active.get(userId)?.has(f);
}
export function disarmFaults(userId: string) {
  active.delete(userId);
}
/** A database client whose every table lookup fails for real (unknown table), for action-failure drills. */
export function failingDb<T>(db: T): T {
  return new Proxy(db as object, {
    get(t, p, r) {
      if (p === "from") return (name: string) => (t as any).from(`__fault_injected_${name}`);
      return Reflect.get(t, p, r);
    },
  }) as T;
}
