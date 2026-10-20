ALTER TABLE public.plan_blocks ADD COLUMN original_starts_at timestamptz;
UPDATE public.plan_blocks SET original_starts_at = starts_at WHERE original_starts_at IS NULL;
ALTER TABLE public.plan_blocks ALTER COLUMN original_starts_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_plan_block_integrity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.original_starts_at := coalesce(NEW.original_starts_at, NEW.starts_at);
    IF current_user = 'authenticated' THEN
      NEW.original_starts_at := NEW.starts_at;
      IF NEW.status NOT IN ('planned','scheduled') OR NEW.completed_at IS NOT NULL THEN
        RAISE EXCEPTION 'PLAN_BLOCK_CLIENT_FORBIDDEN';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_user = 'authenticated' THEN RAISE EXCEPTION 'PLAN_BLOCK_CLIENT_FORBIDDEN'; END IF;
    RETURN OLD;
  END IF;
  NEW.original_starts_at := OLD.original_starts_at;
  IF current_user = 'authenticated' AND (
    NEW.status IS DISTINCT FROM OLD.status OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
    OR NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
    OR NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.plan_version_id IS DISTINCT FROM OLD.plan_version_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.duration_min IS DISTINCT FROM OLD.duration_min) THEN
    RAISE EXCEPTION 'PLAN_BLOCK_CLIENT_FORBIDDEN';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_blocks_integrity BEFORE INSERT OR UPDATE OR DELETE ON public.plan_blocks FOR EACH ROW EXECUTE FUNCTION public.guard_plan_block_integrity();

ALTER TABLE public.subscriptions
  ADD COLUMN billing_interval text CHECK (billing_interval IN ('month','year')),
  ADD COLUMN current_period_start timestamptz;

CREATE TABLE public.execution_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id text NOT NULL,
  customer_id text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  plan_version_ids uuid[] NOT NULL DEFAULT '{}',
  required_count integer NOT NULL DEFAULT 0,
  completed_count integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (state IN ('IN_PROGRESS','EARNED','NOT_EARNED','APPLIED','EXPIRED')),
  amount_pence integer NOT NULL DEFAULT 0 CHECK (amount_pence IN (0, 1000)),
  currency text NOT NULL DEFAULT 'gbp',
  earned_at timestamptz,
  decided_at timestamptz,
  applied_at timestamptz,
  provider text NOT NULL DEFAULT 'stripe',
  provider_credit_ref text,
  provider_invoice_ref text,
  next_renewal_ref text,
  apply_attempts integer NOT NULL DEFAULT 0,
  last_error text,
  policy_version text NOT NULL,
  evaluation jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_start),
  UNIQUE (subscription_id, period_start),
  CHECK (period_end > period_start),
  CHECK ((state IN ('EARNED','APPLIED')) = (amount_pence = 1000))
);
CREATE UNIQUE INDEX execution_rewards_credit_ref ON public.execution_rewards (provider_credit_ref) WHERE provider_credit_ref IS NOT NULL;
CREATE UNIQUE INDEX execution_rewards_invoice_ref ON public.execution_rewards (provider_invoice_ref) WHERE provider_invoice_ref IS NOT NULL;
GRANT SELECT ON public.execution_rewards TO authenticated;
GRANT ALL ON public.execution_rewards TO service_role;
ALTER TABLE public.execution_rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own execution rewards" ON public.execution_rewards FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.guard_execution_reward()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_user IN ('authenticated','anon') THEN RAISE EXCEPTION 'REWARD_IMMUTABLE'; END IF;
    RETURN OLD;
  END IF;
  NEW.updated_at := now();
  IF OLD.state = 'IN_PROGRESS' THEN
    IF NEW.state NOT IN ('IN_PROGRESS','EARNED','NOT_EARNED') THEN RAISE EXCEPTION 'REWARD_TRANSITION_INVALID'; END IF;
    RETURN NEW;
  END IF;
  -- Decided results are frozen: counts, period, plan lineage and account ids never change afterwards.
  IF NEW.required_count IS DISTINCT FROM OLD.required_count OR NEW.completed_count IS DISTINCT FROM OLD.completed_count
     OR NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end
     OR NEW.plan_version_ids IS DISTINCT FROM OLD.plan_version_ids OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.amount_pence IS DISTINCT FROM OLD.amount_pence
     OR NEW.evaluation IS DISTINCT FROM OLD.evaluation OR NEW.earned_at IS DISTINCT FROM OLD.earned_at THEN
    RAISE EXCEPTION 'REWARD_IMMUTABLE';
  END IF;
  IF OLD.state = 'NOT_EARNED' AND NEW.state <> 'NOT_EARNED' THEN RAISE EXCEPTION 'REWARD_TRANSITION_INVALID'; END IF;
  IF OLD.state = 'APPLIED' AND (NEW.state <> 'APPLIED' OR NEW.provider_invoice_ref IS DISTINCT FROM OLD.provider_invoice_ref OR NEW.applied_at IS DISTINCT FROM OLD.applied_at OR NEW.provider_credit_ref IS DISTINCT FROM OLD.provider_credit_ref) THEN
    RAISE EXCEPTION 'REWARD_ALREADY_APPLIED';
  END IF;
  IF OLD.state = 'EARNED' AND NEW.state NOT IN ('EARNED','APPLIED','EXPIRED') THEN RAISE EXCEPTION 'REWARD_TRANSITION_INVALID'; END IF;
  IF OLD.provider_credit_ref IS NOT NULL AND NEW.provider_credit_ref IS DISTINCT FROM OLD.provider_credit_ref THEN RAISE EXCEPTION 'REWARD_CREDIT_IMMUTABLE'; END IF;
  IF NEW.state = 'APPLIED' AND (NEW.provider_invoice_ref IS NULL OR NEW.provider_credit_ref IS NULL OR NEW.applied_at IS NULL) THEN
    RAISE EXCEPTION 'REWARD_APPLY_NEEDS_PROVIDER_CONFIRMATION';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER execution_rewards_guard BEFORE UPDATE OR DELETE ON public.execution_rewards FOR EACH ROW EXECUTE FUNCTION public.guard_execution_reward();

ALTER TABLE public.outcome_ledger DROP CONSTRAINT outcome_ledger_outcome_type_check;
ALTER TABLE public.outcome_ledger ADD CONSTRAINT outcome_ledger_outcome_type_check CHECK (outcome_type = ANY (ARRAY['observation','goal_milestone','training_progression','adherence_change','body_nutrition_trend','learning_milestone','wellness_routine','schedule_realism','experiment_result','routine_established','monthly_plan_completed']));