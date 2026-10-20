-- Journey Planning (Google Maps Platform, Pro/Execute). Journeys reserve real time as protected plan_blocks; this table holds the route facts. No raw Google responses stored.

CREATE TABLE public.saved_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label text NOT NULL,
  address text NOT NULL,
  lat double precision,
  lng double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, label)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_places TO authenticated;
GRANT ALL ON public.saved_places TO service_role;
ALTER TABLE public.saved_places ENABLE ROW LEVEL SECURITY;
CREATE POLICY saved_places_owner ON public.saved_places
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  origin_label text,
  origin_address text NOT NULL,
  origin_lat double precision,
  origin_lng double precision,
  dest_label text,
  dest_address text NOT NULL,
  dest_lat double precision,
  dest_lng double precision,
  mode text NOT NULL CHECK (mode IN ('drive','transit','walk')),
  arrive_by timestamptz NOT NULL,
  leave_at timestamptz NOT NULL,
  duration_min integer NOT NULL,
  buffer_min integer NOT NULL DEFAULT 10,
  distance_m integer,
  traffic_aware boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','monitoring','leave_soon','in_progress','completed','cancelled','needs_attention')),
  appointment_id uuid REFERENCES public.appointment_bookings(id) ON DELETE SET NULL,
  plan_block_id uuid REFERENCES public.plan_blocks(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'google_maps',
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journeys_user_upcoming ON public.journeys (user_id, leave_at) WHERE status NOT IN ('completed','cancelled');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journeys TO authenticated;
GRANT ALL ON public.journeys TO service_role;
ALTER TABLE public.journeys ENABLE ROW LEVEL SECURITY;
CREATE POLICY journeys_owner ON public.journeys
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.journey_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journey_id uuid NOT NULL REFERENCES public.journeys(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journey_events_journey ON public.journey_events (journey_id, created_at);
GRANT SELECT ON public.journey_events TO authenticated;
GRANT ALL ON public.journey_events TO service_role;
ALTER TABLE public.journey_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY journey_events_owner_read ON public.journey_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Server-side geocode cache (cost control); not readable by members.
CREATE TABLE public.geocode_cache (
  query text PRIMARY KEY,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  formatted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.geocode_cache TO service_role;
ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;