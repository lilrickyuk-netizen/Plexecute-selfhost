ALTER TABLE public.commitments ADD COLUMN IF NOT EXISTS dedupe_key text, ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'user';
CREATE UNIQUE INDEX IF NOT EXISTS commitments_user_dedupe ON public.commitments (user_id, dedupe_key);

CREATE TABLE public.scheduled_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  commitment_id uuid REFERENCES public.commitments(id) ON DELETE CASCADE,
  call_at timestamptz NOT NULL,
  purpose text NOT NULL CHECK (char_length(purpose) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','processing','placed','not_placed','held','missed_window','cancelled')),
  status_reason text,
  campaign_id uuid REFERENCES public.call_campaigns(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'coach',
  source_ref text,
  dedupe_key text NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX scheduled_calls_due ON public.scheduled_calls (status, call_at);
GRANT SELECT ON public.scheduled_calls TO authenticated;
GRANT ALL ON public.scheduled_calls TO service_role;
ALTER TABLE public.scheduled_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own scheduled calls" ON public.scheduled_calls FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER scheduled_calls_touch BEFORE UPDATE ON public.scheduled_calls FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.call_campaigns DROP CONSTRAINT IF EXISTS call_campaigns_trigger_check;
ALTER TABLE public.call_campaigns ADD CONSTRAINT call_campaigns_trigger_check CHECK (trigger IN ('due','call_now','missed','morning','evening','scheduled'));