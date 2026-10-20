CREATE TABLE public.health_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('apple_health','health_connect')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  categories text[] NOT NULL DEFAULT '{}',
  write_enabled boolean NOT NULL DEFAULT false,
  token_hash text NOT NULL UNIQUE,
  last_received_at timestamptz,
  rejected_count integer NOT NULL DEFAULT 0,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX health_connections_one_active ON public.health_connections(user_id, platform) WHERE status = 'active';
GRANT SELECT ON public.health_connections TO authenticated;
GRANT ALL ON public.health_connections TO service_role;
ALTER TABLE public.health_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own health connections read" ON public.health_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER health_connections_touch BEFORE UPDATE ON public.health_connections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.health_samples
  ADD COLUMN connection_id uuid REFERENCES public.health_connections(id) ON DELETE SET NULL,
  ADD COLUMN provider_event_id text,
  ADD COLUMN end_at timestamptz,
  ADD COLUMN unit text,
  ADD COLUMN source_device text,
  ADD COLUMN provider_updated_at timestamptz,
  ADD COLUMN raw_hash text,
  ADD COLUMN is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN possible_duplicate boolean NOT NULL DEFAULT false;
CREATE INDEX health_samples_provider_event ON public.health_samples(user_id, source, provider_event_id) WHERE provider_event_id IS NOT NULL;