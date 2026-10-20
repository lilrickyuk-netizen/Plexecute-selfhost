import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { classify, type EvidenceClass, type Signal } from "./verification";

type Db = SupabaseClient<Database>;

/** Re-classifies one occurrence from every stored signal and writes the result (service role only). */
export async function verifyBlock(db: Db, userId: string, blockId: string): Promise<EvidenceClass> {
  const { data: b } = await db
    .from("plan_blocks")
    .select("id,domain,occurrence_kind,status,starts_at,duration_min,user_id")
    .eq("id", blockId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!b) return "unknown";
  const start = new Date(b.starts_at).getTime();
  const lo = new Date(start - 60 * 60_000).toISOString(),
    hi = new Date(start + (b.duration_min + 120) * 60_000).toISOString();
  const [ev, ws, wl, hs, claims] = await Promise.all([
    db
      .from("plan_block_events")
      .select("event_type,actor_type,reason_code,to_status")
      .eq("block_id", b.id),
    db.from("workout_sessions").select("id").eq("block_id", b.id),
    db.from("wellness_sessions").select("id,actual_minutes").eq("block_id", b.id),
    db
      .from("health_samples")
      .select("id,source,value,recorded_at")
      .eq("is_deleted", false)
      .eq("user_id", userId)
      .eq("kind", "workout_minutes")
      .gte("recorded_at", lo)
      .lte("recorded_at", hi),
    db
      .from("evidence_claims")
      .select("block_id,source_ref")
      .eq("user_id", userId)
      .eq("source_kind", "health_activity"),
  ]);
  const signals: Signal[] = [];
  for (const e of ev.data ?? []) {
    if (e.to_status !== "done" && e.to_status !== "partial") continue;
    if (e.reason_code === "call_confirmed") signals.push({ kind: "call_confirm", origin: "call" });
    else if (e.actor_type === "user" || e.actor_type == null)
      signals.push({ kind: "self_confirm", origin: "user" });
  }
  const sessIds = (ws.data ?? []).map((w) => w.id);
  if (sessIds.length) {
    const { count } = await db
      .from("workout_sets")
      .select("id", { count: "exact", head: true })
      .in("session_id", sessIds);
    signals.push({ kind: "workout_log", origin: "user", sets: count ?? 0, ref: sessIds[0]! });
  }
  for (const w of wl.data ?? [])
    signals.push({ kind: "timer", origin: "system", minutes: w.actual_minutes, ref: w.id });
  for (const h of hs.data ?? [])
    signals.push({
      kind: "external_activity",
      origin: "device",
      ref: h.id,
      startsAt: h.recorded_at,
      minutes: Number(h.value),
      source: h.source.replace("_", " "),
    });
  const elsewhere = new Set(
    (claims.data ?? []).filter((c) => c.block_id !== b.id).map((c) => c.source_ref),
  );
  const v = classify(b, signals, elsewhere);
  if (v.claim) {
    const { error } = await db
      .from("evidence_claims")
      .insert({ user_id: userId, block_id: b.id, ...v.claim });
    if (
      error &&
      !(claims.data ?? []).some((c) => c.block_id === b.id && c.source_ref === v.claim!.source_ref)
    ) {
      // Lost a race for this record: it now belongs to another session.
      return verifyBlock(db, userId, blockId);
    }
  }
  await db
    .from("plan_blocks")
    .update({
      evidence: v.evidence,
      evidence_detail: {
        reasons: v.reasons,
        policy_version: v.policy_version,
        claim: v.claim?.source_ref ?? null,
      },
    })
    .eq("id", b.id);
  return v.evidence;
}

/** After new device activity arrives, re-check finished physical sessions in range. */
export async function verifyAfterActivity(
  db: Db,
  userId: string,
  samples: { recorded_at: string }[],
) {
  if (!samples.length) return 0;
  const times = samples.map((s) => new Date(s.recorded_at).getTime());
  const lo = new Date(Math.min(...times) - 6 * 3600_000).toISOString(),
    hi = new Date(Math.max(...times) + 3600_000).toISOString();
  const { data } = await db
    .from("plan_blocks")
    .select("id")
    .eq("user_id", userId)
    .in("status", ["done", "partial"])
    .neq("evidence", "verified_external")
    .gte("starts_at", lo)
    .lte("starts_at", hi);
  for (const b of data ?? []) await verifyBlock(db, userId, b.id);
  return data?.length ?? 0;
}
