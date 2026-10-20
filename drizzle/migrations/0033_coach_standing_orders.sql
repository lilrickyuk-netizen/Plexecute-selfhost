CREATE TABLE public.coach_standing_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('weekly_plan','meals')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  goal_id uuid,
  target_weight_kg numeric,
  active boolean NOT NULL DEFAULT true,
  ended_reason text,
  last_run_at timestamptz,
  last_result jsonb,
  source_message uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX coach_standing_orders_one_active ON public.coach_standing_orders (user_id, kind) WHERE active;
GRANT SELECT, UPDATE ON public.coach_standing_orders TO authenticated;
GRANT ALL ON public.coach_standing_orders TO service_role;
ALTER TABLE public.coach_standing_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read their standing orders" ON public.coach_standing_orders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Members can stop their standing orders" ON public.coach_standing_orders FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);