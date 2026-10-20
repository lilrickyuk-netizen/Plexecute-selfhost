CREATE TABLE public.safety_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  domain text NOT NULL CHECK (domain IN ('training','nutrition','sleep','wellness','coach','research','calling','ai_input','ai_output','plan_mutation','user')),
  stage text NOT NULL CHECK (stage IN ('input','output','mutation','declaration','clear')),
  state text NOT NULL CHECK (state IN ('NORMAL','CAUTION','BLOCK_SPECIALIST_AUTOMATION','CRISIS_SUPPORT','EMERGENCY_GUIDANCE')),
  signals text[] NOT NULL DEFAULT '{}',
  intervention text NOT NULL,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.safety_events TO authenticated;
GRANT ALL ON public.safety_events TO service_role;
ALTER TABLE public.safety_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own safety events readable" ON public.safety_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER safety_events_immutable BEFORE UPDATE OR DELETE ON public.safety_events FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_changes();
CREATE INDEX safety_events_user_idx ON public.safety_events(user_id, created_at DESC);

CREATE TABLE public.safety_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  signal text NOT NULL CHECK (signal IN ('exercise_red_flag','pain','pregnancy_postpartum','eating_disorder_risk','self_harm_crisis','immediate_danger')),
  source_event_id uuid REFERENCES public.safety_events(id),
  raised_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz
);
GRANT SELECT ON public.safety_flags TO authenticated;
GRANT ALL ON public.safety_flags TO service_role;
ALTER TABLE public.safety_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own safety flags readable" ON public.safety_flags FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE UNIQUE INDEX safety_flags_one_active ON public.safety_flags(user_id, signal) WHERE cleared_at IS NULL;