CREATE TABLE public.support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('account','billing','plan','calls','integrations','bug','other')),
  message text NOT NULL,
  tier text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('standard','priority')),
  target_label text NOT NULL,
  diagnostics jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.support_requests TO authenticated;
GRANT ALL ON public.support_requests TO service_role;
ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read own support requests" ON public.support_requests FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX support_requests_user ON public.support_requests (user_id, created_at DESC);