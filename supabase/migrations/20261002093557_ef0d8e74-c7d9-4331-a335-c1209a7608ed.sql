CREATE TABLE public.calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google','microsoft','device')),
  mode text NOT NULL DEFAULT 'FREE_BUSY_ONLY' CHECK (mode IN ('FREE_BUSY_ONLY','READ_DETAILS','WRITE_PLEXECUTE_BLOCKS','READ_AND_WRITE')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','degraded','revoked','disconnected')),
  account_label text,
  calendar_id_hash text,
  write_calendar_id text,
  all_day_hard boolean NOT NULL DEFAULT false,
  last_sync_at timestamptz,
  last_error text,
  error_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX calendar_connections_live ON public.calendar_connections(user_id, provider) WHERE status <> 'disconnected';
GRANT SELECT ON public.calendar_connections TO authenticated;
GRANT ALL ON public.calendar_connections TO service_role;
ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own calendar connections readable" ON public.calendar_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER calendar_connections_touch BEFORE UPDATE ON public.calendar_connections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.calendar_credentials (
  connection_id uuid PRIMARY KEY REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  sync_cursor text,
  channel_id text,
  channel_resource text,
  channel_expires_at timestamptz,
  webhook_secret text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calendar_credentials_channel ON public.calendar_credentials(channel_id);
GRANT ALL ON public.calendar_credentials TO service_role;
ALTER TABLE public.calendar_credentials ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER calendar_credentials_touch BEFORE UPDATE ON public.calendar_credentials FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.calendar_busy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  event_hash text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  busy boolean NOT NULL DEFAULT true,
  time_zone text,
  calendar_id_hash text,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, event_hash)
);
CREATE INDEX calendar_busy_user_time ON public.calendar_busy(user_id, starts_at);
GRANT SELECT ON public.calendar_busy TO authenticated;
GRANT ALL ON public.calendar_busy TO service_role;
ALTER TABLE public.calendar_busy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own busy times readable" ON public.calendar_busy FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.calendar_event_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.plan_blocks(id) ON DELETE CASCADE,
  external_event_id text,
  idempotency_key text NOT NULL,
  content_hash text,
  state text NOT NULL DEFAULT 'synced' CHECK (state IN ('synced','deleted_externally','moved_externally','removed')),
  external_starts_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, idempotency_key)
);
GRANT SELECT ON public.calendar_event_links TO authenticated;
GRANT ALL ON public.calendar_event_links TO service_role;
ALTER TABLE public.calendar_event_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own calendar links readable" ON public.calendar_event_links FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER calendar_event_links_touch BEFORE UPDATE ON public.calendar_event_links FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();