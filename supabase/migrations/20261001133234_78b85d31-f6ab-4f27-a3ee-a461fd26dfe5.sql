CREATE TABLE public.movement_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('cardio','mobility')),
  modality text NOT NULL,
  level integer NOT NULL DEFAULT 1,
  prescribed jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_min integer NOT NULL CHECK (duration_min BETWEEN 1 AND 600),
  rpe integer CHECK (rpe BETWEEN 1 AND 10),
  tolerance text CHECK (tolerance IN ('easy','right','hard')),
  completed boolean NOT NULL DEFAULT true,
  pain_flag boolean NOT NULL DEFAULT false,
  note text,
  policy_version text NOT NULL,
  performed_on date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.movement_sessions TO authenticated;
GRANT ALL ON public.movement_sessions TO service_role;
ALTER TABLE public.movement_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read movement sessions" ON public.movement_sessions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX movement_sessions_user_idx ON public.movement_sessions(user_id, kind, performed_on DESC);