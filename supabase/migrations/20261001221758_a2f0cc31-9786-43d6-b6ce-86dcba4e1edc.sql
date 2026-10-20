CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE public.knowledge_sources (
  source_id text PRIMARY KEY,
  title text NOT NULL,
  publisher text NOT NULL,
  url text NOT NULL,
  jurisdiction text NOT NULL,
  domain text NOT NULL,
  rights text NOT NULL,
  storage_mode text NOT NULL,
  published date NOT NULL,
  retrieval_method text NOT NULL,
  trust_tier text NOT NULL CHECK (trust_tier IN ('T1','T2','T3','T4')),
  review_cadence_months integer NOT NULL,
  last_reviewed date NOT NULL,
  content_hash text,
  superseded_by text REFERENCES public.knowledge_sources(source_id),
  indexed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.knowledge_sources TO authenticated;
GRANT ALL ON public.knowledge_sources TO service_role;
ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read the source manifest" ON public.knowledge_sources FOR SELECT TO authenticated USING (true);

CREATE TABLE public.knowledge_chunks (
  chunk_id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES public.knowledge_sources(source_id) ON DELETE CASCADE,
  domain text NOT NULL,
  title text NOT NULL,
  text_or_rule text NOT NULL,
  effective_date date NOT NULL,
  embedding extensions.vector(1536),
  embedding_model text,
  indexed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.knowledge_chunks TO authenticated;
GRANT ALL ON public.knowledge_chunks TO service_role;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read knowledge chunks" ON public.knowledge_chunks FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.match_knowledge(query_embedding extensions.vector(1536), match_count integer DEFAULT 8)
RETURNS TABLE(chunk_id text, similarity double precision)
LANGUAGE sql STABLE SET search_path = public, extensions
AS $$
  SELECT c.chunk_id, 1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks c
  JOIN public.knowledge_sources s ON s.source_id = c.source_id
  WHERE c.embedding IS NOT NULL AND s.superseded_by IS NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT least(match_count, 20);
$$;
GRANT EXECUTE ON FUNCTION public.match_knowledge(extensions.vector, integer) TO authenticated, service_role;