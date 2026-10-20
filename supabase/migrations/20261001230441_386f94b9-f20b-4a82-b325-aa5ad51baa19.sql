CREATE TABLE public.behaviour_feedback (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  observation_key text NOT NULL CHECK (char_length(observation_key) <= 80),
  verdict text NOT NULL CHECK (verdict IN ('hidden','wrong')),
  note text CHECK (char_length(note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, observation_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.behaviour_feedback TO authenticated;
GRANT ALL ON public.behaviour_feedback TO service_role;
ALTER TABLE public.behaviour_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own behaviour feedback" ON public.behaviour_feedback FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);