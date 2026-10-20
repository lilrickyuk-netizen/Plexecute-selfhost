CREATE TABLE public.exercise_demo_cache (
  exercise_key text PRIMARY KEY,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.exercise_demo_cache TO service_role;
ALTER TABLE public.exercise_demo_cache ENABLE ROW LEVEL SECURITY;