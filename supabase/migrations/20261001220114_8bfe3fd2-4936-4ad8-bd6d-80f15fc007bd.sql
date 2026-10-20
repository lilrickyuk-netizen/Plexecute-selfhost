ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS sleep_target_hours numeric NOT NULL DEFAULT 8 CHECK (sleep_target_hours BETWEEN 4 AND 12);
ALTER TABLE public.recovery_checkins ADD COLUMN IF NOT EXISTS ill_or_injured boolean NOT NULL DEFAULT false;
ALTER TABLE public.recovery_checkins ADD COLUMN IF NOT EXISTS recovery_version text;