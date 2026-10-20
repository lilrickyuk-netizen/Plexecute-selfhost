ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS call_allowed_kinds text[] NULL,
  ADD COLUMN IF NOT EXISTS call_max_minutes integer NOT NULL DEFAULT 3 CHECK (call_max_minutes BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS call_voicemail_policy text NOT NULL DEFAULT 'none' CHECK (call_voicemail_policy IN ('none','generic')),
  ADD COLUMN IF NOT EXISTS call_style text NULL CHECK (call_style IS NULL OR call_style IN ('supportive','direct','disciplined','calm','competitive'));