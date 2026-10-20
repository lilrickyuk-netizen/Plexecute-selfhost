CREATE TABLE public.phone_numbers (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  e164_enc text NOT NULL,
  last4 text NOT NULL CHECK (char_length(last4) = 4),
  country text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.phone_numbers TO service_role;
ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER phone_numbers_touch BEFORE UPDATE ON public.phone_numbers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.call_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  block_id uuid REFERENCES public.plan_blocks(id) ON DELETE SET NULL,
  policy text NOT NULL CHECK (policy IN ('pro','execute')),
  trigger text NOT NULL CHECK (trigger IN ('due','call_now','missed','morning','evening')),
  state text NOT NULL DEFAULT 'CALL_QUEUED' CHECK (state IN ('CALL_ELIGIBLE','CALL_QUEUED','CALL_CREATED','RINGING','ANSWERED_PENDING_HUMAN','HUMAN_CONNECTED','MACHINE_DETECTED','NO_ANSWER','BUSY','FAILED','CANCELLED','ACKNOWLEDGED','RETRY_SCHEDULED','RETRY_POLICY_PAUSED','ALLOWANCE_EXHAUSTED')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  next_attempt_at timestamptz,
  service_month_start timestamptz NOT NULL,
  consumed_at timestamptz,
  connected_seconds integer NOT NULL DEFAULT 0,
  acknowledgement text CHECK (acknowledgement IN ('START_NOW','SNOOZE','RESCHEDULE','SKIP_WITH_REASON','BLOCKED','STOP_CALLING_FOR_THIS_TASK','STOP_ALL_CALLS')),
  stop_reason text,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX call_campaigns_due ON public.call_campaigns (state, next_attempt_at);
CREATE INDEX call_campaigns_month ON public.call_campaigns (user_id, service_month_start);
GRANT SELECT ON public.call_campaigns TO authenticated;
GRANT ALL ON public.call_campaigns TO service_role;
ALTER TABLE public.call_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own call campaigns" ON public.call_campaigns FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER call_campaigns_touch BEFORE UPDATE ON public.call_campaigns FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.call_logs
  ADD COLUMN campaign_id uuid REFERENCES public.call_campaigns(id) ON DELETE CASCADE,
  ADD COLUMN attempt_no integer,
  ADD COLUMN provider_status text,
  ADD COLUMN answered_by text,
  ADD COLUMN duration_sec integer,
  ADD COLUMN connected_seconds integer NOT NULL DEFAULT 0;

ALTER TABLE public.plan_blocks ADD COLUMN call_requested boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles
  ADD COLUMN calls_stopped_at timestamptz,
  ADD COLUMN call_consent_version text,
  ADD COLUMN call_consent_at timestamptz;