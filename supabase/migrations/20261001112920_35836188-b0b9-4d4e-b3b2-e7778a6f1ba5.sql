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