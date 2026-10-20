CREATE TABLE public.wellness_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  session_types text[] NOT NULL DEFAULT ARRAY['mindfulness','breath','body_scan']::text[],
  experience text NOT NULL DEFAULT 'beginner' CHECK (experience IN ('beginner','some','experienced')),
  min_minutes integer NOT NULL DEFAULT 5 CHECK (min_minutes BETWEEN 2 AND 60),
  max_minutes integer NOT NULL DEFAULT 15 CHECK (max_minutes BETWEEN 2 AND 90),
  preferred_time text NOT NULL DEFAULT 'evening' CHECK (preferred_time IN ('morning','midday','evening','any')),
  guidance text NOT NULL DEFAULT 'text' CHECK (guidance IN ('text','audio','timer')),
  sessions_per_week integer NOT NULL DEFAULT 3 CHECK (sessions_per_week BETWEEN 1 AND 14),
  reminders boolean NOT NULL DEFAULT true,
  allow_auto_move boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wellness_preferences TO authenticated;
GRANT ALL ON public.wellness_preferences TO service_role;
ALTER TABLE public.wellness_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage wellness preferences" ON public.wellness_preferences FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER wellness_preferences_touch BEFORE UPDATE ON public.wellness_preferences FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.wellness_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  block_id uuid REFERENCES public.plan_blocks(id) ON DELETE SET NULL,
  session_type text NOT NULL,
  script_key text NOT NULL,
  planned_minutes integer NOT NULL,
  actual_minutes integer NOT NULL CHECK (actual_minutes BETWEEN 0 AND 180),
  completion_state text NOT NULL CHECK (completion_state IN ('completed','partial','stopped')),
  calm_before integer CHECK (calm_before BETWEEN 1 AND 5),
  calm_after integer CHECK (calm_after BETWEEN 1 AND 5),
  useful integer CHECK (useful BETWEEN 1 AND 5),
  note text,
  safety_flag boolean NOT NULL DEFAULT false,
  rule_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wellness_sessions TO authenticated;
GRANT ALL ON public.wellness_sessions TO service_role;
ALTER TABLE public.wellness_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read wellness sessions" ON public.wellness_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX wellness_sessions_user_idx ON public.wellness_sessions(user_id, created_at DESC);