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