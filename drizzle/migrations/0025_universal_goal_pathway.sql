ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS success_type text,
  ADD COLUMN IF NOT EXISTS success_definition text,
  ADD COLUMN IF NOT EXISTS jurisdiction text,
  ADD COLUMN IF NOT EXISTS priority_class text,
  ADD COLUMN IF NOT EXISTS budget_available numeric,
  ADD COLUMN IF NOT EXISTS monthly_saving numeric,
  ADD COLUMN IF NOT EXISTS pathway jsonb;
ALTER TABLE public.goal_milestones
  ADD COLUMN IF NOT EXISTS key text,
  ADD COLUMN IF NOT EXISTS stage integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS depends_on text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS evidence_type text,
  ADD COLUMN IF NOT EXISTS evidence_note text,
  ADD COLUMN IF NOT EXISTS effort_hours numeric,
  ADD COLUMN IF NOT EXISTS min_weeks integer,
  ADD COLUMN IF NOT EXISTS cost numeric,
  ADD COLUMN IF NOT EXISTS capability text,
  ADD COLUMN IF NOT EXISTS is_major boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.goal_milestones DROP CONSTRAINT IF EXISTS goal_milestones_status_check;
ALTER TABLE public.goal_milestones ADD CONSTRAINT goal_milestones_status_check
  CHECK (status IN ('pending','active','blocked','failed','done'));
ALTER TABLE public.goals DROP CONSTRAINT IF EXISTS goals_success_type_check;
ALTER TABLE public.goals ADD CONSTRAINT goals_success_type_check
  CHECK (success_type IS NULL OR success_type IN ('binary','measurable','milestones','external'));
UPDATE public.goal_milestones SET status='done' WHERE done_at IS NOT NULL AND status='pending';