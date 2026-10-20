CREATE TABLE public.guided_video_cache (
  key text PRIMARY KEY,
  activity text NOT NULL,
  focus text NOT NULL,
  minutes integer NOT NULL,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.guided_video_cache TO service_role;
ALTER TABLE public.guided_video_cache ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.wellness_sessions
  ADD COLUMN activity text NOT NULL DEFAULT 'meditation',
  ADD COLUMN focus text,
  ADD COLUMN video jsonb,
  ADD COLUMN feedback text,
  ADD COLUMN client_id uuid;
ALTER TABLE public.wellness_sessions ADD CONSTRAINT wellness_sessions_activity_chk CHECK (activity IN ('meditation','yoga'));
ALTER TABLE public.wellness_sessions ADD CONSTRAINT wellness_sessions_feedback_chk CHECK (feedback IS NULL OR feedback IN ('helpful','okay','not_for_me'));
CREATE UNIQUE INDEX wellness_sessions_client_uidx ON public.wellness_sessions(user_id, client_id) WHERE client_id IS NOT NULL;