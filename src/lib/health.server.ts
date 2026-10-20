import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { KIND_UNIT, dedupe, rawHash, type IncomingSample, type StoredSample } from "./health";

/** Shared canonical store for every health source (§68): provenance, dedupe, deletes, then twin + evidence updates. */
export async function storeHealthSamples(
  db: SupabaseClient<Database>,
  userId: string,
  source: string,
  samples: IncomingSample[],
  connectionId: string | null = null,
) {
  let stored = 0,
    updated = 0,
    removed = 0;
  if (!samples.length) return { stored, updated, removed, twin: {}, rechecked: 0 };
  const times = samples.map((s) => new Date(s.recorded_at).getTime());
  const lo = new Date(Math.min(...times) - 864e5).toISOString(),
    hi = new Date(Math.max(...times) + 864e5).toISOString();
  const { data: existing } = await db
    .from("health_samples")
    .select("id,kind,recorded_at,end_at,provider_event_id,source")
    .eq("user_id", userId)
    .gte("recorded_at", lo)
    .lte("recorded_at", hi)
    .limit(10000);
  const pool: StoredSample[] = [...(existing ?? [])];
  for (const s of samples) {
    const row = {
      user_id: userId,
      source,
      connection_id: connectionId,
      kind: s.kind,
      value: s.value,
      recorded_at: s.recorded_at,
      end_at: s.end_at ?? null,
      unit: KIND_UNIT[s.kind],
      provider_event_id: s.provider_event_id ?? null,
      source_device: s.source_device ?? null,
      provider_updated_at: s.provider_updated_at ?? null,
      raw_hash: await rawHash(s),
      is_deleted: !!s.deleted,
    };
    const d = dedupe(s, source, pool);
    if (d.action === "update") {
      await db.from("health_samples").update(row).eq("id", d.id);
      if (s.deleted) removed++;
      else updated++;
    } else if (!s.deleted) {
      const { data: ins, error } = await db
        .from("health_samples")
        .upsert(
          { ...row, possible_duplicate: d.possibleDuplicate },
          { onConflict: "user_id,source,kind,recorded_at" },
        )
        .select("id")
        .single();
      if (error || !ins) throw new Error(`store failed: ${error?.message ?? "no row"}`);
      pool.push({
        id: ins.id,
        kind: s.kind,
        recorded_at: s.recorded_at,
        end_at: s.end_at ?? null,
        provider_event_id: s.provider_event_id ?? null,
        source,
      });
      stored++;
    }
  }
  const live = samples.filter((s) => !s.deleted);
  const { recordTwinObservation, healthToObservations } = await import("./twin.server");
  const twin: Record<string, string> = {};
  for (const o of healthToObservations(source, live))
    twin[`${o.domain}.${o.fact_key}`] = await recordTwinObservation(db, userId, o);
  const rechecked = await (
    await import("./verification.server")
  ).verifyAfterActivity(
    db,
    userId,
    live.filter((s) => s.kind === "workout_minutes"),
  );
  return { stored, updated, removed, twin, rechecked };
}
