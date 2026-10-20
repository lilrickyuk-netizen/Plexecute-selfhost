CREATE TABLE public.life_twin_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  domain text NOT NULL CHECK (domain IN ('identity','work','care','sleep','health','training','nutrition','learning','finance','relationships','other')),
  fact_key text NOT NULL CHECK (char_length(fact_key) BETWEEN 1 AND 80),
  fact_value jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('user','calendar','health','wearable','system','professional')),
  confidence numeric NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  is_locked boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  supersedes_id uuid REFERENCES public.life_twin_facts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  UNIQUE (user_id, fact_key, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.life_twin_facts TO authenticated;
GRANT ALL ON public.life_twin_facts TO service_role;
ALTER TABLE public.life_twin_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own twin facts" ON public.life_twin_facts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','superseded')),
  trigger text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('onboarding','goal_change','manual','recovery','calendar_change','system')),
  feasibility text NOT NULL DEFAULT 'feasible' CHECK (feasibility IN ('feasible','partial','infeasible')),
  explanation text,
  diff_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start, version)
);
GRANT SELECT ON public.plan_versions TO authenticated;
GRANT ALL ON public.plan_versions TO service_role;
ALTER TABLE public.plan_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own plan versions read" ON public.plan_versions FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.plan_block_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.plan_blocks(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('acknowledged','started','snoozed','partial','blocked','rescheduled','skipped','completed','safety_stopped','restored')),
  from_status text,
  to_status text NOT NULL,
  reason_code text,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.plan_block_events TO authenticated;
GRANT ALL ON public.plan_block_events TO service_role;
ALTER TABLE public.plan_block_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own block events read" ON public.plan_block_events FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('health_data','calendar_read','calendar_write','email_reminders','phone_calls','professional_share','ai_personalisation')),
  policy_version text NOT NULL CHECK (char_length(policy_version) BETWEEN 1 AND 40),
  action text NOT NULL CHECK (action IN ('granted','withdrawn')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.consent_records TO authenticated;
GRANT ALL ON public.consent_records TO service_role;
ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own consent records read" ON public.consent_records FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.entitlement_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (char_length(capability) BETWEEN 1 AND 80),
  amount integer NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 120),
  period_start timestamptz,
  period_end timestamptz,
  external_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.entitlement_ledger TO authenticated;
GRANT ALL ON public.entitlement_ledger TO service_role;
ALTER TABLE public.entitlement_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own entitlement ledger read" ON public.entitlement_ledger FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user','system','provider','operator')),
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  resource_type text NOT NULL CHECK (char_length(resource_type) BETWEEN 1 AND 80),
  resource_id text,
  outcome text NOT NULL CHECK (outcome IN ('succeeded','failed','denied')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_events TO authenticated;
GRANT ALL ON public.audit_events TO service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own audit events read" ON public.audit_events FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.outcome_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL,
  domain text NOT NULL,
  metric text NOT NULL CHECK (char_length(metric) BETWEEN 1 AND 80),
  value numeric,
  text_value text,
  unit text,
  evidence_class text NOT NULL CHECK (evidence_class IN ('unknown','self_reported','calendar_observed','device_observed','provider_verified')),
  source text NOT NULL,
  confidence numeric NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  observed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (value IS NOT NULL OR text_value IS NOT NULL)
);
GRANT SELECT ON public.outcome_ledger TO authenticated;
GRANT ALL ON public.outcome_ledger TO service_role;
ALTER TABLE public.outcome_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own outcome ledger read" ON public.outcome_ledger FOR SELECT TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.goals
  ADD COLUMN priority integer NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  ADD COLUMN deadline date,
  ADD COLUMN target_metric text,
  ADD COLUMN target_value numeric,
  ADD COLUMN target_unit text,
  ADD COLUMN minimum_weekly_minutes integer NOT NULL DEFAULT 30 CHECK (minimum_weekly_minutes BETWEEN 0 AND 10080),
  ADD COLUMN dependencies uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE public.plan_blocks
  ADD COLUMN plan_version_id uuid REFERENCES public.plan_versions(id) ON DELETE SET NULL,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN interruption_count integer NOT NULL DEFAULT 0 CHECK (interruption_count >= 0),
  ADD COLUMN is_protected boolean NOT NULL DEFAULT false;

CREATE INDEX life_twin_facts_user_key ON public.life_twin_facts(user_id, fact_key, version DESC);
CREATE INDEX plan_versions_user_week ON public.plan_versions(user_id, week_start, version DESC);
CREATE INDEX plan_block_events_block_time ON public.plan_block_events(block_id, occurred_at);
CREATE INDEX consent_records_user_purpose ON public.consent_records(user_id, purpose, occurred_at DESC);
CREATE INDEX entitlement_ledger_user_capability ON public.entitlement_ledger(user_id, capability, created_at DESC);
CREATE INDEX audit_events_user_time ON public.audit_events(user_id, created_at DESC);
CREATE INDEX outcome_ledger_user_time ON public.outcome_ledger(user_id, observed_at DESC);

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER life_twin_facts_touch BEFORE UPDATE ON public.life_twin_facts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.prevent_append_only_changes() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'This record is append-only';
END; $$;
REVOKE EXECUTE ON FUNCTION public.prevent_append_only_changes() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER plan_versions_immutable BEFORE UPDATE OR DELETE ON public.plan_versions FOR EACH ROW WHEN (OLD.status <> 'proposed') EXECUTE FUNCTION public.prevent_append_only_changes();
CREATE TRIGGER plan_block_events_immutable BEFORE UPDATE OR DELETE ON public.plan_block_events FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_changes();
CREATE TRIGGER consent_records_immutable BEFORE UPDATE OR DELETE ON public.consent_records FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_changes();
CREATE TRIGGER entitlement_ledger_immutable BEFORE UPDATE OR DELETE ON public.entitlement_ledger FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_changes();
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_changes();
CREATE TRIGGER outcome_ledger_immutable BEFORE UPDATE OR DELETE ON public.outcome_ledger FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_changes();