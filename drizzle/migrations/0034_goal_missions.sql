CREATE TABLE public.goal_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  goal_id uuid,
  title text NOT NULL,
  state text NOT NULL DEFAULT 'CAPTURED' CHECK (state IN ('CAPTURED','UNDERSTANDING','RESEARCHING','MODELLING','FEASIBILITY_CHECK','PATHWAY_READY','PLANNING','SCHEDULED','EXECUTING','BLOCKED','ADAPTING','VERIFYING','ACHIEVED')),
  tier text NOT NULL DEFAULT 'simple' CHECK (tier IN ('simple','moderate','complex')),
  experts text[] NOT NULL DEFAULT '{}',
  contract jsonb NOT NULL DEFAULT '{}'::jsonb,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  council jsonb NOT NULL DEFAULT '{}'::jsonb,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_signal jsonb,
  last_signal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX goal_missions_one_per_goal ON public.goal_missions (user_id, goal_id) WHERE goal_id IS NOT NULL;
CREATE INDEX goal_missions_user ON public.goal_missions (user_id, updated_at DESC);
GRANT SELECT ON public.goal_missions TO authenticated;
GRANT ALL ON public.goal_missions TO service_role;
ALTER TABLE public.goal_missions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read their missions" ON public.goal_missions FOR SELECT TO authenticated USING (auth.uid() = user_id);