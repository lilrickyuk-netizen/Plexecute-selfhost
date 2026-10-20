-- Combined AI + call spend against the included monthly allowance, and Plexecute AI Credit.
CREATE TABLE public.spend_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period_start date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ai','call')),
  feature text NOT NULL,
  provider_cost_micro bigint NOT NULL CHECK (provider_cost_micro >= 0),
  retail_micro bigint NOT NULL CHECK (retail_micro >= 0),
  funded_by text NOT NULL CHECK (funded_by IN ('included','credit','over')),
  ref text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX spend_ledger_user_period ON public.spend_ledger (user_id, period_start);
GRANT SELECT ON public.spend_ledger TO authenticated;
GRANT ALL ON public.spend_ledger TO service_role;
ALTER TABLE public.spend_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own spend" ON public.spend_ledger FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.ai_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount_micro bigint NOT NULL,
  reason text NOT NULL CHECK (reason IN ('purchase','spend','refund')),
  external_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_ref, reason)
);
CREATE INDEX ai_credit_ledger_user ON public.ai_credit_ledger (user_id);
GRANT SELECT ON public.ai_credit_ledger TO authenticated;
GRANT ALL ON public.ai_credit_ledger TO service_role;
ALTER TABLE public.ai_credit_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own credit" ON public.ai_credit_ledger FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.fx_rates (
  day date PRIMARY KEY,
  usd_per_gbp numeric NOT NULL CHECK (usd_per_gbp > 0),
  source text NOT NULL
);
GRANT SELECT ON public.fx_rates TO authenticated;
GRANT ALL ON public.fx_rates TO service_role;
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read fx" ON public.fx_rates FOR SELECT TO authenticated USING (true);

-- Atomic charge: included allowance first, then AI Credit (AI only). Idempotent by ref.
CREATE OR REPLACE FUNCTION public.charge_spend(_user uuid, _period date, _allowance bigint, _cost bigint, _retail bigint, _kind text, _feature text, _ref text, _allow_credit boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used bigint; bal bigint; existing text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(_user::text));
  IF _ref IS NOT NULL THEN
    SELECT funded_by INTO existing FROM spend_ledger WHERE ref = _ref;
    IF FOUND THEN RETURN existing; END IF;
  END IF;
  SELECT coalesce(sum(provider_cost_micro),0) INTO used FROM spend_ledger WHERE user_id=_user AND period_start=_period AND funded_by='included';
  IF used + _cost <= _allowance OR used < _allowance THEN
    INSERT INTO spend_ledger(user_id,period_start,kind,feature,provider_cost_micro,retail_micro,funded_by,ref) VALUES (_user,_period,_kind,_feature,_cost,_retail,'included',_ref);
    RETURN 'included';
  END IF;
  IF _allow_credit THEN
    SELECT coalesce(sum(amount_micro),0) INTO bal FROM ai_credit_ledger WHERE user_id=_user;
    IF bal > 0 THEN
      INSERT INTO spend_ledger(user_id,period_start,kind,feature,provider_cost_micro,retail_micro,funded_by,ref) VALUES (_user,_period,_kind,_feature,_cost,_retail,'credit',_ref);
      INSERT INTO ai_credit_ledger(user_id,amount_micro,reason,external_ref) VALUES (_user,-_cost,'spend',_ref);
      RETURN 'credit';
    END IF;
  END IF;
  -- Already-incurred cost is still recorded truthfully; new work is blocked by the pre-check.
  INSERT INTO spend_ledger(user_id,period_start,kind,feature,provider_cost_micro,retail_micro,funded_by,ref) VALUES (_user,_period,_kind,_feature,_cost,_retail,'over',_ref);
  RETURN 'over';
END $$;
REVOKE ALL ON FUNCTION public.charge_spend(uuid,date,bigint,bigint,bigint,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charge_spend(uuid,date,bigint,bigint,bigint,text,text,text,boolean) TO service_role;

-- Appointment bookings (the booked appointment itself lives in commitments).
CREATE TABLE public.appointment_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  service text NOT NULL CHECK (char_length(service) BETWEEN 1 AND 80),
  request_text text,
  constraints jsonb NOT NULL DEFAULT '{}',
  preauthorised boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'searching' CHECK (status IN ('searching','awaiting_confirmation','booking_in_progress','confirmed','failed','cancellation_requested','cancelled')),
  method text CHECK (method IN ('online','phone')),
  options jsonb NOT NULL DEFAULT '[]',
  provider_name text,
  provider_url text,
  provider_phone_enc text,
  provider_address text,
  slot_date date,
  start_time time,
  end_time time,
  reference text,
  price_minor integer,
  deposit_minor integer,
  currency text,
  cancellation_terms text,
  prep_notes text,
  confirmation_source text,
  failure_reason text,
  commitment_id uuid,
  replaces_booking_id uuid,
  call_log_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
GRANT SELECT ON public.appointment_bookings TO authenticated;
GRANT ALL ON public.appointment_bookings TO service_role;
ALTER TABLE public.appointment_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own bookings" ON public.appointment_bookings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER appointment_bookings_touch BEFORE UPDATE ON public.appointment_bookings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.appointment_booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.appointment_bookings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event text NOT NULL,
  from_status text,
  to_status text,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.appointment_booking_events TO authenticated;
GRANT ALL ON public.appointment_booking_events TO service_role;
ALTER TABLE public.appointment_booking_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own booking events" ON public.appointment_booking_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER appointment_booking_events_append_only BEFORE UPDATE OR DELETE ON public.appointment_booking_events FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_changes();

ALTER TABLE public.commitments ADD COLUMN booking_id uuid, ADD COLUMN location text;
ALTER TABLE public.call_logs ADD COLUMN booking_id uuid;
ALTER TABLE public.call_campaigns DROP CONSTRAINT IF EXISTS call_campaigns_trigger_check;
ALTER TABLE public.call_campaigns ADD CONSTRAINT call_campaigns_trigger_check CHECK (trigger IN ('due','call_now','missed','morning','evening','scheduled','booking'));