ALTER TABLE public.profiles
  ADD COLUMN call_morning_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN call_morning_time time NOT NULL DEFAULT '08:00',
  ADD COLUMN call_due_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN call_missed_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN call_evening_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN call_evening_time time NOT NULL DEFAULT '20:00',
  ADD COLUMN call_max_attempts integer NOT NULL DEFAULT 6 CHECK (call_max_attempts BETWEEN 1 AND 6);
UPDATE public.profiles SET call_evening_enabled = calls_enabled, call_evening_time = call_time WHERE tier = 'execute';