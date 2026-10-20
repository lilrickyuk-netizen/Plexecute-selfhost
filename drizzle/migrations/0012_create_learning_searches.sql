CREATE TABLE public.learning_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  level text NOT NULL DEFAULT 'beginner',
  summary text,
  resources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_searches TO authenticated;
GRANT ALL ON public.learning_searches TO service_role;
ALTER TABLE public.learning_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own learning searches" ON public.learning_searches FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX learning_searches_user_created ON public.learning_searches (user_id, created_at DESC);