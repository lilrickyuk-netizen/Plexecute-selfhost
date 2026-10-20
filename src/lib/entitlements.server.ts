// Server-side entitlement enforcement. Tier is read from the member's own profile row
// (written only by the signed Stripe webhook), never from the request.
import {
  allows,
  CAPABILITY_MESSAGE,
  FREE_LIMITS,
  LIMIT_MESSAGE,
  MAJOR_REPLAN_TRIGGERS,
  normTier,
  type Capability,
  type Tier,
} from "./entitlements";
import { startOfLocalDay } from "./tz";

type Db = { from: (t: any) => any };

export class EntitlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntitlementError";
  }
}

export async function tierOf(
  db: Db,
  userId: string,
): Promise<{ tier: Tier; timezone: string | null }> {
  const { data } = await db.from("profiles").select("tier,timezone").eq("id", userId).maybeSingle();
  return { tier: normTier(data?.tier), timezone: data?.timezone ?? null };
}

export async function requireCapability(db: Db, userId: string, cap: Capability): Promise<Tier> {
  const { tier } = await tierOf(db, userId);
  if (!allows(tier, cap)) throw new EntitlementError(CAPABILITY_MESSAGE[cap]);
  return tier;
}

/** Member-requested plan proposals: returns the trigger to store. "onboarding" stands only for a member's first plan and
 *  "system" is never accepted from a member call, so a replan cannot be relabelled to dodge the Free cap
 *  (at most 2 per rolling 7 days). */
export async function requireReplanAllowance(
  db: Db,
  userId: string,
  trigger: string,
): Promise<string> {
  let effective = trigger;
  if (!(MAJOR_REPLAN_TRIGGERS as readonly string[]).includes(trigger)) {
    const { count: prior } = await db
      .from("plan_versions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    effective = trigger === "onboarding" && (prior ?? 0) === 0 ? "onboarding" : "manual";
    if (effective === "onboarding") return effective;
  }
  const { tier } = await tierOf(db, userId);
  if (tier !== "free") return effective;
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { count } = await db
    .from("plan_versions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("trigger", [...MAJOR_REPLAN_TRIGGERS])
    .gte("created_at", since);
  if (
    (count ?? 0) >= FREE_LIMITS.majorReplansPer7Days &&
    !(await rebuildingAfterDelete(db, userId, since))
  )
    throw new EntitlementError(LIMIT_MESSAGE.majorReplans);
  return effective;
}

/** A member who just deleted their plan can always build a fresh one (at most twice in 7 days, so deleting can't
 *  become unlimited replanning). */
async function rebuildingAfterDelete(db: Db, userId: string, since: string): Promise<boolean> {
  const recentWeek = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const { count: live } = await db
    .from("plan_versions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["approved", "proposed"])
    .gte("week_start", recentWeek);
  if ((live ?? 0) > 0) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count } = await supabaseAdmin
    .from("audit_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", "plan.deleted")
    .gte("created_at", since);
  return (count ?? 0) >= 1 && (count ?? 0) <= FREE_LIMITS.majorReplansPer7Days;
}

/** Free: one AI food extraction (text or photo) per user-local day. Counted from the server usage ledger. */
export async function requireAiFoodAllowance(db: Db, userId: string): Promise<Tier> {
  const { tier, timezone } = await tierOf(db, userId);
  if (tier !== "free") return tier;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count } = await supabaseAdmin
    .from("usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("feature", ["food_text", "food_photo"])
    .eq("ok", true)
    .gte("created_at", startOfLocalDay(new Date(), timezone).toISOString());
  if ((count ?? 0) >= FREE_LIMITS.aiFoodLogsPerDay)
    throw new EntitlementError(LIMIT_MESSAGE.aiFoodLogs);
  return tier;
}

/** Free: one external calendar connection (read / free-busy). */
export async function requireCalendarSlot(db: Db, userId: string, provider: string): Promise<void> {
  const { tier } = await tierOf(db, userId);
  if (tier !== "free") return;
  const { data } = await db
    .from("calendar_connections")
    .select("provider,status")
    .eq("user_id", userId);
  const others = (data ?? []).filter(
    (c: { provider: string; status: string }) =>
      c.provider !== provider && c.status !== "disconnected",
  );
  if (others.length >= FREE_LIMITS.externalCalendars)
    throw new EntitlementError(LIMIT_MESSAGE.externalCalendars);
}
