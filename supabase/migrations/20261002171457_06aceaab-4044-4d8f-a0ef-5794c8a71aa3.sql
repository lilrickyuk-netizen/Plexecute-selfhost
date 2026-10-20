CREATE TABLE public.background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','retrying','succeeded','dead')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text,
  result jsonb,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX background_jobs_due ON public.background_jobs (status, next_attempt_at);
CREATE INDEX background_jobs_kind ON public.background_jobs (kind, created_at DESC);
GRANT ALL ON public.background_jobs TO service_role;
REVOKE ALL ON public.background_jobs FROM anon, authenticated;
ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to background jobs" ON public.background_jobs AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE TABLE public.background_job_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.background_jobs(id) ON DELETE CASCADE,
  event text NOT NULL,
  attempt int NOT NULL DEFAULT 0,
  detail text,
  actor text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX background_job_events_job ON public.background_job_events (job_id, created_at);
GRANT ALL ON public.background_job_events TO service_role;
REVOKE ALL ON public.background_job_events FROM anon, authenticated;
ALTER TABLE public.background_job_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to job events" ON public.background_job_events AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.touch_background_job() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER background_jobs_updated BEFORE UPDATE ON public.background_jobs FOR EACH ROW EXECUTE FUNCTION public.touch_background_job();

-- Completed job records are kept 90 days; dead ones stay until replayed or reviewed.
SELECT cron.schedule('plexecute-jobs-prune-daily', '41 3 * * *', $$DELETE FROM public.background_jobs WHERE status = 'succeeded' AND finished_at < now() - interval '90 days'$$);