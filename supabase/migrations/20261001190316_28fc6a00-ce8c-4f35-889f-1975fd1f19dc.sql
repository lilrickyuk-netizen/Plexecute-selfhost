CREATE TABLE public.commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('shift','meeting','appointment','family','study','travel','other')),
  recurrence text NOT NULL CHECK (recurrence IN ('weekly','once')),
  days integer[] NOT NULL DEFAULT '{}',
  on_date date,
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_hard boolean NOT NULL DEFAULT true,
  note text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK ((recurrence = 'weekly' AND cardinality(days) > 0 AND days <@ ARRAY[1,2,3,4,5,6,7]) OR (recurrence = 'once' AND on_date IS NOT NULL))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commitments TO authenticated;
GRANT ALL ON public.commitments TO service_role;
ALTER TABLE public.commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage commitments" ON public.commitments FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER commitments_touch BEFORE UPDATE ON public.commitments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();