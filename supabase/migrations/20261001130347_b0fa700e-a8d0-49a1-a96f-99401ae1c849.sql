CREATE TABLE public.training_programmes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  goal text NOT NULL,
  experience text NOT NULL,
  equipment text NOT NULL,
  days_per_week integer NOT NULL,
  session_minutes integer NOT NULL,
  template_key text NOT NULL,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.training_programmes TO authenticated;
GRANT ALL ON public.training_programmes TO service_role;
ALTER TABLE public.training_programmes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own programmes readable" ON public.training_programmes FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.programme_prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  programme_id uuid NOT NULL REFERENCES public.training_programmes(id) ON DELETE CASCADE,
  day_index integer NOT NULL,
  order_index integer NOT NULL,
  exercise_key text NOT NULL,
  sets integer NOT NULL,
  rep_min integer NOT NULL,
  rep_max integer NOT NULL,
  rir_target integer NOT NULL,
  rest_sec integer NOT NULL,
  load_kg numeric,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.programme_prescriptions TO authenticated;
GRANT ALL ON public.programme_prescriptions TO service_role;
ALTER TABLE public.programme_prescriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own prescriptions readable" ON public.programme_prescriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER programme_prescriptions_touch BEFORE UPDATE ON public.programme_prescriptions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.workout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  programme_id uuid REFERENCES public.training_programmes(id) ON DELETE SET NULL,
  day_index integer,
  status text NOT NULL DEFAULT 'in_progress',
  recovery_state text NOT NULL DEFAULT 'UNKNOWN',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  note text
);
GRANT SELECT ON public.workout_sessions TO authenticated;
GRANT ALL ON public.workout_sessions TO service_role;
ALTER TABLE public.workout_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own sessions readable" ON public.workout_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.progression_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  prescription_id uuid NOT NULL REFERENCES public.programme_prescriptions(id) ON DELETE CASCADE,
  rule text NOT NULL,
  prior jsonb NOT NULL,
  next jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.progression_events TO authenticated;
GRANT ALL ON public.progression_events TO service_role;
ALTER TABLE public.progression_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own progression readable" ON public.progression_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER progression_events_immutable BEFORE UPDATE OR DELETE ON public.progression_events FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_changes();

ALTER TABLE public.workout_sets
  ADD COLUMN session_id uuid REFERENCES public.workout_sessions(id) ON DELETE CASCADE,
  ADD COLUMN prescription_id uuid REFERENCES public.programme_prescriptions(id) ON DELETE SET NULL,
  ADD COLUMN set_number integer,
  ADD COLUMN rir numeric;

CREATE INDEX ON public.programme_prescriptions(programme_id, day_index, order_index);
CREATE INDEX ON public.workout_sets(prescription_id, created_at);