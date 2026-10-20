CREATE TABLE public.auto_adapt_permissions (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission IN ('MOVE_NONPROTECTED_TASK_WITHIN_DAY','MOVE_NONPROTECTED_TASK_WITHIN_24H','ADJUST_WORKOUT_LOAD_WITHIN_ENGINE_RULE','ADJUST_NUTRITION_TARGET_WITHIN_150_KCAL_WEEKLY','CHANGE_REMINDER_TIMING')),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);
GRANT SELECT, INSERT, UPDATE ON public.auto_adapt_permissions TO authenticated;
GRANT ALL ON public.auto_adapt_permissions TO service_role;
ALTER TABLE public.auto_adapt_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own auto-adapt permissions" ON public.auto_adapt_permissions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER auto_adapt_touch BEFORE UPDATE ON public.auto_adapt_permissions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();