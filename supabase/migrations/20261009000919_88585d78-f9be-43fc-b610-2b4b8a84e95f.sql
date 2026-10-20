-- Keep only the newest applied and newest proposed nutrition target per member.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY user_id, status ORDER BY created_at DESC, id DESC) AS rn
  FROM public.nutrition_targets WHERE status IN ('applied','proposed')
)
UPDATE public.nutrition_targets t SET status = 'superseded' FROM ranked r WHERE t.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS nutrition_targets_one_applied ON public.nutrition_targets (user_id) WHERE status = 'applied';
CREATE UNIQUE INDEX IF NOT EXISTS nutrition_targets_one_proposed ON public.nutrition_targets (user_id) WHERE status = 'proposed';