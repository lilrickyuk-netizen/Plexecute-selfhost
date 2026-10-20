CREATE TABLE public.coach_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','failed','expired')),
  result jsonb,
  source_message uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
GRANT SELECT ON public.coach_pending_actions TO authenticated;
GRANT ALL ON public.coach_pending_actions TO service_role;
ALTER TABLE public.coach_pending_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read own pending coach actions" ON public.coach_pending_actions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX coach_pending_actions_user_idx ON public.coach_pending_actions (user_id, created_at DESC);