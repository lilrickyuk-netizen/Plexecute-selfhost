ALTER TABLE public.profiles
  ADD COLUMN units text NOT NULL DEFAULT 'metric' CHECK (units IN ('metric','imperial')),
  ADD COLUMN enabled_domains text[] NOT NULL DEFAULT ARRAY['training','cardio','mobility','nutrition','sleep','learning','career','wellness','work_prep','meal_prep','admin','other'],
  ADD COLUMN intended_use text[] NOT NULL DEFAULT '{}';