// Canonical Life Digital Twin write path for non-user sources (OBSERVED, DERIVED, AI_INFERRED).
// Rules: a locked current fact is never changed automatically; a newer value from the same source
// supersedes that source's version; a differing value from another source is stored alongside so the
// user sees a disagreement and resolves it on the Life Twin page.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type TwinSource = "OBSERVED" | "DERIVED" | "AI_INFERRED";
export type Observation = {
  domain: string;
  fact_key: string;
  value: unknown;
  source: TwinSource;
  confidence: number;
  source_ref: string;
  observed_at?: string;
};

export async function recordTwinObservation(
  db: SupabaseClient<Database>,
  userId: string,
  o: Observation,
): Promise<"stored" | "locked" | "unchanged"> {
  const { data: live } = await db
    .from("life_twin_facts")
    .select("id,source,source_ref,fact_value,is_locked,version")
    .eq("user_id", userId)
    .eq("domain", o.domain)
    .eq("fact_key", o.fact_key)
    .is("valid_until", null);
  const rows = live ?? [];
  if (rows.some((r) => r.is_locked)) return "locked";
  const same = rows.find((r) => r.source === o.source && r.source_ref === o.source_ref);
  if (same && JSON.stringify(same.fact_value) === JSON.stringify(o.value)) return "unchanged";
  const { data: maxV } = await db
    .from("life_twin_facts")
    .select("version")
    .eq("user_id", userId)
    .eq("domain", o.domain)
    .eq("fact_key", o.fact_key)
    .order("version", { ascending: false })
    .limit(1);
  const now = new Date().toISOString();
  const { error } = await db.from("life_twin_facts").insert({
    user_id: userId,
    domain: o.domain,
    fact_key: o.fact_key,
    fact_value: o.value as never,
    source: o.source,
    source_ref: o.source_ref,
    confidence: Math.max(0, Math.min(1, o.confidence)),
    observed_at: o.observed_at ?? now,
    version: (maxV?.[0]?.version ?? 0) + 1,
    supersedes_id: same?.id ?? null,
  });
  if (error) throw error;
  if (same) await db.from("life_twin_facts").update({ valid_until: now }).eq("id", same.id);
  return "stored";
}

/** Map health samples to Twin facts: latest value per kind (steps/sleep averaged over the batch). */
export function healthToObservations(
  source: string,
  samples: { kind: string; value: number; recorded_at: string }[],
): Observation[] {
  const MAP: Record<string, { domain: string; key: string; avg: boolean }> = {
    weight_kg: { domain: "body", key: "weight_kg", avg: false },
    sleep_hours: { domain: "sleep", key: "avg_sleep_hours", avg: true },
    steps: { domain: "activity", key: "daily_steps", avg: true },
    resting_hr: { domain: "body", key: "resting_hr", avg: false },
  };
  const out: Observation[] = [];
  for (const [kind, m] of Object.entries(MAP)) {
    const s = samples
      .filter((x) => x.kind === kind)
      .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
    const last = s[s.length - 1];
    if (!last) continue;
    const v = m.avg ? s.reduce((a, b) => a + b.value, 0) / s.length : last.value;
    out.push({
      domain: m.domain,
      fact_key: m.key,
      value: Math.round(v * 10) / 10,
      source: "OBSERVED",
      confidence: 0.9,
      source_ref: `health:${source}`,
      observed_at: last.recorded_at,
    });
  }
  return out;
}

/** Allow-list of facts the coach may infer. Anything else the model returns is discarded. */
export const INFERABLE: Record<
  string,
  { domain: string; type: "number" | "string"; min?: number; max?: number }
> = {
  avg_sleep_hours: { domain: "sleep", type: "number", min: 2, max: 14 },
  main_blocker: { domain: "behaviour", type: "string" },
  energy_pattern: { domain: "behaviour", type: "string" },
  daily_steps: { domain: "activity", type: "number", min: 0, max: 60000 },
  weight_kg: { domain: "body", type: "number", min: 30, max: 300 },
};

/** Validate model output against the allow-list; AI_INFERRED confidence is capped at 0.6. */
export function sanitizeInferred(raw: unknown, msgId: string): Observation[] {
  const list = (raw as { facts?: unknown })?.facts;
  if (!Array.isArray(list)) return [];
  const out: Observation[] = [];
  for (const f of list.slice(0, 5) as { key?: string; value?: unknown; confidence?: number }[]) {
    const spec = f?.key ? INFERABLE[f.key] : undefined;
    if (!spec || !f.key) continue;
    let v = f.value;
    if (spec.type === "number") {
      v = Number(v);
      if (
        !Number.isFinite(v) ||
        (spec.min != null && (v as number) < spec.min) ||
        (spec.max != null && (v as number) > spec.max)
      )
        continue;
    } else {
      if (typeof v !== "string" || !v.trim()) continue;
      v = v.trim().slice(0, 200);
    }
    out.push({
      domain: spec.domain,
      fact_key: f.key,
      value: v,
      source: "AI_INFERRED",
      confidence: Math.min(0.6, Number(f.confidence) || 0.5),
      source_ref: `coach_message:${msgId}`,
    });
  }
  return out;
}

export async function inferTwinFacts(
  apiKey: string,
  message: string,
  msgId: string,
  uid: string | null = null,
): Promise<Observation[]> {
  const res = await (
    await import("./metered-ai.server")
  ).meteredAiFetch(
    uid,
    "life_twin_inference",
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-6-luna",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Extract only facts the user states clearly about themselves. Allowed keys: ${Object.keys(INFERABLE).join(", ")}. Reply JSON {"facts":[{"key":string,"value":number|string,"confidence":0-1}]}. Return {"facts":[]} if none. Never guess.`,
          },
          { role: "user", content: message.slice(0, 2000) },
        ],
      }),
    },
  );
  const { recordAiUsage } = await import("./usage.server");
  if (!res.ok) {
    await recordAiUsage(uid, "life_twin_inference", "openai/gpt-6-luna", null, false);
    return [];
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  await recordAiUsage(uid, "life_twin_inference", "openai/gpt-6-luna", j);
  try {
    return sanitizeInferred(JSON.parse(j.choices?.[0]?.message?.content ?? "{}"), msgId);
  } catch {
    return [];
  }
}
