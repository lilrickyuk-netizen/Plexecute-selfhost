CREATE TABLE public.learning_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.learning_topics(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  position integer NOT NULL DEFAULT 0,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_topics TO authenticated;
GRANT ALL ON public.learning_topics TO service_role;
ALTER TABLE public.learning_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own topics" ON public.learning_topics FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.learning_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  kind text NOT NULL DEFAULT 'book' CHECK (kind IN ('book','course','video','article','notes','past_paper','other')),
  url text,
  total_units integer CHECK (total_units IS NULL OR total_units > 0),
  done_units integer NOT NULL DEFAULT 0,
  content text CHECK (content IS NULL OR char_length(content) <= 20000),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_resources TO authenticated;
GRANT ALL ON public.learning_resources TO service_role;
ALTER TABLE public.learning_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own resources" ON public.learning_resources FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.retrieval_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  topic_id uuid REFERENCES public.learning_topics(id) ON DELETE SET NULL,
  resource_id uuid REFERENCES public.learning_resources(id) ON DELETE SET NULL,
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 1000),
  answer text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 2000),
  generated boolean NOT NULL DEFAULT false,
  interval_step integer NOT NULL DEFAULT 0,
  due_on date NOT NULL DEFAULT current_date,
  policy_version text NOT NULL DEFAULT 'learning_review_v1',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retrieval_items TO authenticated;
GRANT ALL ON public.retrieval_items TO service_role;
ALTER TABLE public.retrieval_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own items" ON public.retrieval_items FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.retrieval_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.retrieval_items(id) ON DELETE CASCADE,
  correct boolean NOT NULL,
  from_step integer NOT NULL,
  to_step integer NOT NULL,
  next_due date NOT NULL,
  policy_version text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.retrieval_reviews TO authenticated;
GRANT ALL ON public.retrieval_reviews TO service_role;
ALTER TABLE public.retrieval_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own reviews" ON public.retrieval_reviews FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.learning_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  kind text NOT NULL DEFAULT 'self_test' CHECK (kind IN ('self_test','mock','exam','assignment')),
  due_on date,
  score numeric CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  evidence text CHECK (evidence IS NULL OR char_length(evidence) <= 1000),
  taken_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learning_assessments TO authenticated;
GRANT ALL ON public.learning_assessments TO service_role;
ALTER TABLE public.learning_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own assessments" ON public.learning_assessments FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);