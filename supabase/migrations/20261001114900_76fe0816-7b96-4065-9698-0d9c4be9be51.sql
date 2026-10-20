
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
