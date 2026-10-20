CREATE TABLE public.usage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid,
  service_month date NOT NULL,
  tier text NOT NULL DEFAULT 'none',
  provider text NOT NULL,
  feature text NOT NULL,
  unit text NOT NULL CHECK (unit IN ('input_tokens','output_tokens','requests','messages','attempts','billed_seconds','connected_seconds','voice_seconds')),
  quantity numeric NOT NULL CHECK (quantity >= 0),
  market text NOT NULL DEFAULT 'unknown',
  platform text NOT NULL DEFAULT 'web',
  ok boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.usage_events TO service_role;
REVOKE ALL ON public.usage_events FROM anon, authenticated;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to usage events" ON public.usage_events AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE INDEX usage_events_user ON public.usage_events (user_id, created_at DESC);
CREATE INDEX usage_events_month ON public.usage_events (service_month, provider, feature);