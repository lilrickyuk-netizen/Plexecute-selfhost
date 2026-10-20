ALTER TABLE public.experiments
  ADD COLUMN question text,
  ADD COLUMN variant_a text,
  ADD COLUMN variant_b text,
  ADD COLUMN confounders text,
  ADD COLUMN end_date date,
  ADD COLUMN min_obs integer NOT NULL DEFAULT 4,
  ADD COLUMN schedule jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN design text NOT NULL DEFAULT 'baseline_test' CHECK (design IN ('baseline_test','ab_blocks')),
  ADD COLUMN safety_checked_at timestamptz,
  ADD COLUMN result jsonb,
  ADD COLUMN policy_version text;
ALTER TABLE public.experiment_entries ADD COLUMN condition text CHECK (condition IN ('A','B'));

DROP POLICY "own rows" ON public.experiments;
CREATE POLICY "Read own experiments" ON public.experiments FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY "own rows" ON public.experiment_entries;
CREATE POLICY "Read own experiment entries" ON public.experiment_entries FOR SELECT TO authenticated USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON public.experiments, public.experiment_entries FROM authenticated;
GRANT ALL ON public.experiments, public.experiment_entries TO service_role;