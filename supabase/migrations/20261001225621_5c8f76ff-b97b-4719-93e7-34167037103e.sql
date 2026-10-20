CREATE TABLE public.goal_intentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('intention','obstacle','cue')),
  when_text text NOT NULL CHECK (char_length(when_text) BETWEEN 1 AND 200),
  then_text text NOT NULL CHECK (char_length(then_text) BETWEEN 1 AND 200),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goal_intentions TO authenticated;
GRANT ALL ON public.goal_intentions TO service_role;
ALTER TABLE public.goal_intentions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own intentions" ON public.goal_intentions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.goal_reflections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
  went_well text,
  got_in_way text,
  change_next text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.goal_reflections TO authenticated;
GRANT ALL ON public.goal_reflections TO service_role;
ALTER TABLE public.goal_reflections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own reflections" ON public.goal_reflections FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.plan_block_events ADD COLUMN missed_reason text CHECK (missed_reason IN ('TIME_CONFLICT','WORK_OVERRUN','FAMILY_COMMITMENT','TRAVEL','LOW_ENERGY','POOR_SLEEP','FORGOT','ENVIRONMENT_UNAVAILABLE','PAIN_OR_INJURY','ILLNESS','MOTIVATION','TASK_TOO_LARGE','PLAN_UNCLEAR','OTHER','DECLINE_TO_SAY'));