CREATE TABLE public.error_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('server','client','job')),
  fingerprint text NOT NULL,
  route text,
  message text NOT NULL,
  request_id text,
  user_ref text,
  release text,
  forwarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX error_events_recent ON public.error_events (created_at DESC);
GRANT ALL ON public.error_events TO service_role;
REVOKE ALL ON public.error_events FROM anon, authenticated;
ALTER TABLE public.error_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to error events" ON public.error_events AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE TABLE public.provider_calls (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL,
  ok boolean NOT NULL,
  status int,
  latency_ms int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_calls_recent ON public.provider_calls (provider, created_at DESC);
GRANT ALL ON public.provider_calls TO service_role;
REVOKE ALL ON public.provider_calls FROM anon, authenticated;
ALTER TABLE public.provider_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to provider calls" ON public.provider_calls AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

SELECT cron.schedule('plexecute-observability-prune-daily', '53 3 * * *', $$DELETE FROM public.error_events WHERE created_at < now() - interval '30 days'; DELETE FROM public.provider_calls WHERE created_at < now() - interval '30 days'$$);