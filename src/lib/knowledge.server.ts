// Server-only knowledge retrieval: pgvector semantic match merged with lexical scoring,
// then the V3 §54 grounding rules. Falls back to lexical when the index or embeddings are unavailable.
import {
  CHUNKS,
  SOURCES,
  retrieve,
  groundBundle,
  sourceOf,
  cadenceMonths,
  lastReviewed,
  retrievalMethod,
  type Domain,
  type Evidence,
  type EvidenceBundle,
} from "./knowledge";

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";

export async function embed(texts: string[]): Promise<number[][] | null> {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) return null;
  try {
    const r = await (await import("./ai-gateway.server")).aiFetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
    });
    if (!r.ok) {
      console.error("embed failed", r.status, await r.text());
      return null;
    }
    const j = await r.json();
    await (
      await import("./usage.server")
    ).recordAiUsage(
      null,
      texts.length > 1 ? "knowledge_rebuild" : "knowledge_search",
      EMBEDDING_MODEL,
      j,
    );
    return (j.data as { embedding: number[] }[]).map((d) => d.embedding);
  } catch (e) {
    console.error("embed error", e);
    return null;
  }
}

/** Writes the code manifest into the database and embeds every passage. */
export async function syncKnowledgeIndex() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const srcRows = SOURCES.map((s) => ({
    source_id: s.source_id,
    title: s.title,
    publisher: s.publisher,
    url: s.url,
    jurisdiction: s.jurisdiction,
    domain: s.domain,
    rights: s.rights,
    storage_mode: s.storage,
    published: s.published,
    retrieval_method: retrievalMethod(s),
    trust_tier: s.trust_tier,
    review_cadence_months: cadenceMonths(s),
    last_reviewed: lastReviewed(s),
    content_hash: s.content_hash ?? null,
    superseded_by: null,
    indexed_at: new Date().toISOString(),
  }));
  const { error: e1 } = await supabaseAdmin.from("knowledge_sources").upsert(srcRows);
  if (e1) throw new Error(e1.message);
  const sup = SOURCES.filter((s) => s.superseded_by).map((s) => ({
    source_id: s.source_id,
    superseded_by: s.superseded_by!,
  }));
  for (const s of sup)
    await supabaseAdmin
      .from("knowledge_sources")
      .update({ superseded_by: s.superseded_by })
      .eq("source_id", s.source_id);
  const vectors = await embed(CHUNKS.map((c) => `${c.title}. ${c.text_or_rule}`));
  const rows = CHUNKS.map((c, i) => ({
    chunk_id: c.chunk_id,
    source_id: c.source_id,
    domain: c.domain,
    title: c.title,
    text_or_rule: c.text_or_rule,
    effective_date: c.effective_date,
    embedding: vectors ? JSON.stringify(vectors[i]) : null,
    embedding_model: vectors ? EMBEDDING_MODEL : null,
    indexed_at: new Date().toISOString(),
  }));
  const { error: e2 } = await supabaseAdmin.from("knowledge_chunks").upsert(rows as never);
  if (e2) throw new Error(e2.message);
  return { sources: srcRows.length, chunks: rows.length, embedded: !!vectors };
}

/** Semantic + lexical retrieval with grounding. method tells the caller which path ran. */
export async function retrieveEvidence(
  supabase: {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  },
  query: string,
  opts: { limit?: number; domains?: Domain[]; today: string },
): Promise<EvidenceBundle & { method: "semantic+lexical" | "lexical" }> {
  const lexical = retrieve(query, 20);
  const v = await embed([query]);
  let method: "semantic+lexical" | "lexical" = "lexical";
  const scores = new Map<string, number>(lexical.map((e) => [e.chunk_id, e.score]));
  if (v) {
    // Global library search; a refused or failing call falls back to word matching instead of failing the turn.
    const { data, error } = await Promise.resolve(
      supabase.rpc("match_knowledge", { query_embedding: JSON.stringify(v[0]), match_count: 10 }),
    ).catch((e: unknown) => ({ data: null, error: e }));
    const hits = (data as { chunk_id: string; similarity: number }[] | null) ?? [];
    if (!error && hits.length) {
      method = "semantic+lexical";
      for (const h of hits)
        if (h.similarity >= 0.35)
          scores.set(h.chunk_id, (scores.get(h.chunk_id) ?? 0) + h.similarity * 6);
    }
  }
  const ranked: Evidence[] = [...scores.entries()]
    .map(([id, score]) => {
      const ch = CHUNKS.find((c) => c.chunk_id === id)!;
      const src = sourceOf(ch.source_id);
      return {
        ...ch,
        trust_tier: src.trust_tier,
        jurisdiction: src.jurisdiction,
        citation_label: `${src.publisher}, ${src.published.slice(0, 4)}`,
        score: ch.domain === "safety" ? score + 5 : score,
      };
    })
    .filter((e) => e.score >= 2)
    .sort((a, b) => b.score - a.score);
  return { ...groundBundle(ranked, opts), method };
}

export type TurnKnowledge = {
  status: "ok" | "empty" | "unavailable";
  method: "semantic+lexical" | "lexical" | "none";
  domains: Domain[];
  evidence: (Evidence & { score: number })[];
  error?: string;
};

/** Coach receives only evidence DTOs; the global-index RPC client never escapes this read-only helper. */
export async function retrieveCoachEvidence(query: string, today: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return retrieveForTurn(supabaseAdmin as never, query, { limit: 4, domains: [], today, userId });
}

/** Explicit evidence state: lookup worked and found support / worked and found none / lookup itself failed. */
export type EvidenceState =
  "KNOWLEDGE_FOUND" | "NO_RELEVANT_KNOWLEDGE" | "KNOWLEDGE_RETRIEVAL_FAILED";
export function evidenceState(k: Pick<TurnKnowledge, "status" | "evidence">): EvidenceState {
  if (k.status === "unavailable") return "KNOWLEDGE_RETRIEVAL_FAILED";
  return k.evidence.length ? "KNOWLEDGE_FOUND" : "NO_RELEVANT_KNOWLEDGE";
}

/** Decision-source labels persisted with routing so every rationale is auditable by origin. */
export type DecisionSource =
  | "MEMBER_FACT"
  | "PLEXECUTE_KNOWLEDGE"
  | "CURRENT_EXTERNAL_RESEARCH"
  | "DETERMINISTIC_PLANNING_RULE"
  | "MODEL_INFERENCE"
  | "USER_PREFERENCE";

const SOURCE_RULES = `Decision sources (keep them distinct when explaining any plan or claim): MEMBER FACT = what the member told Plexecute or their saved records; USER PREFERENCE = their stated choices (times, days, styles); PLEXECUTE KNOWLEDGE = only the bracketed library passages listed here; CURRENT EXTERNAL RESEARCH = live research tool results; DETERMINISTIC PLANNING RULE = the planner's built-in rules (e.g. recovery spacing between hard workouts, commitment buffers, daily load limits) — call these "Plexecute's planning rules", never sourced evidence; MODEL INFERENCE = your own general reasoning — say it is general reasoning. Never present a planning rule or inference as sourced knowledge.`;

/**
 * Knowledge for one Coach turn or decision: semantic+lexical over the global Plexecute index, filtered to the
 * routed/specialist domains, at most 2 passages per domain so multi-area requests get each area. Bounded by a
 * timeout; on failure it says so (status "unavailable") and never substitutes invented guidance. Member data is
 * only the query text; nothing is written to the global knowledge tables.
 */
export async function retrieveForTurn(
  supabase: Parameters<typeof retrieveEvidence>[0],
  query: string,
  opts: {
    domains: Domain[];
    today: string;
    limit?: number;
    userId?: string | null;
    timeoutMs?: number;
  },
): Promise<TurnKnowledge> {
  const limit = opts.limit ?? 6;
  const FI = await import("./fault-injection.server");
  if (FI.faultOn(opts.userId, "knowledge"))
    return {
      status: "unavailable",
      method: "none",
      domains: opts.domains,
      evidence: [],
      error: "knowledge_store_unavailable",
    };
  if (FI.faultOn(opts.userId, "knowledge_empty"))
    return { status: "empty", method: "none", domains: opts.domains, evidence: [] };
  const run = async () => {
    let wide = await retrieveEvidence(supabase, query.slice(0, 2000), {
      today: opts.today,
      limit: 20,
      ...(opts.domains.length ? { domains: opts.domains } : {}),
    });
    if (!wide.evidence.length && opts.domains.length) {
      wide = await retrieveEvidence(supabase, query.slice(0, 2000), {
        today: opts.today,
        limit: 20,
      });
    }
    const per = new Map<string, number>();
    const picked: (Evidence & { score: number })[] = [];
    for (const e of wide.evidence as (Evidence & { score: number })[]) {
      const n = per.get(e.domain) ?? 0;
      if (n >= 2 && e.domain !== "safety") continue;
      per.set(e.domain, n + 1);
      picked.push(e);
      if (picked.length >= limit) break;
    }
    // Every routed area is represented: add the core passage of any routed domain nothing matched.
    const { domainAnchors } = await import("./knowledge-routing");
    for (const an of domainAnchors(
      opts.domains.slice(0, 4),
      new Set(picked.map((e) => e.chunk_id)),
    )) {
      if (picked.length >= limit + 2) break;
      const ch = CHUNKS.find((c) => c.chunk_id === an.chunk_id)!;
      const src = sourceOf(ch.source_id);
      picked.push({
        ...ch,
        trust_tier: src.trust_tier,
        jurisdiction: src.jurisdiction,
        citation_label: `${src.publisher}, ${src.published.slice(0, 4)}`,
        score: 1,
      } as never);
    }
    return { wide, picked };
  };
  const timeoutMs = FI.faultOn(opts.userId, "knowledge_timeout") ? 1 : (opts.timeoutMs ?? 6000);
  try {
    const r = await Promise.race([
      run(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("knowledge_timeout")), timeoutMs),
      ),
    ]);
    return {
      status: r.picked.length ? "ok" : "empty",
      method: r.wide.method,
      domains: opts.domains,
      evidence: r.picked,
    };
  } catch (e) {
    // Semantic search slow or failing: fall back to the in-code library (word match + core passages per area).
    {
      try {
        const lex = retrieve(query.slice(0, 2000), 20);
        const g = groundBundle(lex, {
          today: opts.today,
          limit,
          ...(opts.domains.length ? { domains: opts.domains } : {}),
        });
        const picked = [...(g.evidence as (Evidence & { score: number })[])];
        const { domainAnchors } = await import("./knowledge-routing");
        for (const an of domainAnchors(
          opts.domains.slice(0, 4),
          new Set(picked.map((x) => x.chunk_id)),
        )) {
          const ch = CHUNKS.find((c) => c.chunk_id === an.chunk_id)!;
          const src = sourceOf(ch.source_id);
          picked.push({
            ...ch,
            trust_tier: src.trust_tier,
            jurisdiction: src.jurisdiction,
            citation_label: `${src.publisher}, ${src.published.slice(0, 4)}`,
            score: 1,
          } as never);
        }
        if (picked.length)
          return {
            status: "ok",
            method: "lexical",
            domains: opts.domains,
            evidence: picked,
            error: `semantic_fallback: ${String((e as Error)?.message ?? e)}`,
          };
      } catch {
        /* fall through to unavailable */
      }
    }
    return {
      status: "unavailable",
      method: "none",
      domains: opts.domains,
      evidence: [],
      error: String((e as Error)?.message ?? e),
    };
  }
}

/** Prompt block for retrieved knowledge; states the explicit evidence state so failure and no-match never blur. */
export function knowledgeBlock(k: TurnKnowledge): string {
  const st = evidenceState(k);
  if (st === "KNOWLEDGE_RETRIEVAL_FAILED")
    return `Plexecute knowledge (internal) state=KNOWLEDGE_RETRIEVAL_FAILED: the knowledge lookup failed this turn (a system problem, not a lack of evidence). If the member asks for evidence, say Plexecute's knowledge library could not be checked right now; never say no evidence exists. Do not cite Plexecute guidance; still help using the member's records, tool results and general reasoning labelled as general. ${SOURCE_RULES}`;
  if (st === "NO_RELEVANT_KNOWLEDGE")
    return `Plexecute knowledge (internal) state=NO_RELEVANT_KNOWLEDGE: the lookup worked but the library has no passage relevant to this request. If asked for evidence, say "Plexecute's current knowledge library does not contain sourced guidance on that" — never say you couldn't retrieve it. Invent no source; label any reasoning as general, and use live research if a current fact is needed. ${SOURCE_RULES}`;
  const lines = k.evidence.map(
    (e) =>
      `- [${e.chunk_id}] ${e.title} (${e.domain}; cite as [${e.citation_label}]): ${e.text_or_rule}`,
  );
  return `Plexecute knowledge (internal) state=KNOWLEDGE_FOUND (lookup succeeded THIS turn, whatever earlier messages said). Apply it to what you plan, schedule and change, not only wording; for evidence or "why" questions cite these passages. If none of them supports the specific claim asked about (e.g. one exact number), say "Plexecute's current knowledge library does not contain sourced guidance supporting that specific claim" and give what the passages do support — never call that a retrieval failure. ${SOURCE_RULES}\n${lines.join("\n")}`;
}
