ALTER TABLE public.outcome_ledger
  ADD COLUMN outcome_type text NOT NULL DEFAULT 'observation' CHECK (outcome_type IN ('observation','goal_milestone','training_progression','adherence_change','body_nutrition_trend','learning_milestone','wellness_routine','schedule_realism','experiment_result','routine_established')),
  ADD COLUMN block_id uuid REFERENCES public.plan_blocks(id) ON DELETE SET NULL,
  ADD COLUMN plan_version_id uuid REFERENCES public.plan_versions(id) ON DELETE SET NULL,
  ADD COLUMN source_ref text CHECK (source_ref IS NULL OR char_length(source_ref) <= 200),
  ADD COLUMN observation_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN dedupe_key text CHECK (dedupe_key IS NULL OR char_length(dedupe_key) <= 200),
  ADD COLUMN policy_version text;
CREATE UNIQUE INDEX outcome_ledger_dedupe ON public.outcome_ledger(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX outcome_ledger_user_type ON public.outcome_ledger(user_id, outcome_type, observed_at DESC);