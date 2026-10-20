ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_channel_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_channel_check CHECK (channel IN ('in_app','push','email','call'));
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_block_id_channel_key;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('reminder','adaptive','system'));
ALTER TABLE public.notifications
  ADD COLUMN category text NOT NULL DEFAULT 'UPCOMING' CHECK (category IN ('UPCOMING','DUE','MISSED','PLAN_CHANGED','WEEKLY_REVIEW','EXPERIMENT','ACCOUNT','BILLING','SAFETY')),
  ADD COLUMN intent text NOT NULL DEFAULT 'session_reminder',
  ADD COLUMN plan_version_id uuid REFERENCES public.plan_versions(id) ON DELETE SET NULL,
  ADD COLUMN dedupe_key text,
  ADD COLUMN scheduled_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN provider_result jsonb,
  ADD COLUMN last_error text,
  ADD COLUMN interaction text CHECK (interaction IN ('opened','acted','dismissed')),
  ADD COLUMN interaction_at timestamptz,
  ADD COLUMN link text;
UPDATE public.notifications SET dedupe_key = coalesce(block_id::text, id::text) || ':' || channel || ':' || kind,
  sent_at = created_at, category = CASE WHEN kind = 'adaptive' THEN 'DUE' ELSE 'UPCOMING' END,
  intent = CASE WHEN kind = 'adaptive' THEN 'due_nudge' ELSE 'session_reminder' END;
ALTER TABLE public.notifications ALTER COLUMN dedupe_key SET NOT NULL;
ALTER TABLE public.notifications ALTER COLUMN status SET DEFAULT 'queued';
ALTER TABLE public.notifications ADD CONSTRAINT notifications_status_check CHECK (status IN ('queued','sending','sent','failed','retrying','skipped','suppressed'));
CREATE UNIQUE INDEX notifications_dedupe ON public.notifications (user_id, dedupe_key);
CREATE INDEX notifications_due ON public.notifications (status, next_attempt_at) WHERE status IN ('queued','retrying');

CREATE TABLE public.push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('expo','apns','fcm')),
  token text NOT NULL,
  device_name text CHECK (char_length(device_name) <= 80),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invalid','removed')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, token)
);
GRANT SELECT ON public.push_devices TO authenticated;
GRANT ALL ON public.push_devices TO service_role;
ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own push devices" ON public.push_devices FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.notification_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('UPCOMING','DUE','MISSED','PLAN_CHANGED','WEEKLY_REVIEW','EXPERIMENT','ACCOUNT','BILLING','SAFETY')),
  in_app boolean NOT NULL DEFAULT true,
  push boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own notification prefs" ON public.notification_preferences FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER notification_preferences_touch BEFORE UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();