CREATE TABLE public.wearable_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('whoop','oura','fitbit','strava','garmin')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','degraded','revoked','disconnected')),
  external_user_id text,
  scopes text[] NOT NULL DEFAULT '{}',
  last_sync_at timestamptz,
  last_error text,
  error_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wearable_connections_one_live ON public.wearable_connections(user_id, provider) WHERE status <> 'disconnected';
CREATE INDEX wearable_connections_external ON public.wearable_connections(provider, external_user_id);
GRANT SELECT ON public.wearable_connections TO authenticated;
GRANT ALL ON public.wearable_connections TO service_role;
ALTER TABLE public.wearable_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own wearable connections read" ON public.wearable_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER wearable_connections_touch BEFORE UPDATE ON public.wearable_connections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.wearable_credentials (
  connection_id uuid PRIMARY KEY REFERENCES public.wearable_connections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  pkce_verifier text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.wearable_credentials TO service_role;
ALTER TABLE public.wearable_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no client access to wearable credentials" ON public.wearable_credentials FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER wearable_credentials_touch BEFORE UPDATE ON public.wearable_credentials FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();