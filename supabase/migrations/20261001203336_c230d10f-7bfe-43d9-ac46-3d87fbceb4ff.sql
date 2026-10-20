ALTER TABLE public.plan_blocks
  ADD COLUMN occurrence_kind text NOT NULL DEFAULT 'personal_task',
  ADD COLUMN source_type text NOT NULL DEFAULT 'goal',
  ADD COLUMN source_ref text,
  ADD COLUMN commitment_id uuid REFERENCES public.commitments(id) ON DELETE SET NULL;
ALTER TABLE public.plan_blocks ADD CONSTRAINT plan_blocks_occurrence_kind_chk CHECK (occurrence_kind IN ('wake_for_work','meeting_prep','study','workout','cardio','mobility','meal_prep','meditation','appointment_prep','personal_task','recovery_action','work_task','learning','other'));
ALTER TABLE public.plan_blocks ADD CONSTRAINT plan_blocks_source_type_chk CHECK (source_type IN ('goal','commitment','routine','recovery','makeup','manual'));
CREATE UNIQUE INDEX plan_blocks_source_unique ON public.plan_blocks(user_id, source_type, source_ref) WHERE source_ref IS NOT NULL AND status <> 'rescheduled';
UPDATE public.plan_blocks SET occurrence_kind = CASE domain
  WHEN 'training' THEN 'workout' WHEN 'fitness' THEN 'workout' WHEN 'cardio' THEN 'cardio' WHEN 'mobility' THEN 'mobility'
  WHEN 'wellness' THEN 'meditation' WHEN 'learning' THEN 'learning' WHEN 'study' THEN 'study' WHEN 'work' THEN 'work_task'
  WHEN 'nutrition' THEN 'meal_prep' WHEN 'meal_prep' THEN 'meal_prep' WHEN 'recovery' THEN 'recovery_action' ELSE 'personal_task' END,
  source_type = CASE WHEN note LIKE 'makeup:%' THEN 'makeup' WHEN goal_id IS NULL THEN 'manual' ELSE 'goal' END;
ALTER TABLE public.workout_sessions ADD COLUMN block_id uuid REFERENCES public.plan_blocks(id) ON DELETE SET NULL;