CREATE TABLE public.career_research (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id uuid REFERENCES public.goals(id) ON DELETE SET NULL,
  query text NOT NULL CHECK (char_length(query) BETWEEN 3 AND 300),
  jurisdiction text NOT NULL CHECK (char_length(jurisdiction) BETWEEN 2 AND 80),
  status text NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','failed')),
  interpretation text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, DELETE ON public.career_research TO authenticated;
GRANT ALL ON public.career_research TO service_role;
ALTER TABLE public.career_research ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own research" ON public.career_research FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "delete own research" ON public.career_research FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.research_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  research_id uuid NOT NULL REFERENCES public.career_research(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text,
  publisher text NOT NULL,
  trust text NOT NULL CHECK (trust IN ('official','education','professional_body','provider','other')),
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  content_excerpt text
);
GRANT SELECT ON public.research_sources TO authenticated;
GRANT ALL ON public.research_sources TO service_role;
ALTER TABLE public.research_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own sources" ON public.research_sources FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.research_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  research_id uuid NOT NULL REFERENCES public.career_research(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.research_sources(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('qualification','awarding_body','pathway','course','provider','prerequisite','exam_structure','registration','skills','guidance','resource','deadline')),
  statement text NOT NULL,
  quote text NOT NULL,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.research_findings TO authenticated;
GRANT ALL ON public.research_findings TO service_role;
ALTER TABLE public.research_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own findings" ON public.research_findings FOR SELECT TO authenticated USING (auth.uid() = user_id);