ALTER TABLE public.workout_sets ADD COLUMN IF NOT EXISTS client_op_id text, ADD COLUMN IF NOT EXISTS client_recorded_at timestamptz;
ALTER TABLE public.food_entries ADD COLUMN IF NOT EXISTS client_op_id text, ADD COLUMN IF NOT EXISTS client_recorded_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS workout_sets_client_op_uniq ON public.workout_sets(user_id, client_op_id) WHERE client_op_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS food_entries_client_op_uniq ON public.food_entries(user_id, client_op_id) WHERE client_op_id IS NOT NULL;