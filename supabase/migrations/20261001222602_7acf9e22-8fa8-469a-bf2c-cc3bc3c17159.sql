ALTER TABLE public.coach_messages ADD COLUMN mode text NOT NULL DEFAULT 'COACH' CHECK (mode IN ('EXPERT','COACH','EXECUTION','REVIEW')),
  ADD COLUMN actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN tool_trace jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN contract jsonb;

CREATE TABLE public.coach_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.coach_messages(id) ON DELETE SET NULL,
  tool text NOT NULL,
  allowed boolean NOT NULL,
  reason text,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.coach_tool_calls TO authenticated;
GRANT ALL ON public.coach_tool_calls TO service_role;
ALTER TABLE public.coach_tool_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read their own coach tool calls" ON public.coach_tool_calls FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX coach_tool_calls_user_tool_idx ON public.coach_tool_calls(user_id, tool, created_at DESC);