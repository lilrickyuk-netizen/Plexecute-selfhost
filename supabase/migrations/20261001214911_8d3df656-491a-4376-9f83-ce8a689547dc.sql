CREATE TABLE public.meal_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  household integer NOT NULL DEFAULT 1 CHECK (household BETWEEN 1 AND 12),
  prep_minutes integer NOT NULL DEFAULT 90 CHECK (prep_minutes BETWEEN 0 AND 600),
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_version text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meal_plans TO authenticated;
GRANT ALL ON public.meal_plans TO service_role;
ALTER TABLE public.meal_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own meal plans" ON public.meal_plans FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX meal_plans_user_week ON public.meal_plans(user_id, week_start);
CREATE TRIGGER meal_plans_touch BEFORE UPDATE ON public.meal_plans FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();