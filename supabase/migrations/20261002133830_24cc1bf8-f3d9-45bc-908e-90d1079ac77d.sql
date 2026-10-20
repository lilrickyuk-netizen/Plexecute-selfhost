ALTER TABLE public.consent_records
  ADD COLUMN IF NOT EXISTS scope text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS subject_id uuid;
CREATE INDEX IF NOT EXISTS consent_records_user_purpose ON public.consent_records (user_id, purpose, subject_id, created_at DESC);