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