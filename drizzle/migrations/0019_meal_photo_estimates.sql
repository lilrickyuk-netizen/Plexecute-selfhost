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