ALTER TABLE public.push_devices DROP CONSTRAINT IF EXISTS push_devices_platform_check;
ALTER TABLE public.push_devices ADD CONSTRAINT push_devices_platform_check CHECK (platform = ANY (ARRAY['expo','apns','fcm','web']));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_muted_kinds text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_motivating boolean NOT NULL DEFAULT true;