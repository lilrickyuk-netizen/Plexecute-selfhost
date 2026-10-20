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