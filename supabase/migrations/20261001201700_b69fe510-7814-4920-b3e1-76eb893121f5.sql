ALTER TABLE public.plan_versions
  ADD COLUMN IF NOT EXISTS apply_mode text CHECK (apply_mode IN ('once','trial','permanent')),
  ADD COLUMN IF NOT EXISTS trial_until date,
  ADD COLUMN IF NOT EXISTS decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 300);

CREATE TABLE public.plan_property_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property text NOT NULL CHECK (char_length(property) BETWEEN 1 AND 120),
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, property)
);
GRANT SELECT, DELETE ON public.plan_property_locks TO authenticated;
GRANT ALL ON public.plan_property_locks TO service_role;
ALTER TABLE public.plan_property_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own locks read" ON public.plan_property_locks FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own locks delete" ON public.plan_property_locks FOR DELETE TO authenticated USING (auth.uid() = user_id);