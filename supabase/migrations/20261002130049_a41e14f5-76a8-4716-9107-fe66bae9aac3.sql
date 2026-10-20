ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS voice_provider text NULL CHECK (voice_provider IS NULL OR voice_provider IN ('openai','gemini','degraded')),
  ADD COLUMN IF NOT EXISTS voice_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_end_reason text NULL,
  ADD COLUMN IF NOT EXISTS voice_failovers integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tool_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS summary text NULL;