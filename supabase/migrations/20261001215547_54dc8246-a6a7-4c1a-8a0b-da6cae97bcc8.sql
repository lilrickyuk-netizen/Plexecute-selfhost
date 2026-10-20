ALTER TABLE public.meal_plans DROP CONSTRAINT IF EXISTS meal_plans_status_check;
ALTER TABLE public.meal_plans ADD CONSTRAINT meal_plans_status_check CHECK (status IN ('proposed','approved','rejected','superseded','active'));
ALTER TABLE public.meal_plans ALTER COLUMN status SET DEFAULT 'proposed';
ALTER TABLE public.meal_plans ADD COLUMN IF NOT EXISTS decision_note text;