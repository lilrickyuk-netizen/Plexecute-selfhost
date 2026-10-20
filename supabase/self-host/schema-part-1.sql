-- Plexecute database setup, part 1 of 2.
-- Run the parts in order in Supabase → SQL Editor (paste the whole file, click Run).
-- Each part runs as one transaction: if anything fails, nothing in that part is applied.
-- Contains: supabase/migrations/20261001112920_35836188-b0b9-4d4e-b3b2-e7778a6f1ba5.sql … drizzle/migrations/0024_journey_planning.sql

begin;

create extension if not exists vector with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ===== supabase/migrations/20261001112920_35836188-b0b9-4d4e-b3b2-e7778a6f1ba5.sql =====
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  date_of_birth date,
  coaching_style text NOT NULL DEFAULT 'direct',
  wake_time time NOT NULL DEFAULT '07:00',
  sleep_time time NOT NULL DEFAULT '23:00',
  work_start time DEFAULT '09:00',
  work_end time DEFAULT '17:30',
  work_days int[] NOT NULL DEFAULT '{1,2,3,4,5}',
  life_audit jsonb NOT NULL DEFAULT '{}'::jsonb,
  onboarded boolean NOT NULL DEFAULT false,
  tier text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id AND tier = (SELECT p.tier FROM public.profiles p WHERE p.id = auth.uid()));

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)));
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  domain text NOT NULL DEFAULT 'other',
  why text,
  weekly_minutes int NOT NULL DEFAULT 120,
  session_minutes int NOT NULL DEFAULT 45,
  preferred_time text NOT NULL DEFAULT 'any',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goals TO authenticated;
GRANT ALL ON public.goals TO service_role;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own goals" ON public.goals FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.plan_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id uuid REFERENCES public.goals(id) ON DELETE CASCADE,
  title text NOT NULL,
  domain text NOT NULL DEFAULT 'other',
  starts_at timestamptz NOT NULL,
  duration_min int NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  evidence text NOT NULL DEFAULT 'unknown',
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plan_blocks_user_time ON public.plan_blocks(user_id, starts_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_blocks TO authenticated;
GRANT ALL ON public.plan_blocks TO service_role;
ALTER TABLE public.plan_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own blocks" ON public.plan_blocks FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.coach_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coach_messages_user_time ON public.coach_messages(user_id, created_at);
GRANT SELECT ON public.coach_messages TO authenticated;
GRANT ALL ON public.coach_messages TO service_role;
ALTER TABLE public.coach_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own messages read" ON public.coach_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.daily_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  log_date date NOT NULL DEFAULT current_date,
  kind text NOT NULL,
  value numeric NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_logs TO authenticated;
GRANT ALL ON public.daily_logs TO service_role;
ALTER TABLE public.daily_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own logs" ON public.daily_logs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ===== supabase/migrations/20261001112940_ffab14f9-f090-4088-af72-0b5dc93d1631.sql =====
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
DROP POLICY "own profile update" ON public.profiles;
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE OR REPLACE FUNCTION public.protect_profile_tier() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.tier IS DISTINCT FROM OLD.tier AND current_user = 'authenticated' THEN
    NEW.tier := OLD.tier;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
CREATE TRIGGER profiles_protect_tier BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_tier();

-- ===== supabase/migrations/20261001114038_cd7e3ab3-7685-4197-9540-8bdcab0e6209.sql =====
ALTER TABLE public.profiles
  ADD COLUMN sex text,
  ADD COLUMN height_cm numeric,
  ADD COLUMN activity_level text NOT NULL DEFAULT 'moderate',
  ADD COLUMN nutrition_goal text NOT NULL DEFAULT 'maintain',
  ADD COLUMN theme text NOT NULL DEFAULT 'system';

CREATE TABLE public.workout_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  performed_on date NOT NULL DEFAULT current_date,
  exercise text NOT NULL,
  weight_kg numeric NOT NULL DEFAULT 0,
  reps int NOT NULL,
  rpe numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workout_sets TO authenticated;
GRANT ALL ON public.workout_sets TO service_role;
ALTER TABLE public.workout_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sets" ON public.workout_sets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.food_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  eaten_on date NOT NULL DEFAULT current_date,
  name text NOT NULL,
  kcal numeric NOT NULL DEFAULT 0,
  protein_g numeric NOT NULL DEFAULT 0,
  carbs_g numeric NOT NULL DEFAULT 0,
  fat_g numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_entries TO authenticated;
GRANT ALL ON public.food_entries TO service_role;
ALTER TABLE public.food_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own food" ON public.food_entries FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own messages delete" ON public.coach_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);
GRANT DELETE ON public.coach_messages TO authenticated;

-- ===== supabase/migrations/20261001114900_76fe0816-7b96-4065-9698-0d9c4be9be51.sql =====

ALTER TABLE public.profiles
  ADD COLUMN reminders_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN reminder_lead_min int NOT NULL DEFAULT 10 CHECK (reminder_lead_min BETWEEN 0 AND 120),
  ADD COLUMN email_reminders boolean NOT NULL DEFAULT false,
  ADD COLUMN phone_number text CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{6,14}$'),
  ADD COLUMN calls_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN call_time time NOT NULL DEFAULT '20:00',
  ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/London',
  ADD COLUMN calendar_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN health_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE TABLE public.subscriptions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'stripe',
  customer_id text,
  subscription_id text UNIQUE,
  tier text NOT NULL DEFAULT 'free' CHECK (tier IN ('free','pro','execute')),
  status text NOT NULL DEFAULT 'none',
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  trial_used boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
CREATE POLICY "own sub read" ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.billing_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.billing_events TO service_role;

CREATE TABLE public.recovery_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  check_date date NOT NULL DEFAULT current_date,
  sleep_quality int NOT NULL CHECK (sleep_quality BETWEEN 1 AND 5),
  soreness int NOT NULL CHECK (soreness BETWEEN 1 AND 5),
  stress int NOT NULL CHECK (stress BETWEEN 1 AND 5),
  energy int NOT NULL CHECK (energy BETWEEN 1 AND 5),
  readiness int NOT NULL CHECK (readiness BETWEEN 0 AND 100),
  note text CHECK (char_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, check_date)
);

CREATE TABLE public.experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  hypothesis text NOT NULL CHECK (char_length(hypothesis) <= 500),
  metric text NOT NULL CHECK (char_length(metric) <= 60),
  baseline_days int NOT NULL DEFAULT 7 CHECK (baseline_days BETWEEN 3 AND 28),
  test_days int NOT NULL DEFAULT 14 CHECK (test_days BETWEEN 3 AND 56),
  start_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','abandoned')),
  conclusion text CHECK (char_length(conclusion) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.experiment_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT current_date,
  value numeric NOT NULL,
  note text CHECK (char_length(note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, entry_date)
);

CREATE TABLE public.lesson_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id text NOT NULL CHECK (char_length(lesson_id) <= 60),
  reflection text CHECK (char_length(reflection) <= 1000),
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['recovery_checkins','experiments','experiment_entries','lesson_progress'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY "own rows" ON public.%I FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t);
  END LOOP;
END $$;

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  block_id uuid REFERENCES public.plan_blocks(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('in_app','email','call')),
  title text NOT NULL,
  body text,
  status text NOT NULL DEFAULT 'sent',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (block_id, channel)
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
CREATE POLICY "own notif read" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own notif mark" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  call_sid text UNIQUE,
  status text NOT NULL DEFAULT 'queued',
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.call_logs TO authenticated;
GRANT ALL ON public.call_logs TO service_role;
CREATE POLICY "own calls read" ON public.call_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.health_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL,
  kind text NOT NULL,
  value numeric NOT NULL,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source, kind, recorded_at)
);
ALTER TABLE public.health_samples ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON public.health_samples TO authenticated;
GRANT ALL ON public.health_samples TO service_role;
CREATE POLICY "own health read" ON public.health_samples FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own health delete" ON public.health_samples FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ===== supabase/migrations/20261001123508_31037507-bc40-4c1e-a294-4b2bd05ad3ce.sql =====
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

-- ===== supabase/migrations/20261001123753_4ae25a3d-1974-40a2-8aeb-f77addaba0a2.sql =====
DROP TRIGGER plan_versions_immutable ON public.plan_versions;

CREATE OR REPLACE FUNCTION public.validate_plan_version_change() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Plan versions cannot be deleted';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.week_start IS DISTINCT FROM OLD.week_start
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.trigger IS DISTINCT FROM OLD.trigger
    OR NEW.feasibility IS DISTINCT FROM OLD.feasibility
    OR NEW.explanation IS DISTINCT FROM OLD.explanation
    OR NEW.diff_summary IS DISTINCT FROM OLD.diff_summary
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Plan version content is immutable';
  END IF;
  IF NOT (
    (OLD.status = 'proposed' AND NEW.status IN ('approved','rejected','superseded'))
    OR (OLD.status = 'approved' AND NEW.status = 'superseded')
    OR (OLD.status = NEW.status AND OLD.approved_at IS NOT DISTINCT FROM NEW.approved_at)
  ) THEN
    RAISE EXCEPTION 'Invalid plan version transition';
  END IF;
  IF NEW.status = 'approved' AND NEW.approved_at IS NULL THEN
    RAISE EXCEPTION 'Approved plan versions require an approval time';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.validate_plan_version_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER plan_versions_validate BEFORE UPDATE OR DELETE ON public.plan_versions FOR EACH ROW EXECUTE FUNCTION public.validate_plan_version_change();

-- ===== supabase/migrations/20261001130347_b0fa700e-a8d0-49a1-a96f-99401ae1c849.sql =====
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

-- ===== supabase/migrations/20261001130905_43ec5ebc-c86a-4259-9da4-5237ed16fd48.sql =====
CREATE OR REPLACE FUNCTION public.prevent_append_only_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND current_user NOT IN ('authenticated', 'anon') THEN
    RETURN OLD; -- account erasure (cascade from profile deletion) by privileged roles only
  END IF;
  RAISE EXCEPTION 'This record is append-only';
END; $function$;

-- ===== supabase/migrations/20261001132343_aaca848b-eab7-4034-bf77-e9adbe0da562.sql =====
CREATE TABLE public.user_foods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  brand text,
  source text NOT NULL,
  source_ref text,
  barcode text,
  kcal_100g numeric NOT NULL,
  protein_100g numeric NOT NULL,
  carbs_100g numeric NOT NULL,
  fat_100g numeric NOT NULL,
  fibre_100g numeric,
  serving_g numeric,
  serving_label text,
  allergens text[] NOT NULL DEFAULT '{}',
  favourite boolean NOT NULL DEFAULT false,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source, source_ref)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_foods TO authenticated;
GRANT ALL ON public.user_foods TO service_role;
ALTER TABLE public.user_foods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own foods" ON public.user_foods FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.saved_meals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'meal',
  servings numeric NOT NULL DEFAULT 1,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_meals TO authenticated;
GRANT ALL ON public.saved_meals TO service_role;
ALTER TABLE public.saved_meals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own meals" ON public.saved_meals FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.nutrition_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kcal integer NOT NULL,
  protein_g integer NOT NULL,
  carbs_g integer NOT NULL,
  fat_g integer NOT NULL,
  tdee integer NOT NULL,
  method text NOT NULL,
  confidence text NOT NULL,
  status text NOT NULL DEFAULT 'applied',
  explanation text NOT NULL,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.nutrition_targets TO authenticated;
GRANT ALL ON public.nutrition_targets TO service_role;
ALTER TABLE public.nutrition_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own targets readable" ON public.nutrition_targets FOR SELECT TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.food_entries
  ADD COLUMN grams numeric,
  ADD COLUMN meal_slot text NOT NULL DEFAULT 'snack',
  ADD COLUMN source text NOT NULL DEFAULT 'manual',
  ADD COLUMN food_id uuid REFERENCES public.user_foods(id) ON DELETE SET NULL,
  ADD COLUMN estimated boolean NOT NULL DEFAULT false,
  ADD COLUMN fibre_g numeric;

ALTER TABLE public.profiles
  ADD COLUMN diet_type text NOT NULL DEFAULT 'omnivore',
  ADD COLUMN allergies text[] NOT NULL DEFAULT '{}';

CREATE INDEX ON public.user_foods(user_id, last_used_at DESC);
CREATE INDEX ON public.nutrition_targets(user_id, created_at DESC);

-- ===== supabase/migrations/20261001133234_78b85d31-f6ab-4f27-a3ee-a461fd26dfe5.sql =====
CREATE TABLE public.movement_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('cardio','mobility')),
  modality text NOT NULL,
  level integer NOT NULL DEFAULT 1,
  prescribed jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_min integer NOT NULL CHECK (duration_min BETWEEN 1 AND 600),
  rpe integer CHECK (rpe BETWEEN 1 AND 10),
  tolerance text CHECK (tolerance IN ('easy','right','hard')),
  completed boolean NOT NULL DEFAULT true,
  pain_flag boolean NOT NULL DEFAULT false,
  note text,
  policy_version text NOT NULL,
  performed_on date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.movement_sessions TO authenticated;
GRANT ALL ON public.movement_sessions TO service_role;
ALTER TABLE public.movement_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read movement sessions" ON public.movement_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX movement_sessions_user_idx ON public.movement_sessions(user_id, kind, performed_on DESC);

-- ===== supabase/migrations/20261001134746_68a055f3-25b2-4a56-b8ce-8a339d1c1ab7.sql =====
REVOKE ALL ON public.billing_events FROM anon, authenticated;
GRANT ALL ON public.billing_events TO service_role;
CREATE POLICY "No client access to billing events" ON public.billing_events AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ===== supabase/migrations/20261001184720_81198c53-954a-4a16-972d-a4f769fadeee.sql =====
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

-- ===== supabase/migrations/20261001190316_28fc6a00-ce8c-4f35-889f-1975fd1f19dc.sql =====
CREATE TABLE public.commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('shift','meeting','appointment','family','study','travel','other')),
  recurrence text NOT NULL CHECK (recurrence IN ('weekly','once')),
  days integer[] NOT NULL DEFAULT '{}',
  on_date date,
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_hard boolean NOT NULL DEFAULT true,
  note text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK ((recurrence = 'weekly' AND cardinality(days) > 0 AND days <@ ARRAY[1,2,3,4,5,6,7]) OR (recurrence = 'once' AND on_date IS NOT NULL))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commitments TO authenticated;
GRANT ALL ON public.commitments TO service_role;
ALTER TABLE public.commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage commitments" ON public.commitments FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER commitments_touch BEFORE UPDATE ON public.commitments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== supabase/migrations/20261001192810_d487496e-5d6d-49aa-a98a-71eae46aa8f9.sql =====
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ===== supabase/migrations/20261001192824_676a3178-4f57-4cf3-a2d9-1ad9173812dd.sql =====
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

-- ===== supabase/migrations/20261001193230_7225847b-6783-410f-8770-717b9c0e0fb8.sql =====
-- Skipped: granted admin to the old Lovable account id. Grant admin to your new account after you sign up (see MIGRATION.md).

-- ===== supabase/migrations/20261001193600_e807cb80-a076-40da-9622-c635aad8577a.sql =====
ALTER TABLE public.profiles
  ADD COLUMN units text NOT NULL DEFAULT 'metric' CHECK (units IN ('metric','imperial')),
  ADD COLUMN enabled_domains text[] NOT NULL DEFAULT ARRAY['training','cardio','mobility','nutrition','sleep','learning','career','wellness','work_prep','meal_prep','admin','other'],
  ADD COLUMN intended_use text[] NOT NULL DEFAULT '{}';

-- ===== supabase/migrations/20261001194505_e5d07663-56f8-4e62-9ee1-49922b48b1e8.sql =====
ALTER TABLE public.life_twin_facts ADD COLUMN source_ref text, ADD COLUMN observed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.life_twin_facts ADD CONSTRAINT life_twin_facts_source_chk CHECK (source IN ('USER_ASSERTED','OBSERVED','DERIVED','AI_INFERRED'));

-- ===== supabase/migrations/20261001194627_1138532e-342d-4386-b90e-1bffdf7a1fc3.sql =====
ALTER TABLE public.life_twin_facts DROP CONSTRAINT life_twin_facts_source_check;

-- ===== supabase/migrations/20261001194645_585dbeaa-b523-4009-8aef-e0c050cea3cf.sql =====
ALTER TABLE public.life_twin_facts DROP CONSTRAINT life_twin_facts_domain_check;
ALTER TABLE public.life_twin_facts ADD CONSTRAINT life_twin_facts_domain_check CHECK (domain IN ('identity','work','care','sleep','health','training','nutrition','learning','finance','relationships','other','behaviour','schedule','accountability','integrations','wellness','career','body','activity'));

-- ===== supabase/migrations/20261001200410_7bb92cab-5b8f-4d37-a01c-7a26b99fe6f9.sql =====
ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS baseline_value numeric,
  ADD COLUMN IF NOT EXISTS current_value numeric,
  ADD COLUMN IF NOT EXISTS current_state text,
  ADD COLUMN IF NOT EXISTS target_state text,
  ADD COLUMN IF NOT EXISTS prerequisites text,
  ADD COLUMN IF NOT EXISTS is_protected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE TABLE public.goal_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  target_value numeric,
  due_date date,
  done_at timestamptz,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goal_milestones TO authenticated;
GRANT ALL ON public.goal_milestones TO service_role;
ALTER TABLE public.goal_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own milestones" ON public.goal_milestones FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.goal_metric_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  value numeric NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  source text NOT NULL DEFAULT 'USER_ASSERTED',
  recorded_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.goal_metric_entries TO authenticated;
GRANT ALL ON public.goal_metric_entries TO service_role;
ALTER TABLE public.goal_metric_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own metric entries" ON public.goal_metric_entries FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX ON public.goal_metric_entries (goal_id, recorded_at);
CREATE INDEX ON public.goal_milestones (goal_id, position);

-- ===== supabase/migrations/20261001201700_b69fe510-7814-4920-b3e1-76eb893121f5.sql =====
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

-- ===== supabase/migrations/20261001202410_c9c3502b-64ca-4fbe-9f92-8c92f22e68f8.sql =====
CREATE TABLE public.auto_adapt_permissions (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission IN ('MOVE_NONPROTECTED_TASK_WITHIN_DAY','MOVE_NONPROTECTED_TASK_WITHIN_24H','ADJUST_WORKOUT_LOAD_WITHIN_ENGINE_RULE','ADJUST_NUTRITION_TARGET_WITHIN_150_KCAL_WEEKLY','CHANGE_REMINDER_TIMING')),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);
GRANT SELECT, INSERT, UPDATE ON public.auto_adapt_permissions TO authenticated;
GRANT ALL ON public.auto_adapt_permissions TO service_role;
ALTER TABLE public.auto_adapt_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own auto-adapt permissions" ON public.auto_adapt_permissions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER auto_adapt_touch BEFORE UPDATE ON public.auto_adapt_permissions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== supabase/migrations/20261001203336_c230d10f-7bfe-43d9-ac46-3d87fbceb4ff.sql =====
ALTER TABLE public.plan_blocks
  ADD COLUMN occurrence_kind text NOT NULL DEFAULT 'personal_task',
  ADD COLUMN source_type text NOT NULL DEFAULT 'goal',
  ADD COLUMN source_ref text,
  ADD COLUMN commitment_id uuid REFERENCES public.commitments(id) ON DELETE SET NULL;
ALTER TABLE public.plan_blocks ADD CONSTRAINT plan_blocks_occurrence_kind_chk CHECK (occurrence_kind IN ('wake_for_work','meeting_prep','study','workout','cardio','mobility','meal_prep','meditation','appointment_prep','personal_task','recovery_action','work_task','learning','other'));
ALTER TABLE public.plan_blocks ADD CONSTRAINT plan_blocks_source_type_chk CHECK (source_type IN ('goal','commitment','routine','recovery','makeup','manual'));
CREATE UNIQUE INDEX plan_blocks_source_unique ON public.plan_blocks(user_id, source_type, source_ref) WHERE source_ref IS NOT NULL AND status <> 'rescheduled';
UPDATE public.plan_blocks SET occurrence_kind = CASE domain
  WHEN 'training' THEN 'workout' WHEN 'fitness' THEN 'workout' WHEN 'cardio' THEN 'cardio' WHEN 'mobility' THEN 'mobility'
  WHEN 'wellness' THEN 'meditation' WHEN 'learning' THEN 'learning' WHEN 'study' THEN 'study' WHEN 'work' THEN 'work_task'
  WHEN 'nutrition' THEN 'meal_prep' WHEN 'meal_prep' THEN 'meal_prep' WHEN 'recovery' THEN 'recovery_action' ELSE 'personal_task' END,
  source_type = CASE WHEN note LIKE 'makeup:%' THEN 'makeup' WHEN goal_id IS NULL THEN 'manual' ELSE 'goal' END;
ALTER TABLE public.workout_sessions ADD COLUMN block_id uuid REFERENCES public.plan_blocks(id) ON DELETE SET NULL;

-- ===== supabase/migrations/20261001203521_a30eed6f-c97f-4651-8c8d-7e09dd6f7285.sql =====
UPDATE public.plan_blocks SET occurrence_kind = CASE domain WHEN 'career' THEN 'work_task' WHEN 'work_prep' THEN 'meeting_prep' WHEN 'sleep' THEN 'recovery_action' WHEN 'admin' THEN 'personal_task' ELSE 'other' END
WHERE source_type IN ('goal','manual','makeup') AND occurrence_kind = 'personal_task' AND domain IN ('career','work_prep','sleep','other');

-- ===== supabase/migrations/20261001204039_fb318ec3-9f75-4cec-8c7d-e70073ba8dc3.sql =====
ALTER TABLE public.plan_blocks ADD CONSTRAINT plan_blocks_status_chk CHECK (status IN ('planned','scheduled','upcoming','due','contacting','acknowledged','started','in_progress','done','partial','snoozed','rescheduled','skipped','blocked','expired','cancelled','safety_stopped'));

CREATE OR REPLACE FUNCTION public.validate_plan_block_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE allowed text[];
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  allowed := CASE OLD.status
    WHEN 'planned' THEN ARRAY['scheduled','upcoming','due','contacting','acknowledged','started','in_progress','snoozed','rescheduled','expired','cancelled','done','partial','blocked','skipped','safety_stopped']
    WHEN 'scheduled' THEN ARRAY['upcoming','due','contacting','acknowledged','started','in_progress','snoozed','rescheduled','expired','cancelled','done','partial','blocked','skipped','safety_stopped']
    WHEN 'upcoming' THEN ARRAY['due','contacting','acknowledged','started','in_progress','snoozed','rescheduled','expired','cancelled','done','partial','blocked','skipped','safety_stopped']
    WHEN 'due' THEN ARRAY['contacting','acknowledged','started','in_progress','snoozed','rescheduled','expired','cancelled','done','partial','blocked','skipped','safety_stopped']
    WHEN 'contacting' THEN ARRAY['due','acknowledged','started','in_progress','snoozed','expired','done','partial','blocked','skipped','safety_stopped']
    WHEN 'acknowledged' THEN ARRAY['due','contacting','started','in_progress','snoozed','rescheduled','expired','cancelled','done','partial','blocked','skipped','safety_stopped']
    WHEN 'snoozed' THEN ARRAY['upcoming','due','contacting','acknowledged','started','in_progress','snoozed','rescheduled','expired','cancelled','done','partial','blocked','skipped','safety_stopped']
    WHEN 'started' THEN ARRAY['in_progress','done','partial','blocked','skipped','safety_stopped']
    WHEN 'in_progress' THEN ARRAY['done','partial','blocked','skipped','safety_stopped']
    WHEN 'done' THEN ARRAY['planned','partial']
    WHEN 'partial' THEN ARRAY['planned','done']
    WHEN 'blocked' THEN ARRAY['planned']
    WHEN 'skipped' THEN ARRAY['planned']
    WHEN 'safety_stopped' THEN ARRAY['planned']
    WHEN 'expired' THEN ARRAY['planned','done','partial','skipped']
    ELSE ARRAY[]::text[] END;
  IF NOT (NEW.status = ANY(allowed)) THEN
    RAISE EXCEPTION 'EXECUTION_TRANSITION_INVALID: % -> %', OLD.status, NEW.status USING ERRCODE = 'P0409';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER plan_blocks_validate_transition BEFORE UPDATE OF status ON public.plan_blocks FOR EACH ROW EXECUTE FUNCTION public.validate_plan_block_transition();

ALTER TABLE public.plan_block_events
  ADD COLUMN actor_type text NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user','system','call','device','coach')),
  ADD COLUMN actor_id text,
  ADD COLUMN source_channel text NOT NULL DEFAULT 'app' CHECK (source_channel IN ('app','call','scheduler','workout_log','wellness_log','plan_approval','calendar','api')),
  ADD COLUMN evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX plan_block_events_idem ON public.plan_block_events(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ===== supabase/migrations/20261001204318_2dde3128-cd02-4c43-b1dc-e5aa6d059e70.sql =====
ALTER TABLE public.plan_block_events DROP CONSTRAINT plan_block_events_event_type_check;
ALTER TABLE public.plan_block_events ADD CONSTRAINT plan_block_events_event_type_check CHECK (event_type IN ('acknowledged','started','snoozed','partial','blocked','rescheduled','skipped','completed','safety_stopped','restored','cancelled','expired','acknowledge','start','complete','skip','safety_stop','snooze','restore','cancel','contact','advance','expire'));

-- ===== supabase/migrations/20261001210233_26873832-d760-46fc-9c8e-f7c277df6974.sql =====
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS quiet_start time without time zone NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS quiet_end time without time zone NOT NULL DEFAULT '07:00';

CREATE OR REPLACE FUNCTION public.validate_profile_timezone()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Unknown time zone %', NEW.timezone USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_timezone_valid ON public.profiles;
CREATE TRIGGER profiles_timezone_valid BEFORE INSERT OR UPDATE OF timezone ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_profile_timezone();

-- ===== supabase/migrations/20261001214911_8d3df656-491a-4376-9f83-ce8a689547dc.sql =====
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

-- ===== supabase/migrations/20261001215547_54dc8246-a6a7-4c1a-8a0b-da6cae97bcc8.sql =====
ALTER TABLE public.meal_plans DROP CONSTRAINT IF EXISTS meal_plans_status_check;
ALTER TABLE public.meal_plans ADD CONSTRAINT meal_plans_status_check CHECK (status IN ('proposed','approved','rejected','superseded','active'));
ALTER TABLE public.meal_plans ALTER COLUMN status SET DEFAULT 'proposed';
ALTER TABLE public.meal_plans ADD COLUMN IF NOT EXISTS decision_note text;

-- ===== supabase/migrations/20261001220114_8bfe3fd2-4936-4ad8-bd6d-80f15fc007bd.sql =====
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sleep_target_hours numeric NOT NULL DEFAULT 8 CHECK (sleep_target_hours BETWEEN 4 AND 12);
ALTER TABLE public.recovery_checkins ADD COLUMN IF NOT EXISTS ill_or_injured boolean NOT NULL DEFAULT false;
ALTER TABLE public.recovery_checkins ADD COLUMN IF NOT EXISTS recovery_version text;

-- ===== supabase/migrations/20261001220733_42a6d987-1533-43f5-99af-8cca5e1d691e.sql =====
CREATE TABLE public.learning_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.learning_topics(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  position integer NOT NULL DEFAULT 0,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_topics TO authenticated;
GRANT ALL ON public.learning_topics TO service_role;
ALTER TABLE public.learning_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own topics" ON public.learning_topics FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.learning_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  kind text NOT NULL DEFAULT 'book' CHECK (kind IN ('book','course','video','article','notes','past_paper','other')),
  url text,
  total_units integer CHECK (total_units IS NULL OR total_units > 0),
  done_units integer NOT NULL DEFAULT 0,
  content text CHECK (content IS NULL OR char_length(content) <= 20000),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_resources TO authenticated;
GRANT ALL ON public.learning_resources TO service_role;
ALTER TABLE public.learning_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own resources" ON public.learning_resources FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.retrieval_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES public.learning_topics(id) ON DELETE SET NULL,
  resource_id uuid REFERENCES public.learning_resources(id) ON DELETE SET NULL,
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 1000),
  answer text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 2000),
  generated boolean NOT NULL DEFAULT false,
  interval_step integer NOT NULL DEFAULT 0,
  due_on date NOT NULL DEFAULT current_date,
  policy_version text NOT NULL DEFAULT 'learning_review_v1',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retrieval_items TO authenticated;
GRANT ALL ON public.retrieval_items TO service_role;
ALTER TABLE public.retrieval_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own items" ON public.retrieval_items FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.retrieval_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.retrieval_items(id) ON DELETE CASCADE,
  correct boolean NOT NULL,
  from_step integer NOT NULL,
  to_step integer NOT NULL,
  next_due date NOT NULL,
  policy_version text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.retrieval_reviews TO authenticated;
GRANT ALL ON public.retrieval_reviews TO service_role;
ALTER TABLE public.retrieval_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own reviews" ON public.retrieval_reviews FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.learning_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  kind text NOT NULL DEFAULT 'self_test' CHECK (kind IN ('self_test','mock','exam','assignment')),
  due_on date,
  score numeric CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  evidence text CHECK (evidence IS NULL OR char_length(evidence) <= 1000),
  taken_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_assessments TO authenticated;
GRANT ALL ON public.learning_assessments TO service_role;
ALTER TABLE public.learning_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own assessments" ON public.learning_assessments FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ===== supabase/migrations/20261001221156_8a68abcb-bc7d-434f-b65e-83d77a217b0e.sql =====
CREATE TABLE public.career_research (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL,
  query text NOT NULL CHECK (char_length(query) BETWEEN 3 AND 300),
  jurisdiction text NOT NULL CHECK (char_length(jurisdiction) BETWEEN 2 AND 80),
  status text NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','failed')),
  interpretation text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, DELETE ON public.career_research TO authenticated;
GRANT ALL ON public.career_research TO service_role;
ALTER TABLE public.career_research ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own research" ON public.career_research FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "delete own research" ON public.career_research FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.research_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  research_id uuid NOT NULL REFERENCES public.career_research(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text,
  publisher text NOT NULL,
  trust text NOT NULL CHECK (trust IN ('official','education','professional_body','provider','other')),
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  content_excerpt text
);
GRANT SELECT ON public.research_sources TO authenticated;
GRANT ALL ON public.research_sources TO service_role;
ALTER TABLE public.research_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own sources" ON public.research_sources FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.research_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  research_id uuid NOT NULL REFERENCES public.career_research(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.research_sources(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('qualification','awarding_body','pathway','course','provider','prerequisite','exam_structure','registration','skills','guidance','resource','deadline')),
  statement text NOT NULL,
  quote text NOT NULL,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.research_findings TO authenticated;
GRANT ALL ON public.research_findings TO service_role;
ALTER TABLE public.research_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own findings" ON public.research_findings FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ===== supabase/migrations/20261001221758_a2f0cc31-9786-43d6-b6ce-86dcba4e1edc.sql =====
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE public.knowledge_sources (
  source_id text PRIMARY KEY,
  title text NOT NULL,
  publisher text NOT NULL,
  url text NOT NULL,
  jurisdiction text NOT NULL,
  domain text NOT NULL,
  rights text NOT NULL,
  storage_mode text NOT NULL,
  published date NOT NULL,
  retrieval_method text NOT NULL,
  trust_tier text NOT NULL CHECK (trust_tier IN ('T1','T2','T3','T4')),
  review_cadence_months integer NOT NULL,
  last_reviewed date NOT NULL,
  content_hash text,
  superseded_by text REFERENCES public.knowledge_sources(source_id),
  indexed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.knowledge_sources TO authenticated;
GRANT ALL ON public.knowledge_sources TO service_role;
ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read the source manifest" ON public.knowledge_sources FOR SELECT TO authenticated USING (true);

CREATE TABLE public.knowledge_chunks (
  chunk_id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES public.knowledge_sources(source_id) ON DELETE CASCADE,
  domain text NOT NULL,
  title text NOT NULL,
  text_or_rule text NOT NULL,
  effective_date date NOT NULL,
  embedding extensions.vector(1536),
  embedding_model text,
  indexed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.knowledge_chunks TO authenticated;
GRANT ALL ON public.knowledge_chunks TO service_role;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read knowledge chunks" ON public.knowledge_chunks FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.match_knowledge(query_embedding extensions.vector(1536), match_count integer DEFAULT 8)
RETURNS TABLE(chunk_id text, similarity double precision)
LANGUAGE sql STABLE SET search_path = public, extensions
AS $$
  SELECT c.chunk_id, 1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks c
  JOIN public.knowledge_sources s ON s.source_id = c.source_id
  WHERE c.embedding IS NOT NULL AND s.superseded_by IS NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT least(match_count, 20);
$$;
GRANT EXECUTE ON FUNCTION public.match_knowledge(extensions.vector, integer) TO authenticated, service_role;

-- ===== supabase/migrations/20261001222602_7acf9e22-8fa8-469a-bf2c-cc3bc3c17159.sql =====
ALTER TABLE public.coach_messages ADD COLUMN mode text NOT NULL DEFAULT 'COACH' CHECK (mode IN ('EXPERT','COACH','EXECUTION','REVIEW')),
  ADD COLUMN actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN tool_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN contract jsonb;

CREATE TABLE public.coach_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.coach_messages(id) ON DELETE SET NULL,
  tool text NOT NULL,
  allowed boolean NOT NULL,
  reason text,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.coach_tool_calls TO authenticated;
GRANT ALL ON public.coach_tool_calls TO service_role;
ALTER TABLE public.coach_tool_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read their own coach tool calls" ON public.coach_tool_calls FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX coach_tool_calls_user_tool_idx ON public.coach_tool_calls(user_id, tool, created_at DESC);

-- ===== supabase/migrations/20261001223255_a57fc1e0-fe1c-4f37-b59c-b12f1d534147.sql =====
UPDATE public.profiles SET coaching_style = 'direct' WHERE coaching_style NOT IN ('supportive','direct','disciplined','calm','competitive');
ALTER TABLE public.profiles ADD CONSTRAINT profiles_coaching_style_check CHECK (coaching_style IN ('supportive','direct','disciplined','calm','competitive'));

-- ===== supabase/migrations/20261001223607_bbbd17b2-b386-4581-9db5-38e44216de08.sql =====
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

-- ===== supabase/migrations/20261001225621_5c8f76ff-b97b-4719-93e7-34167037103e.sql =====
CREATE TABLE public.goal_intentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('intention','obstacle','cue')),
  when_text text NOT NULL CHECK (char_length(when_text) BETWEEN 1 AND 200),
  then_text text NOT NULL CHECK (char_length(then_text) BETWEEN 1 AND 200),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goal_intentions TO authenticated;
GRANT ALL ON public.goal_intentions TO service_role;
ALTER TABLE public.goal_intentions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own intentions" ON public.goal_intentions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.goal_reflections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  went_well text,
  got_in_way text,
  change_next text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.goal_reflections TO authenticated;
GRANT ALL ON public.goal_reflections TO service_role;
ALTER TABLE public.goal_reflections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own reflections" ON public.goal_reflections FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.plan_block_events ADD COLUMN missed_reason text CHECK (missed_reason IN ('TIME_CONFLICT','WORK_OVERRUN','FAMILY_COMMITMENT','TRAVEL','LOW_ENERGY','POOR_SLEEP','FORGOT','ENVIRONMENT_UNAVAILABLE','PAIN_OR_INJURY','ILLNESS','MOTIVATION','TASK_TOO_LARGE','PLAN_UNCLEAR','OTHER','DECLINE_TO_SAY'));

-- ===== supabase/migrations/20261001230441_386f94b9-f20b-4a82-b325-aa5ad51baa19.sql =====
CREATE TABLE public.behaviour_feedback (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  observation_key text NOT NULL CHECK (char_length(observation_key) <= 80),
  verdict text NOT NULL CHECK (verdict IN ('hidden','wrong')),
  note text CHECK (char_length(note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, observation_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.behaviour_feedback TO authenticated;
GRANT ALL ON public.behaviour_feedback TO service_role;
ALTER TABLE public.behaviour_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own behaviour feedback" ON public.behaviour_feedback FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ===== supabase/migrations/20261001231024_31991e9d-283a-4269-8c87-af503240ff7b.sql =====
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

-- ===== supabase/migrations/20261002080625_bd2262a8-8fb8-4b8a-b171-f5a400b6d135.sql =====
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

-- ===== supabase/migrations/20261002082709_7c65053e-0c17-4c66-ba1c-e62a1df34a98.sql =====
UPDATE public.plan_blocks SET evidence = CASE evidence WHEN 'workout_log' THEN 'supported' WHEN 'call_confirmed' THEN 'self_reported' WHEN 'self_reported' THEN 'self_reported' WHEN 'verified_external' THEN 'verified_external' WHEN 'supported' THEN 'supported' ELSE 'unknown' END;
ALTER TABLE public.plan_blocks ADD CONSTRAINT plan_blocks_evidence_class CHECK (evidence IN ('verified_external','supported','self_reported','unknown'));
ALTER TABLE public.plan_blocks ADD COLUMN evidence_detail jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.outcome_ledger DROP CONSTRAINT IF EXISTS outcome_ledger_evidence_class_check;
ALTER TABLE public.outcome_ledger ADD CONSTRAINT outcome_ledger_evidence_class_check CHECK (evidence_class IN ('verified_external','supported','self_reported','unknown')) NOT VALID;

CREATE TABLE public.evidence_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.plan_blocks(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('health_activity','workout_session','wellness_session','movement_session','call_log')),
  source_ref text NOT NULL CHECK (char_length(source_ref) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_kind, source_ref)
);
GRANT SELECT ON public.evidence_claims TO authenticated;
GRANT ALL ON public.evidence_claims TO service_role;
ALTER TABLE public.evidence_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own evidence claims" ON public.evidence_claims FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.guard_evidence_class() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.evidence IS DISTINCT FROM OLD.evidence
     AND NEW.evidence IN ('verified_external','supported')
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'EVIDENCE_UPGRADE_FORBIDDEN';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_blocks_guard_evidence BEFORE UPDATE ON public.plan_blocks FOR EACH ROW EXECUTE FUNCTION public.guard_evidence_class();

-- ===== supabase/migrations/20261002085709_6432a045-3a2d-43f2-849c-e32dc498528e.sql =====
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

-- ===== supabase/migrations/20261002090154_843188b9-10e2-4669-bbcb-7c614221ba17.sql =====
REVOKE INSERT, UPDATE, DELETE ON public.outcome_ledger FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.evidence_claims FROM authenticated, anon;

-- ===== supabase/migrations/20261002093557_ef0d8e74-c7d9-4331-a335-c1209a7608ed.sql =====
CREATE TABLE public.calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google','microsoft','device')),
  mode text NOT NULL DEFAULT 'FREE_BUSY_ONLY' CHECK (mode IN ('FREE_BUSY_ONLY','READ_DETAILS','WRITE_PLEXECUTE_BLOCKS','READ_AND_WRITE')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','degraded','revoked','disconnected')),
  account_label text,
  calendar_id_hash text,
  write_calendar_id text,
  all_day_hard boolean NOT NULL DEFAULT false,
  last_sync_at timestamptz,
  last_error text,
  error_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX calendar_connections_live ON public.calendar_connections(user_id, provider) WHERE status <> 'disconnected';
GRANT SELECT ON public.calendar_connections TO authenticated;
GRANT ALL ON public.calendar_connections TO service_role;
ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own calendar connections readable" ON public.calendar_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER calendar_connections_touch BEFORE UPDATE ON public.calendar_connections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.calendar_credentials (
  connection_id uuid PRIMARY KEY REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  sync_cursor text,
  channel_id text,
  channel_resource text,
  channel_expires_at timestamptz,
  webhook_secret text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calendar_credentials_channel ON public.calendar_credentials(channel_id);
GRANT ALL ON public.calendar_credentials TO service_role;
ALTER TABLE public.calendar_credentials ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER calendar_credentials_touch BEFORE UPDATE ON public.calendar_credentials FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.calendar_busy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  event_hash text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  busy boolean NOT NULL DEFAULT true,
  time_zone text,
  calendar_id_hash text,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, event_hash)
);
CREATE INDEX calendar_busy_user_time ON public.calendar_busy(user_id, starts_at);
GRANT SELECT ON public.calendar_busy TO authenticated;
GRANT ALL ON public.calendar_busy TO service_role;
ALTER TABLE public.calendar_busy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own busy times readable" ON public.calendar_busy FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.calendar_event_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.plan_blocks(id) ON DELETE CASCADE,
  external_event_id text,
  idempotency_key text NOT NULL,
  content_hash text,
  state text NOT NULL DEFAULT 'synced' CHECK (state IN ('synced','deleted_externally','moved_externally','removed')),
  external_starts_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, idempotency_key)
);
GRANT SELECT ON public.calendar_event_links TO authenticated;
GRANT ALL ON public.calendar_event_links TO service_role;
ALTER TABLE public.calendar_event_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own calendar links readable" ON public.calendar_event_links FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER calendar_event_links_touch BEFORE UPDATE ON public.calendar_event_links FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== supabase/migrations/20261002093613_09694edd-5d1b-425d-b41e-86a9d2e9a6d3.sql =====
CREATE POLICY "No member access to calendar credentials" ON public.calendar_credentials FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ===== supabase/migrations/20261002095643_50fa0f04-8033-416c-8528-b4d22a11f819.sql =====
CREATE TABLE public.health_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('apple_health','health_connect')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  categories text[] NOT NULL DEFAULT '{}',
  write_enabled boolean NOT NULL DEFAULT false,
  token_hash text NOT NULL UNIQUE,
  last_received_at timestamptz,
  rejected_count integer NOT NULL DEFAULT 0,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX health_connections_one_active ON public.health_connections(user_id, platform) WHERE status = 'active';
GRANT SELECT ON public.health_connections TO authenticated;
GRANT ALL ON public.health_connections TO service_role;
ALTER TABLE public.health_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own health connections read" ON public.health_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER health_connections_touch BEFORE UPDATE ON public.health_connections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.health_samples
  ADD COLUMN connection_id uuid REFERENCES public.health_connections(id) ON DELETE SET NULL,
  ADD COLUMN provider_event_id text,
  ADD COLUMN end_at timestamptz,
  ADD COLUMN unit text,
  ADD COLUMN source_device text,
  ADD COLUMN provider_updated_at timestamptz,
  ADD COLUMN raw_hash text,
  ADD COLUMN is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN possible_duplicate boolean NOT NULL DEFAULT false;
CREATE INDEX health_samples_provider_event ON public.health_samples(user_id, source, provider_event_id) WHERE provider_event_id IS NOT NULL;

-- ===== supabase/migrations/20261002102354_48618638-b30d-4b22-a7f4-adf0a194de91.sql =====
CREATE TABLE public.wearable_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('whoop','oura','fitbit','strava','garmin')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','degraded','revoked','disconnected')),
  external_user_id text,
  scopes text[] NOT NULL DEFAULT '{}',
  last_sync_at timestamptz,
  last_error text,
  error_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wearable_connections_one_live ON public.wearable_connections(user_id, provider) WHERE status <> 'disconnected';
CREATE INDEX wearable_connections_external ON public.wearable_connections(provider, external_user_id);
GRANT SELECT ON public.wearable_connections TO authenticated;
GRANT ALL ON public.wearable_connections TO service_role;
ALTER TABLE public.wearable_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own wearable connections read" ON public.wearable_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER wearable_connections_touch BEFORE UPDATE ON public.wearable_connections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.wearable_credentials (
  connection_id uuid PRIMARY KEY REFERENCES public.wearable_connections(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  pkce_verifier text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.wearable_credentials TO service_role;
ALTER TABLE public.wearable_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no client access to wearable credentials" ON public.wearable_credentials FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER wearable_credentials_touch BEFORE UPDATE ON public.wearable_credentials FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== supabase/migrations/20261002103438_ff6cce34-9b3b-45b6-897c-fb4aa2901df1.sql =====
CREATE TABLE public.professional_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  professional_name text NOT NULL CHECK (char_length(professional_name) BETWEEN 1 AND 80),
  role text NOT NULL CHECK (role IN ('PERSONAL_TRAINER','COACH','DIETITIAN_OR_NUTRITION_PROFESSIONAL','PHYSIOTHERAPY_OR_REHAB_PROFESSIONAL','MENTOR','OTHER_USER_NAMED_PROFESSIONAL')),
  credential_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (credential_status IN ('UNVERIFIED','VERIFIED_BY_PLEXECUTE_PROCESS','USER_ASSERTED')),
  permissions text[] NOT NULL DEFAULT '{}',
  health_consent text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','revoked','expired')),
  invite_token_hash text UNIQUE,
  invite_expires_at timestamptz,
  professional_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.professional_shares TO authenticated;
GRANT ALL ON public.professional_shares TO service_role;
ALTER TABLE public.professional_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads shares" ON public.professional_shares FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER professional_shares_touch BEFORE UPDATE ON public.professional_shares FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.professional_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.professional_shares(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author text NOT NULL CHECK (author IN ('user','professional')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.professional_messages TO authenticated;
GRANT ALL ON public.professional_messages TO service_role;
ALTER TABLE public.professional_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads messages" ON public.professional_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.professional_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.professional_shares(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('constraint','plan_change')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  detail text CHECK (char_length(detail) <= 2000),
  schedule jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','blocked','ended')),
  safety_reason text,
  commitment_id uuid REFERENCES public.commitments(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.professional_proposals TO authenticated;
GRANT ALL ON public.professional_proposals TO service_role;
ALTER TABLE public.professional_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads proposals" ON public.professional_proposals FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER professional_proposals_touch BEFORE UPDATE ON public.professional_proposals FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== supabase/migrations/20261002104952_8681b6e5-4f93-456e-b26d-f2a0f276de72.sql =====
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_channel_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_channel_check CHECK (channel IN ('in_app','push','email','call'));
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_block_id_channel_key;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('reminder','adaptive','system'));
ALTER TABLE public.notifications
  ADD COLUMN category text NOT NULL DEFAULT 'UPCOMING' CHECK (category IN ('UPCOMING','DUE','MISSED','PLAN_CHANGED','WEEKLY_REVIEW','EXPERIMENT','ACCOUNT','BILLING','SAFETY')),
  ADD COLUMN intent text NOT NULL DEFAULT 'session_reminder',
  ADD COLUMN plan_version_id uuid REFERENCES public.plan_versions(id) ON DELETE SET NULL,
  ADD COLUMN dedupe_key text,
  ADD COLUMN scheduled_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN provider_result jsonb,
  ADD COLUMN last_error text,
  ADD COLUMN interaction text CHECK (interaction IN ('opened','acted','dismissed')),
  ADD COLUMN interaction_at timestamptz,
  ADD COLUMN link text;
UPDATE public.notifications SET dedupe_key = coalesce(block_id::text, id::text) || ':' || channel || ':' || kind,
  sent_at = created_at, category = CASE WHEN kind = 'adaptive' THEN 'DUE' ELSE 'UPCOMING' END,
  intent = CASE WHEN kind = 'adaptive' THEN 'due_nudge' ELSE 'session_reminder' END;
ALTER TABLE public.notifications ALTER COLUMN dedupe_key SET NOT NULL;
ALTER TABLE public.notifications ALTER COLUMN status SET DEFAULT 'queued';
ALTER TABLE public.notifications ADD CONSTRAINT notifications_status_check CHECK (status IN ('queued','sending','sent','failed','retrying','skipped','suppressed'));
CREATE UNIQUE INDEX notifications_dedupe ON public.notifications (user_id, dedupe_key);
CREATE INDEX notifications_due ON public.notifications (status, next_attempt_at) WHERE status IN ('queued','retrying');

CREATE TABLE public.push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('expo','apns','fcm')),
  token text NOT NULL,
  device_name text CHECK (char_length(device_name) <= 80),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invalid','removed')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, token)
);
GRANT SELECT ON public.push_devices TO authenticated;
GRANT ALL ON public.push_devices TO service_role;
ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own push devices" ON public.push_devices FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.notification_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('UPCOMING','DUE','MISSED','PLAN_CHANGED','WEEKLY_REVIEW','EXPERIMENT','ACCOUNT','BILLING','SAFETY')),
  in_app boolean NOT NULL DEFAULT true,
  push boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own notification prefs" ON public.notification_preferences FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER notification_preferences_touch BEFORE UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== supabase/migrations/20261002105731_a98ec055-4e91-4b8e-8c00-3bd5eb20c4ff.sql =====
CREATE TABLE public.phone_numbers (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  e164_enc text NOT NULL,
  last4 text NOT NULL CHECK (char_length(last4) = 4),
  country text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.phone_numbers TO service_role;
ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER phone_numbers_touch BEFORE UPDATE ON public.phone_numbers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.call_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  block_id uuid REFERENCES public.plan_blocks(id) ON DELETE SET NULL,
  policy text NOT NULL CHECK (policy IN ('pro','execute')),
  trigger text NOT NULL CHECK (trigger IN ('due','call_now','missed','morning','evening')),
  state text NOT NULL DEFAULT 'CALL_QUEUED' CHECK (state IN ('CALL_ELIGIBLE','CALL_QUEUED','CALL_CREATED','RINGING','ANSWERED_PENDING_HUMAN','HUMAN_CONNECTED','MACHINE_DETECTED','NO_ANSWER','BUSY','FAILED','CANCELLED','ACKNOWLEDGED','RETRY_SCHEDULED','RETRY_POLICY_PAUSED','ALLOWANCE_EXHAUSTED')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  next_attempt_at timestamptz,
  service_month_start timestamptz NOT NULL,
  consumed_at timestamptz,
  connected_seconds integer NOT NULL DEFAULT 0,
  acknowledgement text CHECK (acknowledgement IN ('START_NOW','SNOOZE','RESCHEDULE','SKIP_WITH_REASON','BLOCKED','STOP_CALLING_FOR_THIS_TASK','STOP_ALL_CALLS')),
  stop_reason text,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX call_campaigns_due ON public.call_campaigns (state, next_attempt_at);
CREATE INDEX call_campaigns_month ON public.call_campaigns (user_id, service_month_start);
GRANT SELECT ON public.call_campaigns TO authenticated;
GRANT ALL ON public.call_campaigns TO service_role;
ALTER TABLE public.call_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own call campaigns" ON public.call_campaigns FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER call_campaigns_touch BEFORE UPDATE ON public.call_campaigns FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.call_logs
  ADD COLUMN campaign_id uuid REFERENCES public.call_campaigns(id) ON DELETE CASCADE,
  ADD COLUMN attempt_no integer,
  ADD COLUMN provider_status text,
  ADD COLUMN answered_by text,
  ADD COLUMN duration_sec integer,
  ADD COLUMN connected_seconds integer NOT NULL DEFAULT 0;

ALTER TABLE public.plan_blocks ADD COLUMN call_requested boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles
  ADD COLUMN calls_stopped_at timestamptz,
  ADD COLUMN call_consent_version text,
  ADD COLUMN call_consent_at timestamptz;

-- ===== supabase/migrations/20261002111321_1e207228-4770-46a9-9bf9-2dc0fe396fe6.sql =====
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

-- ===== supabase/migrations/20261002111639_0c33780e-53d4-4db9-aee5-5729eb4354ef.sql =====
ALTER TABLE public.plan_blocks ALTER COLUMN original_starts_at SET DEFAULT now();
CREATE OR REPLACE FUNCTION public.guard_plan_block_integrity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.original_starts_at := NEW.starts_at;
    IF current_user = 'authenticated' AND (NEW.status NOT IN ('planned','scheduled') OR NEW.completed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'PLAN_BLOCK_CLIENT_FORBIDDEN';
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

-- ===== supabase/migrations/20261002112723_9cb6e849-9168-4fa9-9e90-957f71e62b16.sql =====
ALTER TABLE public.profiles
  ADD COLUMN call_morning_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN call_morning_time time NOT NULL DEFAULT '08:00',
  ADD COLUMN call_due_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN call_missed_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN call_evening_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN call_evening_time time NOT NULL DEFAULT '20:00',
  ADD COLUMN call_max_attempts integer NOT NULL DEFAULT 6 CHECK (call_max_attempts BETWEEN 1 AND 6);
UPDATE public.profiles SET call_evening_enabled = calls_enabled, call_evening_time = call_time WHERE tier = 'execute';

-- ===== supabase/migrations/20261002125659_82c580c6-8816-4899-bdad-563c0c75fb8b.sql =====
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS call_allowed_kinds text[] NULL,
  ADD COLUMN IF NOT EXISTS call_max_minutes integer NOT NULL DEFAULT 3 CHECK (call_max_minutes BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS call_voicemail_policy text NOT NULL DEFAULT 'none' CHECK (call_voicemail_policy IN ('none','generic')),
  ADD COLUMN IF NOT EXISTS call_style text NULL CHECK (call_style IS NULL OR call_style IN ('supportive','direct','disciplined','calm','competitive'));

-- ===== supabase/migrations/20261002130049_a41e14f5-76a8-4716-9107-fe66bae9aac3.sql =====
ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS voice_provider text NULL CHECK (voice_provider IS NULL OR voice_provider IN ('openai','gemini','degraded')),
  ADD COLUMN IF NOT EXISTS voice_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_end_reason text NULL,
  ADD COLUMN IF NOT EXISTS voice_failovers integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tool_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS summary text NULL;

-- ===== supabase/migrations/20261002130549_d0d4bd28-16c8-42d7-a895-a65a90c57dfb.sql =====
CREATE TABLE public.call_market_manifest (
  country text PRIMARY KEY CHECK (country ~ '^([A-Z]{2}|GLOBAL)$'),
  enabled boolean NOT NULL DEFAULT false,
  killed boolean NOT NULL DEFAULT false,
  signed_off_by text NULL,
  signed_off_at timestamptz NULL,
  review_ref text NULL,
  permitted_start time NULL,
  permitted_end time NULL,
  consent_version text NULL,
  disclosure_version text NULL,
  max_attempts_per_occurrence integer NULL CHECK (max_attempts_per_occurrence IS NULL OR max_attempts_per_occurrence BETWEEN 1 AND 6),
  max_per_24h integer NULL CHECK (max_per_24h IS NULL OR max_per_24h BETWEEN 1 AND 12),
  pro_retry_allowed boolean NOT NULL DEFAULT true,
  min_answer_rate numeric NULL CHECK (min_answer_rate IS NULL OR (min_answer_rate >= 0 AND min_answer_rate <= 1)),
  notes text NULL,
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR (signed_off_by IS NOT NULL AND signed_off_at IS NOT NULL AND review_ref IS NOT NULL AND consent_version IS NOT NULL AND disclosure_version IS NOT NULL AND permitted_start IS NOT NULL AND permitted_end IS NOT NULL))
);
GRANT ALL ON public.call_market_manifest TO service_role;
ALTER TABLE public.call_market_manifest ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER call_market_manifest_touch BEFORE UPDATE ON public.call_market_manifest FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
INSERT INTO public.call_market_manifest (country, enabled, killed, notes) VALUES ('GLOBAL', false, false, 'Global kill switch row. killed=true stops every automated call in every market.');

-- ===== supabase/migrations/20261002132308_de8cdc19-ca1e-47fa-85c7-8f50dc89d924.sql =====
ALTER TABLE public.workout_sets ADD COLUMN IF NOT EXISTS client_op_id text, ADD COLUMN IF NOT EXISTS client_recorded_at timestamptz;
ALTER TABLE public.food_entries ADD COLUMN IF NOT EXISTS client_op_id text, ADD COLUMN IF NOT EXISTS client_recorded_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS workout_sets_client_op_uniq ON public.workout_sets(user_id, client_op_id) WHERE client_op_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS food_entries_client_op_uniq ON public.food_entries(user_id, client_op_id) WHERE client_op_id IS NOT NULL;

-- ===== supabase/migrations/20261002133029_16603b6a-9616-4a5e-aecd-576fab1ae662.sql =====
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reduce_motion boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS text_size text NOT NULL DEFAULT 'standard' CHECK (text_size IN ('standard','large','larger')),
  ADD COLUMN IF NOT EXISTS high_contrast boolean NOT NULL DEFAULT false;

-- ===== supabase/migrations/20261002133830_24cc1bf8-f3d9-45bc-908e-90d1079ac77d.sql =====
ALTER TABLE public.consent_records
  ADD COLUMN IF NOT EXISTS scope text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS subject_id uuid;
CREATE INDEX IF NOT EXISTS consent_records_user_purpose ON public.consent_records (user_id, purpose, subject_id, created_at DESC);

-- ===== supabase/migrations/20261002165041_00afb65b-949e-45d0-aae2-b85ce63c9509.sql =====
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS processing_restricted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS processing_restricted_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active' CHECK (account_status IN ('active','deletion_pending'));

CREATE TABLE public.data_rights_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('access','rectification','erasure','restriction','objection','portability','consent_withdrawal','complaint')),
  details text,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','in_progress','paused','completed','rejected','withdrawn')),
  identity_check text NOT NULL DEFAULT 'signed_in_session',
  received_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL DEFAULT (now() + interval '28 days'),
  paused_reason text,
  search_scope text[],
  response text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.data_rights_requests TO authenticated;
GRANT ALL ON public.data_rights_requests TO service_role;
ALTER TABLE public.data_rights_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rights requests" ON public.data_rights_requests FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX ON public.data_rights_requests (user_id, received_at DESC);

-- Deletion jobs outlive the account (no FK) so completion stays auditable without personal content.
CREATE TABLE public.deletion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_ref text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','revoking','purging','completed','failed')),
  steps jsonb NOT NULL DEFAULT '[]',
  requested_at timestamptz NOT NULL DEFAULT now(),
  purge_by timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  completed_at timestamptz,
  error text
);
GRANT ALL ON public.deletion_jobs TO service_role;
ALTER TABLE public.deletion_jobs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.retention_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  removed jsonb NOT NULL DEFAULT '{}'
);
GRANT ALL ON public.retention_runs TO service_role;
ALTER TABLE public.retention_runs ENABLE ROW LEVEL SECURITY;

-- V3 §79 locked retention schedule.
CREATE OR REPLACE FUNCTION public.apply_retention()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb := '{}'; n int;
BEGIN
  DELETE FROM coach_messages WHERE created_at < now() - interval '12 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('coach_messages', n);
  DELETE FROM notifications WHERE created_at < now() - interval '12 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('notifications', n);
  DELETE FROM call_logs WHERE created_at < now() - interval '24 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('call_logs', n);
  DELETE FROM call_campaigns WHERE created_at < now() - interval '24 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('call_campaigns', n);
  DELETE FROM health_samples WHERE created_at < now() - interval '24 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('health_samples', n);
  DELETE FROM audit_events WHERE created_at < now() - interval '24 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('audit_events', n);
  DELETE FROM safety_events WHERE created_at < now() - interval '24 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('safety_events', n);
  DELETE FROM coach_tool_calls WHERE created_at < now() - interval '90 days'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('coach_tool_calls', n);
  DELETE FROM retention_runs WHERE ran_at < now() - interval '24 months';
  INSERT INTO retention_runs (removed) VALUES (r);
  RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION public.apply_retention() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_retention() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('plexecute-retention-daily', '17 3 * * *', $$SELECT public.apply_retention()$$);

-- ===== supabase/migrations/20261002170006_9e691b24-2dc6-43fd-810c-70b8f503218e.sql =====
CREATE TABLE public.rate_limits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  hits int NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
GRANT ALL ON public.rate_limits TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Fixed-window counter; returns true when the call is allowed. Old windows are pruned by the daily retention run.
CREATE OR REPLACE FUNCTION public.hit_rate_limit(_bucket text, _window_seconds int, _max int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws timestamptz := to_timestamp(floor(extract(epoch FROM now()) / _window_seconds) * _window_seconds); n int;
BEGIN
  INSERT INTO rate_limits (bucket, window_start, hits) VALUES (_bucket, ws, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limits.hits + 1
  RETURNING hits INTO n;
  RETURN n <= _max;
END $$;
REVOKE EXECUTE ON FUNCTION public.hit_rate_limit(text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hit_rate_limit(text, int, int) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_retention()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb := '{}'; n int;
BEGIN
  DELETE FROM coach_messages WHERE created_at < now() - interval '12 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('coach_messages', n);
  DELETE FROM notifications WHERE created_at < now() - interval '12 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('notifications', n);
  DELETE FROM call_logs WHERE created_at < now() - interval '24 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('call_logs', n);
  DELETE FROM call_campaigns WHERE created_at < now() - interval '24 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('call_campaigns', n);
  DELETE FROM health_samples WHERE created_at < now() - interval '24 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('health_samples', n);
  DELETE FROM audit_events WHERE created_at < now() - interval '24 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('audit_events', n);
  DELETE FROM safety_events WHERE created_at < now() - interval '24 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('safety_events', n);
  DELETE FROM coach_tool_calls WHERE created_at < now() - interval '90 days'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('coach_tool_calls', n);
  DELETE FROM rate_limits WHERE window_start < now() - interval '1 day';
  DELETE FROM retention_runs WHERE ran_at < now() - interval '24 months';
  INSERT INTO retention_runs (removed) VALUES (r);
  RETURN r;
END $$;

-- ===== supabase/migrations/20261002171457_06aceaab-4044-4d8f-a0ef-5794c8a71aa3.sql =====
CREATE TABLE public.background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','retrying','succeeded','dead')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text,
  result jsonb,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX background_jobs_due ON public.background_jobs (status, next_attempt_at);
CREATE INDEX background_jobs_kind ON public.background_jobs (kind, created_at DESC);
GRANT ALL ON public.background_jobs TO service_role;
REVOKE ALL ON public.background_jobs FROM anon, authenticated;
ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to background jobs" ON public.background_jobs AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE TABLE public.background_job_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.background_jobs(id) ON DELETE CASCADE,
  event text NOT NULL,
  attempt int NOT NULL DEFAULT 0,
  detail text,
  actor text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX background_job_events_job ON public.background_job_events (job_id, created_at);
GRANT ALL ON public.background_job_events TO service_role;
REVOKE ALL ON public.background_job_events FROM anon, authenticated;
ALTER TABLE public.background_job_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to job events" ON public.background_job_events AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.touch_background_job() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER background_jobs_updated BEFORE UPDATE ON public.background_jobs FOR EACH ROW EXECUTE FUNCTION public.touch_background_job();

-- Completed job records are kept 90 days; dead ones stay until replayed or reviewed.
SELECT cron.schedule('plexecute-jobs-prune-daily', '41 3 * * *', $$DELETE FROM public.background_jobs WHERE status = 'succeeded' AND finished_at < now() - interval '90 days'$$);

-- ===== supabase/migrations/20261002172619_e1526244-6d11-46cf-8821-d28efaf6af87.sql =====
CREATE TABLE public.error_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('server','client','job')),
  fingerprint text NOT NULL,
  route text,
  message text NOT NULL,
  request_id text,
  user_ref text,
  release text,
  forwarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX error_events_recent ON public.error_events (created_at DESC);
GRANT ALL ON public.error_events TO service_role;
REVOKE ALL ON public.error_events FROM anon, authenticated;
ALTER TABLE public.error_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to error events" ON public.error_events AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

CREATE TABLE public.provider_calls (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL,
  ok boolean NOT NULL,
  status int,
  latency_ms int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_calls_recent ON public.provider_calls (provider, created_at DESC);
GRANT ALL ON public.provider_calls TO service_role;
REVOKE ALL ON public.provider_calls FROM anon, authenticated;
ALTER TABLE public.provider_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to provider calls" ON public.provider_calls AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

SELECT cron.schedule('plexecute-observability-prune-daily', '53 3 * * *', $$DELETE FROM public.error_events WHERE created_at < now() - interval '30 days'; DELETE FROM public.provider_calls WHERE created_at < now() - interval '30 days'$$);

-- ===== supabase/migrations/20261002173157_1e50bab8-e09a-4c63-b34a-136d691596ea.sql =====
CREATE TABLE public.feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  cap_value integer,
  note text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.feature_flags TO service_role;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.admin_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  action text NOT NULL,
  target_ref text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.admin_access_log TO service_role;
ALTER TABLE public.admin_access_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX admin_access_log_created ON public.admin_access_log (created_at DESC);

CREATE TABLE public.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  member_message text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('minor','major','critical')),
  status text NOT NULL DEFAULT 'investigating' CHECK (status IN ('investigating','monitoring','resolved')),
  affected text[] NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.incidents TO authenticated;
GRANT ALL ON public.incidents TO service_role;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members see open incidents" ON public.incidents FOR SELECT TO authenticated USING (status <> 'resolved');

-- ===== supabase/migrations/20261002182605_c54a6d13-793c-4377-90c2-a8d117cae01c.sql =====
CREATE TABLE public.support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('account','billing','plan','calls','integrations','bug','other')),
  message text NOT NULL,
  tier text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('standard','priority')),
  target_label text NOT NULL,
  diagnostics jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.support_requests TO authenticated;
GRANT ALL ON public.support_requests TO service_role;
ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read own support requests" ON public.support_requests FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX support_requests_user ON public.support_requests (user_id, created_at DESC);

-- ===== supabase/migrations/20261002184637_b24ad91f-12aa-494f-8f63-a03e39187ff0.sql =====
ALTER TABLE public.plan_versions ADD COLUMN IF NOT EXISTS engine_versions jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ===== supabase/migrations/20261002185852_1d66ea9f-fa74-4137-b26c-dbfaa56b8dca.sql =====
DROP POLICY IF EXISTS "own food" ON public.food_entries;
REVOKE INSERT, UPDATE ON public.food_entries FROM authenticated;
CREATE POLICY "own food read" ON public.food_entries FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own food delete" ON public.food_entries FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ===== supabase/migrations/20261002191532_3623af90-f60f-43e8-b65d-d4cfd8a98cb8.sql =====
DROP POLICY IF EXISTS "own sets" ON public.workout_sets;
REVOKE INSERT, UPDATE, DELETE ON public.workout_sets FROM authenticated;
CREATE POLICY "own sets read" ON public.workout_sets FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ===== supabase/migrations/20261002192029_d24a8e54-f655-4165-a26a-58e50d910f99.sql =====
CREATE OR REPLACE FUNCTION public.guard_twin_fact_provenance()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.source <> 'USER_ASSERTED' THEN RAISE EXCEPTION 'Members can only add facts they state themselves' USING ERRCODE = '42501'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.source IS DISTINCT FROM OLD.source OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
     OR NEW.fact_value IS DISTINCT FROM OLD.fact_value OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.observed_at IS DISTINCT FROM OLD.observed_at OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.domain IS DISTINCT FROM OLD.domain OR NEW.fact_key IS DISTINCT FROM OLD.fact_key
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id THEN
    RAISE EXCEPTION 'Facts are corrected by adding a new version, not by editing history' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER life_twin_facts_provenance BEFORE INSERT OR UPDATE ON public.life_twin_facts FOR EACH ROW EXECUTE FUNCTION public.guard_twin_fact_provenance();

-- ===== supabase/migrations/20261002192858_40e1ac36-aa00-4526-8bfc-f85da816fdc9.sql =====
CREATE OR REPLACE FUNCTION public.protect_profile_tier()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    NEW.tier := OLD.tier;
    NEW.call_consent_version := OLD.call_consent_version;
    NEW.call_consent_at := OLD.call_consent_at;
    NEW.calls_stopped_at := OLD.calls_stopped_at;
    NEW.processing_restricted := OLD.processing_restricted;
    NEW.processing_restricted_at := OLD.processing_restricted_at;
    NEW.account_status := OLD.account_status;
    NEW.calendar_token := OLD.calendar_token;
    NEW.health_token := OLD.health_token;
    IF OLD.date_of_birth IS NOT NULL THEN
      NEW.date_of_birth := OLD.date_of_birth;
    ELSIF NEW.date_of_birth IS NOT NULL AND NEW.date_of_birth > (current_date - interval '18 years')::date THEN
      RAISE EXCEPTION 'Plexecute is for adults aged 18 and over' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

-- ===== supabase/migrations/20261002193134_224142b3-ce54-47b3-a2fb-e4b990768ac7.sql =====
CREATE OR REPLACE FUNCTION public.guard_notification_member_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user = 'authenticated' AND (to_jsonb(NEW) - 'read_at' - 'interaction' - 'interaction_at') IS DISTINCT FROM (to_jsonb(OLD) - 'read_at' - 'interaction' - 'interaction_at') THEN
    RAISE EXCEPTION 'Only read and response details of a notification can be changed' USING ERRCODE = '42501';
  END IF;
  IF current_user = 'authenticated' AND NEW.interaction IS NOT NULL AND NEW.interaction NOT IN ('opened','dismissed','snoozed','acted') THEN
    RAISE EXCEPTION 'Unknown response' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notifications_member_update BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.guard_notification_member_update();

-- ===== supabase/migrations/20261009000919_88585d78-f9be-43fc-b610-2b4b8a84e95f.sql =====
-- Keep only the newest applied and newest proposed nutrition target per member.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY user_id, status ORDER BY created_at DESC, id DESC) AS rn
  FROM public.nutrition_targets WHERE status IN ('applied','proposed')
)
UPDATE public.nutrition_targets t SET status = 'superseded' FROM ranked r WHERE t.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS nutrition_targets_one_applied ON public.nutrition_targets (user_id) WHERE status = 'applied';
CREATE UNIQUE INDEX IF NOT EXISTS nutrition_targets_one_proposed ON public.nutrition_targets (user_id) WHERE status = 'proposed';

-- ===== drizzle/migrations/0000_free_tier_goal_limit.sql =====
CREATE OR REPLACE FUNCTION public.enforce_free_goal_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_tier text;
  active_count int;
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;
  SELECT tier INTO user_tier FROM public.profiles WHERE id = NEW.user_id;
  IF user_tier IS DISTINCT FROM 'free' THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO active_count FROM public.goals
  WHERE user_id = NEW.user_id AND status = 'active' AND id IS DISTINCT FROM NEW.id;
  IF active_count >= 3 THEN
    RAISE EXCEPTION 'Free includes up to 3 active goals. Pause or complete one, or upgrade for unlimited goals.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER goals_free_limit
BEFORE INSERT OR UPDATE OF status ON public.goals
FOR EACH ROW EXECUTE FUNCTION public.enforce_free_goal_limit();

-- ===== drizzle/migrations/0001_free_ai_budget.sql =====
CREATE TABLE public.ai_usage (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day date NOT NULL,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

GRANT ALL ON public.ai_usage TO service_role;

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- Atomically check and reserve part of the Free daily AI budget (spec 5.2: 25,000 input + 5,000 output tokens per user-local day).
-- Returns TRUE when the reservation fits inside the budget, FALSE when the budget is already used up.
CREATE OR REPLACE FUNCTION public.reserve_ai_budget(_user_id uuid, _day date, _in int, _out int, _max_in int, _max_out int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE cur_in int; cur_out int;
BEGIN
  INSERT INTO public.ai_usage (user_id, day) VALUES (_user_id, _day)
  ON CONFLICT (user_id, day) DO NOTHING;
  SELECT input_tokens, output_tokens INTO cur_in, cur_out FROM public.ai_usage WHERE user_id = _user_id AND day = _day FOR UPDATE;
  IF cur_in + _in > _max_in OR cur_out + _out > _max_out THEN
    RETURN FALSE;
  END IF;
  UPDATE public.ai_usage SET input_tokens = input_tokens + _in, output_tokens = output_tokens + _out WHERE user_id = _user_id AND day = _day;
  RETURN TRUE;
END;
$$;

-- ===== drizzle/migrations/0002_add_user_id_indexes.sql =====
CREATE INDEX IF NOT EXISTS billing_events_time ON public.billing_events (received_at DESC);
CREATE INDEX IF NOT EXISTS career_research_user ON public.career_research (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commitments_user ON public.commitments (user_id);
CREATE INDEX IF NOT EXISTS daily_logs_user ON public.daily_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS goal_intentions_user ON public.goal_intentions (user_id, goal_id);
CREATE INDEX IF NOT EXISTS goal_reflections_user ON public.goal_reflections (user_id, goal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS goals_user ON public.goals (user_id, status);
CREATE INDEX IF NOT EXISTS learning_assessments_user ON public.learning_assessments (user_id, goal_id);
CREATE INDEX IF NOT EXISTS learning_resources_user ON public.learning_resources (user_id, goal_id);
CREATE INDEX IF NOT EXISTS learning_topics_user ON public.learning_topics (user_id, goal_id);
CREATE INDEX IF NOT EXISTS professional_messages_share ON public.professional_messages (share_id, created_at);
CREATE INDEX IF NOT EXISTS professional_proposals_share ON public.professional_proposals (share_id, created_at DESC);
CREATE INDEX IF NOT EXISTS progression_events_user ON public.progression_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_findings_research ON public.research_findings (research_id);
CREATE INDEX IF NOT EXISTS research_sources_research ON public.research_sources (research_id);
CREATE INDEX IF NOT EXISTS retrieval_items_user ON public.retrieval_items (user_id, goal_id);
CREATE INDEX IF NOT EXISTS retrieval_reviews_user ON public.retrieval_reviews (user_id);
CREATE INDEX IF NOT EXISTS saved_meals_user ON public.saved_meals (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS training_programmes_user ON public.training_programmes (user_id, status);
CREATE INDEX IF NOT EXISTS workout_sessions_user ON public.workout_sessions (user_id, programme_id, status);

-- ===== drizzle/migrations/0003_usage_events.sql =====
CREATE TABLE public.usage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid,
  service_month date NOT NULL,
  tier text NOT NULL DEFAULT 'none',
  provider text NOT NULL,
  feature text NOT NULL,
  unit text NOT NULL CHECK (unit IN ('input_tokens','output_tokens','requests','messages','attempts','billed_seconds','connected_seconds','voice_seconds')),
  quantity numeric NOT NULL CHECK (quantity >= 0),
  market text NOT NULL DEFAULT 'unknown',
  platform text NOT NULL DEFAULT 'web',
  ok boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.usage_events TO service_role;
REVOKE ALL ON public.usage_events FROM anon, authenticated;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to usage events" ON public.usage_events AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE INDEX usage_events_user ON public.usage_events (user_id, created_at DESC);
CREATE INDEX usage_events_month ON public.usage_events (service_month, provider, feature);

-- ===== drizzle/migrations/0004_usage_summary.sql =====
CREATE OR REPLACE FUNCTION public.usage_summary(_month date)
RETURNS TABLE(tier text, provider text, feature text, unit text, market text, platform text, quantity numeric, events bigint, failed bigint, members bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tier, provider, feature, unit, market, platform, sum(quantity), count(*), count(*) FILTER (WHERE NOT ok), count(DISTINCT user_id)
  FROM public.usage_events WHERE service_month = _month
  GROUP BY tier, provider, feature, unit, market, platform
  ORDER BY provider, feature, unit
$$;
REVOKE ALL ON FUNCTION public.usage_summary(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.usage_summary(date) TO service_role;

-- ===== drizzle/migrations/0005_admin_full_access.sql =====
-- Owner decision: admins get full (Execute-level) access to every feature without a subscription.
CREATE OR REPLACE FUNCTION public.grant_admin_full_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    UPDATE public.profiles SET tier = 'execute' WHERE id = NEW.user_id AND tier IS DISTINCT FROM 'execute';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.grant_admin_full_access() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_roles_admin_full_access ON public.user_roles;
CREATE TRIGGER user_roles_admin_full_access AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.grant_admin_full_access();

UPDATE public.profiles p SET tier = 'execute'
WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'admin') AND p.tier IS DISTINCT FROM 'execute';

-- ===== drizzle/migrations/0006_privacy_audit_consent_purposes.sql =====
ALTER TABLE public.consent_records DROP CONSTRAINT consent_records_purpose_check;
ALTER TABLE public.consent_records ADD CONSTRAINT consent_records_purpose_check CHECK (
  purpose = ANY (ARRAY['terms_and_privacy','safety_acknowledgement','age_confirmation','health_data','wearable_data','calendar_access',
    'professional_sharing','accountability_calls','calendar_read','calendar_write','email_reminders','phone_calls','professional_share','ai_personalisation'])
  OR purpose LIKE 'auto\_adapt:%');
ALTER TABLE public.audit_events DROP CONSTRAINT audit_events_actor_type_check;
ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_actor_type_check CHECK (actor_type = ANY (ARRAY['user','system','provider','operator','professional','admin']));

-- ===== drizzle/migrations/0007_migration.sql =====
alter table public.profiles add column if not exists acquisition_source text not null default 'Organic'
  check (acquisition_source in ('Waiting List','Founding Tester','Organic','Paid Marketing','Referral','Partnership','Other'));
alter table public.support_requests add column if not exists severity text not null default 'normal' check (severity in ('low','normal','high','critical')),
  add column if not exists assigned_to uuid, add column if not exists resolution text, add column if not exists resolved_at timestamptz;

create table public.owner_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  category text not null check (category in ('bug','confusing_ux','poor_recommendation','accountability','billing','integration','missing_feature','positive','other')),
  severity text not null default 'normal' check (severity in ('low','normal','high','critical')),
  notes text not null check (length(notes) between 1 and 4000),
  source text not null default 'owner',
  status text not null default 'OPEN' check (status in ('OPEN','INVESTIGATING','FIXED','CLOSED')),
  resolution text, linked_ref text, created_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.cancellation_reasons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  reason text not null check (reason in ('too_expensive','not_used_enough','not_helpful','calling_not_useful','too_complicated','missing_feature','technical_problem','privacy_concern','other')),
  details text check (length(details) <= 1000), tier text,
  created_at timestamptz not null default now());
create table public.owner_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, author_id uuid not null,
  note text not null check (length(note) between 1 and 2000),
  created_at timestamptz not null default now());
create table public.owner_cohorts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  rules jsonb not null default '{}', created_by uuid not null,
  created_at timestamptz not null default now());
create index on public.owner_feedback(status, created_at desc);
create index on public.cancellation_reasons(created_at desc);
create index on public.owner_notes(user_id, created_at desc);
create index if not exists profiles_created_idx on public.profiles(created_at);
create index if not exists support_status_idx on public.support_requests(status, created_at desc);

alter table public.owner_feedback enable row level security;
alter table public.cancellation_reasons enable row level security;
alter table public.owner_notes enable row level security;
alter table public.owner_cohorts enable row level security;
create policy "admins manage feedback" on public.owner_feedback for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "own cancellation reason insert" on public.cancellation_reasons for insert to authenticated with check (auth.uid() = user_id);
create policy "own or admin read reasons" on public.cancellation_reasons for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
create policy "admins manage notes" on public.owner_notes for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "admins manage cohorts" on public.owner_cohorts for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
grant select, insert, update, delete on public.owner_feedback, public.owner_notes, public.owner_cohorts to authenticated;
grant select, insert on public.cancellation_reasons to authenticated;
grant all on public.owner_feedback, public.owner_notes, public.owner_cohorts, public.cancellation_reasons to service_role;

-- Scalable aggregate for the Owner Overview: one round trip, computed in SQL, admin-only.
create or replace function public.owner_overview(_from timestamptz, _to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Forbidden'; end if;
  select jsonb_build_object(
    'total', (select count(*) from profiles where account_status is distinct from 'deleted'),
    'free', (select count(*) from profiles where tier='free'),
    'pro', (select count(*) from profiles where tier='pro'),
    'execute', (select count(*) from profiles where tier='execute'),
    'paying', (select count(*) from subscriptions where status in ('active','past_due') and tier in ('pro','execute')),
    'newToday', (select count(*) from profiles where created_at >= date_trunc('day', now())),
    'new7', (select count(*) from profiles where created_at >= now() - interval '7 days'),
    'new30', (select count(*) from profiles where created_at >= now() - interval '30 days'),
    'newInRange', (select count(*) from profiles where created_at between _from and _to),
    'activeInRange', (select count(distinct user_id) from plan_block_events where occurred_at between _from and _to and actor_type='user'),
    'wau', (select count(distinct user_id) from plan_block_events where occurred_at >= now()-interval '7 days' and actor_type='user'),
    'lifeAudit', (select count(*) from profiles where life_audit is not null and life_audit <> '{}'::jsonb),
    'planAccepted', (select count(distinct user_id) from plan_versions where approved_at is not null),
    'retained30', (select count(*) from profiles p where p.created_at < now()-interval '30 days' and exists (select 1 from plan_block_events e where e.user_id=p.id and e.occurred_at >= p.created_at + interval '30 days')),
    'eligible30', (select count(*) from profiles where created_at < now()-interval '30 days'),
    'retained90', (select count(*) from profiles p where p.created_at < now()-interval '90 days' and exists (select 1 from plan_block_events e where e.user_id=p.id and e.occurred_at >= p.created_at + interval '90 days')),
    'eligible90', (select count(*) from profiles where created_at < now()-interval '90 days'),
    'cancelling', (select count(*) from subscriptions where cancel_at_period_end or status='canceled'),
    'pastDue', (select count(*) from subscriptions where status in ('past_due','unpaid')),
    'billingEvents', (select count(*) from billing_events where received_at between _from and _to),
    'rewardsEarned', (select count(*) from execution_rewards where state in ('EARNED','APPLIED') and coalesce(earned_at,created_at) between _from and _to),
    'rewardsApplied', (select count(*) from execution_rewards where state='APPLIED' and applied_at between _from and _to),
    'blocksPlanned', (select count(*) from plan_blocks where starts_at between _from and _to and status <> 'cancelled'),
    'blocksDone', (select count(*) from plan_blocks where starts_at between _from and _to and status='done'),
    'voiceSeconds', (select coalesce(sum(coalesce(connected_seconds,0)),0) from call_logs where created_at between _from and _to),
    'calls', (select count(*) from call_logs where created_at between _from and _to),
    'callsAnswered', (select count(*) from call_logs where created_at between _from and _to and coalesce(connected_seconds,0) > 0),
    'callsAcked', (select count(*) from call_logs where created_at between _from and _to and outcome in ('confirmed_done','not_yet','done','snooze','reschedule','skip')),
    'supportOpen', (select count(*) from support_requests where status in ('open','OPEN','INVESTIGATING')),
    'feedbackOpen', (select count(*) from owner_feedback where status in ('OPEN','INVESTIGATING')),
    'jobFailures', (select count(*) from background_jobs where status in ('failed','dead') and updated_at between _from and _to),
    'integrationFailures', (select count(*) from provider_calls where ok is false and created_at between _from and _to),
    'incidentsOpen', (select count(*) from incidents where status <> 'resolved')
  ) into r;
  return r;
end $$;
revoke all on function public.owner_overview(timestamptz,timestamptz) from public, anon;
grant execute on function public.owner_overview(timestamptz,timestamptz) to authenticated;

-- ===== drizzle/migrations/0008_migration.sql =====
create or replace function public.owner_analytics(_from timestamptz, _to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Forbidden'; end if;
  with
  subs as (select s.*, p.acquisition_source src, to_char(date_trunc('month',p.created_at),'YYYY-MM') cohort
           from subscriptions s join profiles p on p.id=s.user_id),
  prof as (select id, tier, acquisition_source src, created_at, to_char(date_trunc('month',created_at),'YYYY-MM') cohort from profiles where account_status is distinct from 'deleted'),
  act as (select user_id, max(occurred_at) last_at from plan_block_events where actor_type='user' group by user_id),
  ret as (
    select p.*, d.days,
      (p.created_at < now() - make_interval(days => d.days)) eligible,
      exists (select 1 from plan_block_events e where e.user_id=p.id and e.actor_type='user' and e.occurred_at >= p.created_at + make_interval(days => d.days)) kept
    from prof p cross join (values (7),(14),(30),(60),(90)) d(days)),
  blocks as (select status from plan_blocks where starts_at between _from and _to and occurrence_kind is distinct from 'commitment'),
  calls as (select * from call_logs where created_at between _from and _to),
  camps as (select c.*, p.tier from call_campaigns c left join profiles p on p.id=c.user_id where c.created_at between _from and _to),
  usage as (select * from usage_events where created_at between _from and _to)
  select jsonb_build_object(
    'revenue', jsonb_build_object(
      'active', (select coalesce(jsonb_object_agg(k, n),'{}') from (select tier||'_'||coalesce(billing_interval,'month') k, count(*) n from subs where status in ('active','past_due') group by 1) x),
      'trialing', (select count(*) from subs where status='trialing'),
      'newSubs', (select count(*) from subs where current_period_start between _from and _to and status in ('active','trialing')),
      'cancelling', (select count(*) from subs where cancel_at_period_end),
      'cancelled', (select count(*) from subs where status='canceled' and updated_at between _from and _to),
      'pastDue', (select count(*) from subs where status in ('past_due','unpaid')),
      'bySource', (select coalesce(jsonb_object_agg(src, n),'{}') from (select src, count(*) n from subs where status in ('active','past_due') group by 1) x),
      'byCohort', (select coalesce(jsonb_object_agg(cohort, n),'{}') from (select cohort, count(*) n from subs where status in ('active','past_due') group by 1) x),
      'topups', (select count(*) from entitlement_ledger where capability='execute.voice_topup_seconds' and amount > 0 and created_at between _from and _to),
      'billingEventTypes', (select coalesce(jsonb_object_agg(type, n),'{}') from (select type, count(*) n from billing_events where received_at between _from and _to group by 1) x),
      'rewardsEarned', (select count(*) from execution_rewards where state in ('EARNED','APPLIED') and coalesce(earned_at,created_at) between _from and _to),
      'rewardsApplied', (select count(*) from execution_rewards where state='APPLIED' and applied_at between _from and _to),
      'rewardPenceApplied', (select coalesce(sum(amount_pence),0) from execution_rewards where state='APPLIED' and applied_at between _from and _to)),
    'retention', jsonb_build_object(
      'overall', (select coalesce(jsonb_object_agg(days, jsonb_build_object('eligible', e, 'kept', k)),'{}') from (select days, count(*) filter (where eligible) e, count(*) filter (where eligible and kept) k from ret group by days) x),
      'byTier', (select coalesce(jsonb_object_agg(tier, v),'{}') from (select tier, jsonb_object_agg(days, jsonb_build_object('eligible', e, 'kept', k)) v from (select tier, days, count(*) filter (where eligible) e, count(*) filter (where eligible and kept) k from ret group by 1,2) y group by tier) x),
      'bySource', (select coalesce(jsonb_object_agg(src, v),'{}') from (select src, jsonb_object_agg(days, jsonb_build_object('eligible', e, 'kept', k)) v from (select src, days, count(*) filter (where eligible) e, count(*) filter (where eligible and kept) k from ret group by 1,2) y group by src) x),
      'byCohort', (select coalesce(jsonb_object_agg(cohort, v),'{}') from (select cohort, jsonb_object_agg(days, jsonb_build_object('eligible', e, 'kept', k)) v from (select cohort, days, count(*) filter (where eligible) e, count(*) filter (where eligible and kept) k from ret group by 1,2) y group by cohort) x),
      'paying', (select count(*) from subs where status in ('active','past_due')),
      'cancelled', (select count(*) from subs where status='canceled'),
      'cancelling', (select count(*) from subs where cancel_at_period_end),
      'inactive30', (select count(*) from prof p left join act a on a.user_id=p.id where p.created_at < now()-interval '30 days' and (a.last_at is null or a.last_at < now()-interval '30 days'))),
    'execution', jsonb_build_object(
      'members', (select count(*) from prof),
      'lifeAudit', (select count(*) from profiles where life_audit is not null and life_audit <> '{}'::jsonb),
      'planAccepted', (select count(distinct user_id) from plan_versions where approved_at is not null),
      'versionsInRange', (select count(*) from plan_versions where created_at between _from and _to),
      'acceptedInRange', (select count(*) from plan_versions where approved_at between _from and _to),
      'recoveryUses', (select count(*) from plan_versions where trigger='recovery' and created_at between _from and _to),
      'blocks', (select coalesce(jsonb_object_agg(status, n),'{}') from (select status, count(*) n from blocks group by 1) x),
      'rescheduledThenDone', (select count(*) from plan_block_events e where e.event_type='rescheduled' and e.occurred_at between _from and _to and exists (select 1 from plan_blocks b where b.rescheduled_from = e.block_id and b.status='done')),
      'rewards', (select coalesce(jsonb_object_agg(state, n),'{}') from (select state, count(*) n from execution_rewards where period_end between _from and _to group by 1) x),
      'outcomes', (select count(*) from outcome_ledger where created_at between _from and _to),
      'evidence', (select coalesce(jsonb_object_agg(coalesce(evidence_class,'unclassified'), n),'{}') from (select evidence_class, count(*) n from outcome_ledger where created_at between _from and _to group by 1) x)),
    'calls', jsonb_build_object(
      'campaigns', (select count(*) from camps),
      'campaignsByTier', (select coalesce(jsonb_object_agg(coalesce(tier,'unknown'), n),'{}') from (select tier, count(*) n from camps group by 1) x),
      'campaignStates', (select coalesce(jsonb_object_agg(state, n),'{}') from (select state, count(*) n from camps group by 1) x),
      'attempts', (select count(*) from calls),
      'answered', (select count(*) from calls where coalesce(connected_seconds,0) > 0),
      'busy', (select count(*) from calls where provider_status='busy'),
      'noAnswer', (select count(*) from calls where provider_status in ('no-answer','no_answer')),
      'failed', (select count(*) from calls where provider_status in ('failed','canceled')),
      'machine', (select count(*) from calls where answered_by like 'machine%'),
      'acked', (select count(*) from camps where acknowledgement is not null),
      'retries', (select count(*) from calls where attempt_no > 1),
      'connectedSeconds', (select coalesce(sum(connected_seconds),0) from calls),
      'connectedByTier', (select coalesce(jsonb_object_agg(coalesce(tier,'unknown'), s),'{}') from (select tier, sum(connected_seconds) s from camps group by 1) x),
      'stopAll', (select count(*) from profiles where calls_stopped_at between _from and _to),
      'providerErrors', (select count(*) from provider_calls where provider='twilio' and not ok and created_at between _from and _to)),
    'usage', jsonb_build_object(
      'rows', (select coalesce(jsonb_agg(x),'[]') from (select provider, feature, unit, coalesce(tier,'unknown') tier, sum(quantity) quantity, count(*) events, count(*) filter (where not ok) failed, count(distinct user_id) members from usage group by 1,2,3,4 order by 1,2) x),
      'providers', (select coalesce(jsonb_agg(x),'[]') from (select provider, count(*) calls, count(*) filter (where not ok) failed, round(avg(latency_ms)) latency from provider_calls where created_at between _from and _to group by 1 order by 1) x),
      'activeByTier', (select coalesce(jsonb_object_agg(tier, n),'{}') from (select p.tier, count(distinct e.user_id) n from plan_block_events e join profiles p on p.id=e.user_id where e.occurred_at between _from and _to and e.actor_type='user' group by 1) x))
  ) into r;
  return r;
end $$;
revoke all on function public.owner_analytics(timestamptz,timestamptz) from public, anon;
grant execute on function public.owner_analytics(timestamptz,timestamptz) to authenticated;

-- ===== drizzle/migrations/0009_migration.sql =====
create or replace function public.owner_analytics(_from timestamptz, _to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Forbidden'; end if;
  with
  subs as (select s.*, p.acquisition_source src, to_char(date_trunc('month',p.created_at),'YYYY-MM') cohort
           from subscriptions s join profiles p on p.id=s.user_id),
  prof as (select id, tier, acquisition_source src, created_at, to_char(date_trunc('month',created_at),'YYYY-MM') cohort from profiles where account_status is distinct from 'deleted'),
  act as (select user_id, max(occurred_at) last_at from plan_block_events where actor_type='user' group by user_id),
  ret as (
    select p.*, d.days,
      (p.created_at < now() - make_interval(days => d.days)) eligible,
      exists (select 1 from plan_block_events e where e.user_id=p.id and e.actor_type='user' and e.occurred_at >= p.created_at + make_interval(days => d.days)) kept
    from prof p cross join (values (7),(14),(30),(60),(90)) d(days)),
  blocks as (select status from plan_blocks where starts_at between _from and _to and occurrence_kind is distinct from 'commitment'),
  calls as (select * from call_logs where created_at between _from and _to),
  camps as (select c.*, p.tier from call_campaigns c left join profiles p on p.id=c.user_id where c.created_at between _from and _to),
  usage as (select * from usage_events where created_at between _from and _to)
  select jsonb_build_object(
    'revenue', jsonb_build_object(
      'active', (select coalesce(jsonb_object_agg(k, n),'{}') from (select tier||'_'||coalesce(billing_interval,'month') k, count(*) n from subs where status in ('active','past_due') group by 1) x),
      'trialing', (select count(*) from subs where status='trialing'),
      'newSubs', (select count(*) from subs where current_period_start between _from and _to and status in ('active','trialing')),
      'cancelling', (select count(*) from subs where cancel_at_period_end),
      'cancelled', (select count(*) from subs where status='canceled' and updated_at between _from and _to),
      'pastDue', (select count(*) from subs where status in ('past_due','unpaid')),
      'bySource', (select coalesce(jsonb_object_agg(src, n),'{}') from (select src, count(*) n from subs where status in ('active','past_due') group by 1) x),
      'byCohort', (select coalesce(jsonb_object_agg(cohort, n),'{}') from (select cohort, count(*) n from subs where status in ('active','past_due') group by 1) x),
      'topups', (select count(*) from entitlement_ledger where capability='execute.voice_topup_seconds' and amount > 0 and created_at between _from and _to),
      'billingEventTypes', (select coalesce(jsonb_object_agg(type, n),'{}') from (select type, count(*) n from billing_events where received_at between _from and _to group by 1) x),
      'rewardsEarned', (select count(*) from execution_rewards where state in ('EARNED','APPLIED') and coalesce(earned_at,created_at) between _from and _to),
      'rewardsApplied', (select count(*) from execution_rewards where state='APPLIED' and applied_at between _from and _to),
      'rewardPenceApplied', (select coalesce(sum(amount_pence),0) from execution_rewards where state='APPLIED' and applied_at between _from and _to)),
    'retention', jsonb_build_object(
      'overall', (select coalesce(jsonb_object_agg(days, jsonb_build_object('eligible', e, 'kept', k)),'{}') from (select days, count(*) filter (where eligible) e, count(*) filter (where eligible and kept) k from ret group by days) x),
      'byTier', (select coalesce(jsonb_object_agg(tier, v),'{}') from (select tier, jsonb_object_agg(days, jsonb_build_object('eligible', e, 'kept', k)) v from (select tier, days, count(*) filter (where eligible) e, count(*) filter (where eligible and kept) k from ret group by 1,2) y group by tier) x),
      'bySource', (select coalesce(jsonb_object_agg(src, v),'{}') from (select src, jsonb_object_agg(days, jsonb_build_object('eligible', e, 'kept', k)) v from (select src, days, count(*) filter (where eligible) e, count(*) filter (where eligible and kept) k from ret group by 1,2) y group by src) x),
      'byCohort', (select coalesce(jsonb_object_agg(cohort, v),'{}') from (select cohort, jsonb_object_agg(days, jsonb_build_object('eligible', e, 'kept', k)) v from (select cohort, days, count(*) filter (where eligible) e, count(*) filter (where eligible and kept) k from ret group by 1,2) y group by cohort) x),
      'paying', (select count(*) from subs where status in ('active','past_due')),
      'cancelled', (select count(*) from subs where status='canceled'),
      'cancelling', (select count(*) from subs where cancel_at_period_end),
      'inactive30', (select count(*) from prof p left join act a on a.user_id=p.id where p.created_at < now()-interval '30 days' and (a.last_at is null or a.last_at < now()-interval '30 days'))),
    'execution', jsonb_build_object(
      'members', (select count(*) from prof),
      'lifeAudit', (select count(*) from profiles where life_audit is not null and life_audit <> '{}'::jsonb),
      'planAccepted', (select count(distinct user_id) from plan_versions where approved_at is not null),
      'versionsInRange', (select count(*) from plan_versions where created_at between _from and _to),
      'acceptedInRange', (select count(*) from plan_versions where approved_at between _from and _to),
      'recoveryUses', (select count(*) from plan_versions where trigger='recovery' and created_at between _from and _to),
      'blocks', (select coalesce(jsonb_object_agg(status, n),'{}') from (select status, count(*) n from blocks group by 1) x),
      'movedBlocks', (select count(*) from plan_blocks where starts_at between _from and _to and original_starts_at is not null and original_starts_at <> starts_at),
      'movedDone', (select count(*) from plan_blocks where starts_at between _from and _to and original_starts_at is not null and original_starts_at <> starts_at and status='done'),
      'rewards', (select coalesce(jsonb_object_agg(state, n),'{}') from (select state, count(*) n from execution_rewards where period_end between _from and _to group by 1) x),
      'outcomes', (select count(*) from outcome_ledger where created_at between _from and _to),
      'evidence', (select coalesce(jsonb_object_agg(coalesce(evidence_class,'unclassified'), n),'{}') from (select evidence_class, count(*) n from outcome_ledger where created_at between _from and _to group by 1) x)),
    'calls', jsonb_build_object(
      'campaigns', (select count(*) from camps),
      'campaignsByTier', (select coalesce(jsonb_object_agg(coalesce(tier,'unknown'), n),'{}') from (select tier, count(*) n from camps group by 1) x),
      'campaignStates', (select coalesce(jsonb_object_agg(state, n),'{}') from (select state, count(*) n from camps group by 1) x),
      'attempts', (select count(*) from calls),
      'answered', (select count(*) from calls where coalesce(connected_seconds,0) > 0),
      'busy', (select count(*) from calls where provider_status='busy'),
      'noAnswer', (select count(*) from calls where provider_status in ('no-answer','no_answer')),
      'failed', (select count(*) from calls where provider_status in ('failed','canceled')),
      'machine', (select count(*) from calls where answered_by like 'machine%'),
      'acked', (select count(*) from camps where acknowledgement is not null),
      'retries', (select count(*) from calls where attempt_no > 1),
      'connectedSeconds', (select coalesce(sum(connected_seconds),0) from calls),
      'connectedByTier', (select coalesce(jsonb_object_agg(coalesce(tier,'unknown'), s),'{}') from (select tier, sum(connected_seconds) s from camps group by 1) x),
      'stopAll', (select count(*) from profiles where calls_stopped_at between _from and _to),
      'providerErrors', (select count(*) from provider_calls where provider='twilio' and not ok and created_at between _from and _to)),
    'usage', jsonb_build_object(
      'rows', (select coalesce(jsonb_agg(x),'[]') from (select provider, feature, unit, coalesce(tier,'unknown') tier, sum(quantity) quantity, count(*) events, count(*) filter (where not ok) failed, count(distinct user_id) members from usage group by 1,2,3,4 order by 1,2) x),
      'providers', (select coalesce(jsonb_agg(x),'[]') from (select provider, count(*) calls, count(*) filter (where not ok) failed, round(avg(latency_ms)) latency from provider_calls where created_at between _from and _to group by 1 order by 1) x),
      'activeByTier', (select coalesce(jsonb_object_agg(tier, n),'{}') from (select p.tier, count(distinct e.user_id) n from plan_block_events e join profiles p on p.id=e.user_id where e.occurred_at between _from and _to and e.actor_type='user' group by 1) x))
  ) into r;
  return r;
end $$;

-- ===== drizzle/migrations/0010_owner_cohorts_metrics.sql =====
create table public.owner_member_tags (
  user_id uuid not null, tag text not null check (length(tag) between 1 and 40),
  created_by uuid not null, created_at timestamptz not null default now(),
  primary key (user_id, tag));
grant select, insert, delete on public.owner_member_tags to authenticated;
grant all on public.owner_member_tags to service_role;
alter table public.owner_member_tags enable row level security;
create policy "admins manage member tags" on public.owner_member_tags for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create index on public.owner_member_tags(tag);

create or replace function public.owner_cohort_metrics(_rules jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Forbidden'; end if;
  with base as (
    select p.id, p.created_at, p.life_audit, p.tier from profiles p
    left join subscriptions s on s.user_id = p.id
    where p.account_status is distinct from 'deleted'
      and (_rules->>'signup_from' is null or p.created_at >= (_rules->>'signup_from')::date)
      and (_rules->>'signup_to' is null or p.created_at < (_rules->>'signup_to')::date + 1)
      and (_rules->>'tier' is null or p.tier = _rules->>'tier')
      and (_rules->>'source' is null or p.acquisition_source = _rules->>'source')
      and (_rules->>'sub_state' is null or coalesce(s.status,'none') = _rules->>'sub_state')
      and (_rules->>'tag' is null or exists (select 1 from owner_member_tags t where t.user_id=p.id and t.tag=_rules->>'tag'))
      and (_rules->>'paying_only' is distinct from 'true' or s.status in ('active','past_due','trialing'))
      and (coalesce(_rules->>'active','') = '' or (exists (select 1 from plan_blocks b where b.user_id=p.id and b.status='completed' and b.completed_at > now() - interval '30 days')) = (_rules->>'active')::boolean)
  ), m as (
    select * from base order by created_at
    limit case when _rules->>'first_n' is null then null else (_rules->>'first_n')::int end
  )
  select jsonb_build_object(
    'members', (select count(*) from m),
    'lifeAudit', (select count(*) from m where life_audit is not null),
    'planAccepted', (select count(distinct v.user_id) from plan_versions v join m on m.id=v.user_id where v.approved_at is not null),
    'activeWeek', (select count(distinct b.user_id) from plan_blocks b join m on m.id=b.user_id where b.status='completed' and b.completed_at > now() - interval '7 days'),
    'active30', (select count(distinct b.user_id) from plan_blocks b join m on m.id=b.user_id where b.status='completed' and b.completed_at > now() - interval '30 days'),
    'blocksPlanned', (select count(*) from plan_blocks b join m on m.id=b.user_id where b.starts_at > now() - interval '30 days' and b.starts_at <= now() and b.occurrence_kind is distinct from 'commitment'),
    'blocksDone', (select count(*) from plan_blocks b join m on m.id=b.user_id where b.status='completed' and b.starts_at > now() - interval '30 days' and b.starts_at <= now() and b.occurrence_kind is distinct from 'commitment'),
    'rewardsEarned', (select count(*) from execution_rewards e join m on m.id=e.user_id where e.state in ('EARNED','APPLIED')),
    'paying', (select count(*) from subscriptions s join m on m.id=s.user_id where s.status in ('active','past_due')),
    'renewed', (select count(*) from subscriptions s join m on m.id=s.user_id where s.status='active' and s.current_period_start > m.created_at + interval '25 days'),
    'cancelled', (select count(*) from subscriptions s join m on m.id=s.user_id where s.status='canceled' or s.cancel_at_period_end),
    'byTier', (select coalesce(jsonb_object_agg(tier, n),'{}') from (select tier, count(*) n from m group by tier) x),
    'supportIssues', (select count(*) from support_requests q join m on m.id=q.user_id),
    'callCampaigns', (select count(*) from call_campaigns c join m on m.id=c.user_id),
    'connectedSeconds', (select coalesce(sum(c.connected_seconds),0) from call_campaigns c join m on m.id=c.user_id),
    'aiEvents', (select count(*) from usage_events u join m on m.id=u.user_id where u.feature ilike '%coach%' or u.provider in ('lovable_ai','openai','gemini')),
    'outcomes', (select count(*) from outcome_ledger o join m on m.id=o.user_id)
  ) into r;
  return r;
end $$;
revoke all on function public.owner_cohort_metrics(jsonb) from public, anon;
grant execute on function public.owner_cohort_metrics(jsonb) to authenticated;

-- ===== drizzle/migrations/0011_fix_cohort_done_status.sql =====
create or replace function public.owner_cohort_metrics(_rules jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Forbidden'; end if;
  with base as (
    select p.id, p.created_at, p.life_audit, p.tier from profiles p
    left join subscriptions s on s.user_id = p.id
    where p.account_status is distinct from 'deleted'
      and (_rules->>'signup_from' is null or p.created_at >= (_rules->>'signup_from')::date)
      and (_rules->>'signup_to' is null or p.created_at < (_rules->>'signup_to')::date + 1)
      and (_rules->>'tier' is null or p.tier = _rules->>'tier')
      and (_rules->>'source' is null or p.acquisition_source = _rules->>'source')
      and (_rules->>'sub_state' is null or coalesce(s.status,'none') = _rules->>'sub_state')
      and (_rules->>'tag' is null or exists (select 1 from owner_member_tags t where t.user_id=p.id and t.tag=_rules->>'tag'))
      and (_rules->>'paying_only' is distinct from 'true' or s.status in ('active','past_due','trialing'))
      and (coalesce(_rules->>'active','') = '' or (exists (select 1 from plan_blocks b where b.user_id=p.id and b.status='done' and b.completed_at > now() - interval '30 days')) = (_rules->>'active')::boolean)
  ), m as (
    select * from base order by created_at
    limit case when _rules->>'first_n' is null then null else (_rules->>'first_n')::int end
  )
  select jsonb_build_object(
    'members', (select count(*) from m),
    'lifeAudit', (select count(*) from m where life_audit is not null),
    'planAccepted', (select count(distinct v.user_id) from plan_versions v join m on m.id=v.user_id where v.approved_at is not null),
    'activeWeek', (select count(distinct b.user_id) from plan_blocks b join m on m.id=b.user_id where b.status='done' and b.completed_at > now() - interval '7 days'),
    'active30', (select count(distinct b.user_id) from plan_blocks b join m on m.id=b.user_id where b.status='done' and b.completed_at > now() - interval '30 days'),
    'blocksPlanned', (select count(*) from plan_blocks b join m on m.id=b.user_id where b.starts_at > now() - interval '30 days' and b.starts_at <= now() and b.occurrence_kind is distinct from 'commitment'),
    'blocksDone', (select count(*) from plan_blocks b join m on m.id=b.user_id where b.status='done' and b.starts_at > now() - interval '30 days' and b.starts_at <= now() and b.occurrence_kind is distinct from 'commitment'),
    'rewardsEarned', (select count(*) from execution_rewards e join m on m.id=e.user_id where e.state in ('EARNED','APPLIED')),
    'paying', (select count(*) from subscriptions s join m on m.id=s.user_id where s.status in ('active','past_due')),
    'renewed', (select count(*) from subscriptions s join m on m.id=s.user_id where s.status='active' and s.current_period_start > m.created_at + interval '25 days'),
    'cancelled', (select count(*) from subscriptions s join m on m.id=s.user_id where s.status='canceled' or s.cancel_at_period_end),
    'byTier', (select coalesce(jsonb_object_agg(tier, n),'{}') from (select tier, count(*) n from m group by tier) x),
    'supportIssues', (select count(*) from support_requests q join m on m.id=q.user_id),
    'callCampaigns', (select count(*) from call_campaigns c join m on m.id=c.user_id),
    'connectedSeconds', (select coalesce(sum(c.connected_seconds),0) from call_campaigns c join m on m.id=c.user_id),
    'aiEvents', (select count(*) from usage_events u join m on m.id=u.user_id where u.feature ilike '%coach%' or u.provider in ('lovable_ai','openai','gemini')),
    'outcomes', (select count(*) from outcome_ledger o join m on m.id=o.user_id)
  ) into r;
  return r;
end $$;
revoke all on function public.owner_cohort_metrics(jsonb) from public, anon;
grant execute on function public.owner_cohort_metrics(jsonb) to authenticated;

-- ===== drizzle/migrations/0012_create_learning_searches.sql =====
CREATE TABLE public.learning_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  level text NOT NULL DEFAULT 'beginner',
  summary text,
  resources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_searches TO authenticated;
GRANT ALL ON public.learning_searches TO service_role;
ALTER TABLE public.learning_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own learning searches" ON public.learning_searches FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX learning_searches_user_created ON public.learning_searches (user_id, created_at DESC);

-- ===== drizzle/migrations/0013_coach_scheduled_calls.sql =====
ALTER TABLE public.commitments ADD COLUMN IF NOT EXISTS dedupe_key text, ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'user';
CREATE UNIQUE INDEX IF NOT EXISTS commitments_user_dedupe ON public.commitments (user_id, dedupe_key);

CREATE TABLE public.scheduled_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  commitment_id uuid REFERENCES public.commitments(id) ON DELETE CASCADE,
  call_at timestamptz NOT NULL,
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','processing','placed','not_placed','held','missed_window','cancelled')),
  status_reason text,
  campaign_id uuid REFERENCES public.call_campaigns(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'coach',
  source_ref text,
  dedupe_key text NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX scheduled_calls_due ON public.scheduled_calls (status, call_at);
GRANT SELECT ON public.scheduled_calls TO authenticated;
GRANT ALL ON public.scheduled_calls TO service_role;
ALTER TABLE public.scheduled_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own scheduled calls" ON public.scheduled_calls FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER scheduled_calls_touch BEFORE UPDATE ON public.scheduled_calls FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.call_campaigns DROP CONSTRAINT IF EXISTS call_campaigns_trigger_check;
ALTER TABLE public.call_campaigns ADD CONSTRAINT call_campaigns_trigger_check CHECK (trigger IN ('due','call_now','missed','morning','evening','scheduled'));

-- ===== drizzle/migrations/0014_coach_pending_actions.sql =====
CREATE TABLE public.coach_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','failed','expired')),
  result jsonb,
  source_message uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
GRANT SELECT ON public.coach_pending_actions TO authenticated;
GRANT ALL ON public.coach_pending_actions TO service_role;
ALTER TABLE public.coach_pending_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read own pending coach actions" ON public.coach_pending_actions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX coach_pending_actions_user_idx ON public.coach_pending_actions (user_id, created_at DESC);

-- ===== drizzle/migrations/0015_scheduled_calls_keep_history.sql =====
ALTER TABLE public.scheduled_calls DROP CONSTRAINT IF EXISTS scheduled_calls_commitment_id_fkey;
ALTER TABLE public.scheduled_calls ADD CONSTRAINT scheduled_calls_commitment_id_fkey FOREIGN KEY (commitment_id) REFERENCES public.commitments(id) ON DELETE SET NULL;

-- ===== drizzle/migrations/0016_billing_country.sql =====
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS billing_country text CHECK (billing_country IN ('GB','US'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS billing_country_source text CHECK (billing_country_source IN ('hint','member','checkout'));
UPDATE public.profiles SET billing_country = CASE WHEN timezone LIKE 'America/%' OR timezone LIKE 'US/%' THEN 'US' ELSE 'GB' END, billing_country_source='hint' WHERE billing_country IS NULL;
UPDATE public.profiles SET units='imperial' WHERE billing_country='US' AND units='metric' AND billing_country_source='hint' AND false;
-- Members may not change billing country while a paid subscription is live; only service role (checkout address) can.
CREATE OR REPLACE FUNCTION public.guard_billing_country() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.billing_country IS DISTINCT FROM OLD.billing_country AND auth.role() <> 'service_role' THEN
    IF EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = NEW.id AND s.status IN ('trialing','active','past_due')) THEN
      RAISE EXCEPTION 'Billing country can''t change while a subscription is active. Cancel first, or contact support.';
    END IF;
    NEW.billing_country_source := 'member';
  END IF;
  IF NEW.billing_country_source = 'checkout' AND OLD.billing_country_source IS DISTINCT FROM 'checkout' AND auth.role() <> 'service_role' THEN
    NEW.billing_country_source := OLD.billing_country_source;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_billing_country ON public.profiles;
CREATE TRIGGER guard_billing_country BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_billing_country();

-- ===== drizzle/migrations/0017_member_deletion.sql =====
-- Deleting a goal keeps finished-session history (goal link cleared) instead of erasing it.
ALTER TABLE public.plan_blocks DROP CONSTRAINT plan_blocks_goal_id_fkey;
ALTER TABLE public.plan_blocks ADD CONSTRAINT plan_blocks_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goals(id) ON DELETE SET NULL;

-- A member may delete a week's plan: the version is kept for history with status 'deleted'.
CREATE OR REPLACE FUNCTION public.validate_plan_version_change()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Plan versions cannot be deleted';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.week_start IS DISTINCT FROM OLD.week_start
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.trigger IS DISTINCT FROM OLD.trigger
    OR NEW.feasibility IS DISTINCT FROM OLD.feasibility
    OR NEW.explanation IS DISTINCT FROM OLD.explanation
    OR NEW.diff_summary IS DISTINCT FROM OLD.diff_summary
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Plan version content is immutable';
  END IF;
  IF NOT (
    (OLD.status = 'proposed' AND NEW.status IN ('approved','rejected','superseded','deleted'))
    OR (OLD.status = 'approved' AND NEW.status IN ('superseded','deleted'))
    OR (OLD.status = 'superseded' AND NEW.status = 'deleted')
    OR (OLD.status = NEW.status AND OLD.approved_at IS NOT DISTINCT FROM NEW.approved_at)
  ) THEN
    RAISE EXCEPTION 'Invalid plan version transition';
  END IF;
  IF NEW.status = 'approved' AND NEW.approved_at IS NULL THEN
    RAISE EXCEPTION 'Approved plan versions require an approval time';
  END IF;
  RETURN NEW;
END; $function$;

-- ===== drizzle/migrations/0018_plan_versions_deleted_status.sql =====
ALTER TABLE public.plan_versions DROP CONSTRAINT plan_versions_status_check;
ALTER TABLE public.plan_versions ADD CONSTRAINT plan_versions_status_check CHECK (status = ANY (ARRAY['proposed','approved','rejected','superseded','deleted']));

-- ===== drizzle/migrations/0019_meal_photo_estimates.sql =====
CREATE TABLE public.meal_photo_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','logged','cancelled')),
  estimate jsonb NOT NULL,
  corrections text[] NOT NULL DEFAULT '{}',
  meal_slot text,
  eaten_on date,
  logged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.meal_photo_estimates TO authenticated;
GRANT ALL ON public.meal_photo_estimates TO service_role;
ALTER TABLE public.meal_photo_estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own meal estimates read" ON public.meal_photo_estimates FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX meal_photo_estimates_user_idx ON public.meal_photo_estimates(user_id, created_at DESC);

-- ===== drizzle/migrations/0020_guided_wellness_videos.sql =====
CREATE TABLE public.guided_video_cache (
  key text PRIMARY KEY,
  activity text NOT NULL,
  focus text NOT NULL,
  minutes integer NOT NULL,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.guided_video_cache TO service_role;
ALTER TABLE public.guided_video_cache ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.wellness_sessions
  ADD COLUMN activity text NOT NULL DEFAULT 'meditation',
  ADD COLUMN focus text,
  ADD COLUMN video jsonb,
  ADD COLUMN feedback text,
  ADD COLUMN client_id uuid;
ALTER TABLE public.wellness_sessions ADD CONSTRAINT wellness_sessions_activity_chk CHECK (activity IN ('meditation','yoga'));
ALTER TABLE public.wellness_sessions ADD CONSTRAINT wellness_sessions_feedback_chk CHECK (feedback IS NULL OR feedback IN ('helpful','okay','not_for_me'));
CREATE UNIQUE INDEX wellness_sessions_client_uidx ON public.wellness_sessions(user_id, client_id) WHERE client_id IS NOT NULL;

-- ===== drizzle/migrations/0021_exercise_demo_cache.sql =====
CREATE TABLE public.exercise_demo_cache (
  exercise_key text PRIMARY KEY,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.exercise_demo_cache TO service_role;
ALTER TABLE public.exercise_demo_cache ENABLE ROW LEVEL SECURITY;

-- ===== drizzle/migrations/0022_meal_prep_inventory.sql =====
CREATE TABLE public.food_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  food_key text,
  grams numeric CHECK (grams IS NULL OR (grams >= 0 AND grams <= 100000)),
  item_count numeric,
  unit text NOT NULL DEFAULT 'item',
  quantity_status text NOT NULL DEFAULT 'unknown' CHECK (quantity_status IN ('confirmed','estimated','unknown','as_needed')),
  source text NOT NULL CHECK (source IN ('photo','voice','text','manual','coach')),
  per100 jsonb,
  nutrition_source text NOT NULL DEFAULT 'generic reference values (estimate)',
  expires_on date,
  allergens text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  confirmed_at timestamptz,
  import_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX food_inventory_import_uq ON public.food_inventory (user_id, import_key, name) WHERE import_key IS NOT NULL;
CREATE INDEX food_inventory_user_idx ON public.food_inventory (user_id, status);
GRANT SELECT ON public.food_inventory TO authenticated;
GRANT ALL ON public.food_inventory TO service_role;
ALTER TABLE public.food_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read their own inventory" ON public.food_inventory FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.meal_prep_preferences (
  user_id uuid PRIMARY KEY,
  dislikes text[] NOT NULL DEFAULT '{}',
  meals_per_day text[] NOT NULL DEFAULT '{breakfast,lunch,dinner,snack}',
  prep_weekday int NOT NULL DEFAULT 0 CHECK (prep_weekday BETWEEN 0 AND 6),
  second_prep boolean NOT NULL DEFAULT true,
  quick_breakfasts boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.meal_prep_preferences TO authenticated;
GRANT ALL ON public.meal_prep_preferences TO service_role;
ALTER TABLE public.meal_prep_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read their own meal prep preferences" ON public.meal_prep_preferences FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ===== drizzle/migrations/0023_appointments_and_spend.sql =====
-- Combined AI + call spend against the included monthly allowance, and Plexecute AI Credit.
CREATE TABLE public.spend_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period_start date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ai','call')),
  feature text NOT NULL,
  provider_cost_micro bigint NOT NULL CHECK (provider_cost_micro >= 0),
  retail_micro bigint NOT NULL CHECK (retail_micro >= 0),
  funded_by text NOT NULL CHECK (funded_by IN ('included','credit','over')),
  ref text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX spend_ledger_user_period ON public.spend_ledger (user_id, period_start);
GRANT SELECT ON public.spend_ledger TO authenticated;
GRANT ALL ON public.spend_ledger TO service_role;
ALTER TABLE public.spend_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own spend" ON public.spend_ledger FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.ai_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount_micro bigint NOT NULL,
  reason text NOT NULL CHECK (reason IN ('purchase','spend','refund')),
  external_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_ref, reason)
);
CREATE INDEX ai_credit_ledger_user ON public.ai_credit_ledger (user_id);
GRANT SELECT ON public.ai_credit_ledger TO authenticated;
GRANT ALL ON public.ai_credit_ledger TO service_role;
ALTER TABLE public.ai_credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own credit" ON public.ai_credit_ledger FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.fx_rates (
  day date PRIMARY KEY,
  usd_per_gbp numeric NOT NULL CHECK (usd_per_gbp > 0),
  source text NOT NULL
);
GRANT SELECT ON public.fx_rates TO authenticated;
GRANT ALL ON public.fx_rates TO service_role;
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read fx" ON public.fx_rates FOR SELECT TO authenticated USING (true);

-- Atomic charge: included allowance first, then AI Credit (AI only). Idempotent by ref.
CREATE OR REPLACE FUNCTION public.charge_spend(_user uuid, _period date, _allowance bigint, _cost bigint, _retail bigint, _kind text, _feature text, _ref text, _allow_credit boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used bigint; bal bigint; existing text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(_user::text));
  IF _ref IS NOT NULL THEN
    SELECT funded_by INTO existing FROM spend_ledger WHERE ref = _ref;
    IF FOUND THEN RETURN existing; END IF;
  END IF;
  SELECT coalesce(sum(provider_cost_micro),0) INTO used FROM spend_ledger WHERE user_id=_user AND period_start=_period AND funded_by='included';
  IF used + _cost <= _allowance OR used < _allowance THEN
    INSERT INTO spend_ledger(user_id,period_start,kind,feature,provider_cost_micro,retail_micro,funded_by,ref) VALUES (_user,_period,_kind,_feature,_cost,_retail,'included',_ref);
    RETURN 'included';
  END IF;
  IF _allow_credit THEN
    SELECT coalesce(sum(amount_micro),0) INTO bal FROM ai_credit_ledger WHERE user_id=_user;
    IF bal > 0 THEN
      INSERT INTO spend_ledger(user_id,period_start,kind,feature,provider_cost_micro,retail_micro,funded_by,ref) VALUES (_user,_period,_kind,_feature,_cost,_retail,'credit',_ref);
      INSERT INTO ai_credit_ledger(user_id,amount_micro,reason,external_ref) VALUES (_user,-_cost,'spend',_ref);
      RETURN 'credit';
    END IF;
  END IF;
  -- Already-incurred cost is still recorded truthfully; new work is blocked by the pre-check.
  INSERT INTO spend_ledger(user_id,period_start,kind,feature,provider_cost_micro,retail_micro,funded_by,ref) VALUES (_user,_period,_kind,_feature,_cost,_retail,'over',_ref);
  RETURN 'over';
END $$;
REVOKE ALL ON FUNCTION public.charge_spend(uuid,date,bigint,bigint,bigint,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_spend(uuid,date,bigint,bigint,bigint,text,text,text,boolean) TO service_role;

-- Appointment bookings (the booked appointment itself lives in commitments).
CREATE TABLE public.appointment_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  service text NOT NULL CHECK (char_length(service) BETWEEN 1 AND 80),
  request_text text,
  constraints jsonb NOT NULL DEFAULT '{}',
  preauthorised boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'searching' CHECK (status IN ('searching','awaiting_confirmation','booking_in_progress','confirmed','failed','cancellation_requested','cancelled')),
  method text CHECK (method IN ('online','phone')),
  options jsonb NOT NULL DEFAULT '[]',
  provider_name text,
  provider_url text,
  provider_phone_enc text,
  provider_address text,
  slot_date date,
  start_time time,
  end_time time,
  reference text,
  price_minor integer,
  deposit_minor integer,
  currency text,
  cancellation_terms text,
  prep_notes text,
  confirmation_source text,
  failure_reason text,
  commitment_id uuid,
  replaces_booking_id uuid,
  call_log_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
GRANT SELECT ON public.appointment_bookings TO authenticated;
GRANT ALL ON public.appointment_bookings TO service_role;
ALTER TABLE public.appointment_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own bookings" ON public.appointment_bookings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER appointment_bookings_touch BEFORE UPDATE ON public.appointment_bookings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.appointment_booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.appointment_bookings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event text NOT NULL,
  from_status text,
  to_status text,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.appointment_booking_events TO authenticated;
GRANT ALL ON public.appointment_booking_events TO service_role;
ALTER TABLE public.appointment_booking_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own booking events" ON public.appointment_booking_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER appointment_booking_events_append_only BEFORE UPDATE OR DELETE ON public.appointment_booking_events FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_changes();

ALTER TABLE public.commitments ADD COLUMN booking_id uuid, ADD COLUMN location text;
ALTER TABLE public.call_logs ADD COLUMN booking_id uuid;
ALTER TABLE public.call_campaigns DROP CONSTRAINT IF EXISTS call_campaigns_trigger_check;
ALTER TABLE public.call_campaigns ADD CONSTRAINT call_campaigns_trigger_check CHECK (trigger IN ('due','call_now','missed','morning','evening','scheduled','booking'));

-- ===== drizzle/migrations/0024_journey_planning.sql =====
-- Journey Planning (Google Maps Platform, Pro/Execute). Journeys reserve real time as protected plan_blocks; this table holds the route facts. No raw Google responses stored.

CREATE TABLE public.saved_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label text NOT NULL,
  address text NOT NULL,
  lat double precision,
  lng double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, label)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_places TO authenticated;
GRANT ALL ON public.saved_places TO service_role;
ALTER TABLE public.saved_places ENABLE ROW LEVEL SECURITY;
CREATE POLICY saved_places_owner ON public.saved_places
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  origin_label text,
  origin_address text NOT NULL,
  origin_lat double precision,
  origin_lng double precision,
  dest_label text,
  dest_address text NOT NULL,
  dest_lat double precision,
  dest_lng double precision,
  mode text NOT NULL CHECK (mode IN ('drive','transit','walk')),
  arrive_by timestamptz NOT NULL,
  leave_at timestamptz NOT NULL,
  duration_min integer NOT NULL,
  buffer_min integer NOT NULL DEFAULT 10,
  distance_m integer,
  traffic_aware boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','monitoring','leave_soon','in_progress','completed','cancelled','needs_attention')),
  appointment_id uuid REFERENCES public.appointment_bookings(id) ON DELETE SET NULL,
  plan_block_id uuid REFERENCES public.plan_blocks(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'google_maps',
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journeys_user_upcoming ON public.journeys (user_id, leave_at) WHERE status NOT IN ('completed','cancelled');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journeys TO authenticated;
GRANT ALL ON public.journeys TO service_role;
ALTER TABLE public.journeys ENABLE ROW LEVEL SECURITY;
CREATE POLICY journeys_owner ON public.journeys
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.journey_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journey_id uuid NOT NULL REFERENCES public.journeys(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journey_events_journey ON public.journey_events (journey_id, created_at);
GRANT SELECT ON public.journey_events TO authenticated;
GRANT ALL ON public.journey_events TO service_role;
ALTER TABLE public.journey_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY journey_events_owner_read ON public.journey_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Server-side geocode cache (cost control); not readable by members.
CREATE TABLE public.geocode_cache (
  query text PRIMARY KEY,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  formatted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.geocode_cache TO service_role;
ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;

commit;
