ALTER TABLE public.profiles
  ADD COLUMN accountability_level text NOT NULL DEFAULT 'adaptive' CHECK (accountability_level IN ('off','reminders_only','adaptive')),
  ADD COLUMN adaptive_daily_budget integer NOT NULL DEFAULT 6 CHECK (adaptive_daily_budget BETWEEN 0 AND 12);
ALTER TABLE public.notifications ADD COLUMN kind text NOT NULL DEFAULT 'reminder' CHECK (kind IN ('reminder','adaptive'));

CREATE TABLE public.intervention_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  block_id uuid REFERENCES public.plan_blocks(id) ON DELETE SET NULL,
  kind text NOT NULL,
  allowed boolean NOT NULL,
  reason text NOT NULL,
  channels text[] NOT NULL DEFAULT '{}',
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.intervention_decisions (user_id, created_at DESC);
GRANT SELECT ON public.intervention_decisions TO authenticated;
GRANT ALL ON public.intervention_decisions TO service_role;
ALTER TABLE public.intervention_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own intervention decisions" ON public.intervention_decisions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER intervention_decisions_immutable BEFORE UPDATE OR DELETE ON public.intervention_decisions FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_changes();