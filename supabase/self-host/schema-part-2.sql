-- Plexecute database setup, part 2 of 2.
-- Run the parts in order in Supabase → SQL Editor (paste the whole file, click Run).
-- Each part runs as one transaction: if anything fails, nothing in that part is applied.
-- Contains: drizzle/migrations/0025_universal_goal_pathway.sql … drizzle/migrations/0042_pro_calls_shared_allowance_only.sql

begin;

-- ===== drizzle/migrations/0025_universal_goal_pathway.sql =====
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

-- ===== drizzle/migrations/0026_booking_reservations_checkout.sql =====
ALTER TABLE public.appointment_bookings
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'appointment',
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS checkout_url text,
  ADD COLUMN IF NOT EXISTS checkout_amount_minor integer,
  ADD COLUMN IF NOT EXISTS checkout_fee_minor integer,
  ADD COLUMN IF NOT EXISTS checkout_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_state text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS preauthorisation jsonb;
ALTER TABLE public.appointment_bookings ADD CONSTRAINT appointment_bookings_kind_check CHECK (kind IN ('appointment','reservation','order'));
ALTER TABLE public.appointment_bookings ADD CONSTRAINT appointment_bookings_payment_state_check CHECK (payment_state IN ('none','checkout_ready','paid_confirmed','expired','abandoned'));
ALTER TABLE public.appointment_bookings DROP CONSTRAINT IF EXISTS appointment_bookings_status_check;
ALTER TABLE public.appointment_bookings ADD CONSTRAINT appointment_bookings_status_check CHECK (status IN ('searching','awaiting_confirmation','booking_in_progress','checkout_ready','expired','confirmed','failed','cancellation_requested','cancelled'));
ALTER TABLE public.appointment_bookings ADD CONSTRAINT appointment_bookings_checkout_https CHECK (checkout_url IS NULL OR checkout_url ~ '^https://');
COMMENT ON COLUMN public.appointment_bookings.details IS 'Category-specific booking/order details (party size, cuisine, dietary, recipient, vehicle...). Never payment card data.';

-- ===== drizzle/migrations/0027_migration.sql =====
CREATE TABLE public.life_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  goal_id uuid REFERENCES public.goals(id) ON DELETE CASCADE,
  link_key text NOT NULL,
  from_kind text NOT NULL,
  from_ref text NOT NULL,
  to_kind text NOT NULL,
  to_ref text NOT NULL,
  relation text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  UNIQUE (user_id, link_key)
);
GRANT SELECT ON public.life_links TO authenticated;
GRANT ALL ON public.life_links TO service_role;
ALTER TABLE public.life_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own links readable" ON public.life_links FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX life_links_user_live ON public.life_links (user_id) WHERE invalidated_at IS NULL;

CREATE TABLE public.intelligence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('multi_domain','daily_brief','weekly_review','signal_generated','signal_accepted','conflict_detected','pattern_detected','pathway_confidence','goal_behind','blocker_open')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.intelligence_events TO authenticated;
GRANT ALL ON public.intelligence_events TO service_role;
ALTER TABLE public.intelligence_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own intelligence events readable" ON public.intelligence_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX intelligence_events_kind_time ON public.intelligence_events (kind, created_at);

ALTER TABLE public.plan_versions ADD COLUMN IF NOT EXISTS rationale jsonb;

CREATE OR REPLACE FUNCTION public.owner_intelligence(_from timestamptz, _to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'multiDomain', (SELECT count(*) FROM intelligence_events WHERE kind='multi_domain' AND created_at BETWEEN _from AND _to),
    'dailyBriefs', (SELECT count(*) FROM intelligence_events WHERE kind='daily_brief' AND created_at BETWEEN _from AND _to),
    'weeklyReviews', (SELECT count(*) FROM intelligence_events WHERE kind='weekly_review' AND created_at BETWEEN _from AND _to),
    'signals', (SELECT count(*) FROM intelligence_events WHERE kind='signal_generated' AND created_at BETWEEN _from AND _to),
    'signalsAccepted', (SELECT count(*) FROM intelligence_events WHERE kind='signal_accepted' AND created_at BETWEEN _from AND _to),
    'conflicts', (SELECT count(DISTINCT user_id) FROM intelligence_events WHERE kind='conflict_detected' AND created_at BETWEEN _from AND _to),
    'goalsBehind', (SELECT count(DISTINCT user_id) FROM intelligence_events WHERE kind='goal_behind' AND created_at BETWEEN _from AND _to),
    'blockers', (SELECT count(DISTINCT user_id) FROM intelligence_events WHERE kind='blocker_open' AND created_at BETWEEN _from AND _to),
    'confidence', COALESCE((SELECT jsonb_object_agg(lvl, n) FROM (SELECT detail->>'level' lvl, count(*) n FROM intelligence_events WHERE kind='pathway_confidence' AND created_at BETWEEN _from AND _to GROUP BY 1) c), '{}'::jsonb),
    'failureReasons', COALESCE((SELECT jsonb_object_agg(cause, n) FROM (SELECT detail->>'cause' cause, count(*) n FROM intelligence_events WHERE kind='pattern_detected' AND created_at BETWEEN _from AND _to GROUP BY 1) c), '{}'::jsonb),
    'goalDomains', COALESCE((SELECT jsonb_object_agg(domain, n) FROM (SELECT domain, count(*) n FROM goals WHERE status IN ('active','proposed') GROUP BY 1) g), '{}'::jsonb)
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.owner_intelligence(timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_intelligence(timestamptz, timestamptz) TO authenticated;

-- ===== drizzle/migrations/0028_call_approval_basis.sql =====
ALTER TABLE public.call_market_manifest ADD COLUMN IF NOT EXISTS approval_basis text NOT NULL DEFAULT 'not_reviewed';
UPDATE public.call_market_manifest SET approval_basis = CASE WHEN review_ref IS NOT NULL AND signed_off_by IS NOT NULL THEN 'externally_reviewed' WHEN signed_off_by IS NOT NULL THEN 'owner_self_approval' ELSE 'not_reviewed' END;

-- ===== drizzle/migrations/0029_call_manifest_owner_approval.sql =====
ALTER TABLE public.call_market_manifest DROP CONSTRAINT call_market_manifest_check;
ALTER TABLE public.call_market_manifest ADD CONSTRAINT call_market_manifest_check CHECK ((NOT enabled) OR (signed_off_by IS NOT NULL AND signed_off_at IS NOT NULL AND consent_version IS NOT NULL AND disclosure_version IS NOT NULL AND permitted_start IS NOT NULL AND permitted_end IS NOT NULL));

-- ===== drizzle/migrations/0030_cancel_calls_when_commitment_off.sql =====
CREATE OR REPLACE FUNCTION public.cancel_calls_for_commitment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.scheduled_calls SET status = 'cancelled', status_reason = 'commitment_removed'
      WHERE commitment_id = OLD.id AND status = 'scheduled';
    RETURN OLD;
  ELSIF NEW.active = false AND OLD.active IS DISTINCT FROM false THEN
    UPDATE public.scheduled_calls SET status = 'cancelled', status_reason = 'commitment_paused'
      WHERE commitment_id = NEW.id AND status = 'scheduled';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS commitments_cancel_calls ON public.commitments;
CREATE TRIGGER commitments_cancel_calls BEFORE DELETE OR UPDATE OF active ON public.commitments
FOR EACH ROW EXECUTE FUNCTION public.cancel_calls_for_commitment();

-- ===== drizzle/migrations/0031_cron_token_verify.sql =====
create extension if not exists pg_net;
create table if not exists public.internal_cron_tokens (name text primary key, token text not null, created_at timestamptz not null default now());
grant all on public.internal_cron_tokens to service_role;
revoke all on public.internal_cron_tokens from anon, authenticated;
alter table public.internal_cron_tokens enable row level security;
insert into public.internal_cron_tokens(name, token) values ('scheduler', encode(extensions.gen_random_bytes(32),'hex')) on conflict (name) do nothing;
create or replace function public.verify_cron_token(p_token text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.internal_cron_tokens where name = 'scheduler' and token = p_token and length(coalesce(p_token,'')) >= 32)
$$;
revoke all on function public.verify_cron_token(text) from public, anon, authenticated;
grant execute on function public.verify_cron_token(text) to service_role;

-- ===== drizzle/migrations/0032_goal_preferred_days_start.sql =====
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS preferred_days smallint[] NULL, ADD COLUMN IF NOT EXISTS preferred_start time NULL;
ALTER TABLE public.goals ADD CONSTRAINT goals_preferred_days_valid CHECK (preferred_days IS NULL OR (preferred_days <@ ARRAY[1,2,3,4,5,6,7]::smallint[] AND cardinality(preferred_days) BETWEEN 1 AND 7));

-- ===== drizzle/migrations/0033_coach_standing_orders.sql =====
CREATE TABLE public.coach_standing_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('weekly_plan','meals')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  goal_id uuid,
  target_weight_kg numeric,
  active boolean NOT NULL DEFAULT true,
  ended_reason text,
  last_run_at timestamptz,
  last_result jsonb,
  source_message uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX coach_standing_orders_one_active ON public.coach_standing_orders (user_id, kind) WHERE active;
GRANT SELECT, UPDATE ON public.coach_standing_orders TO authenticated;
GRANT ALL ON public.coach_standing_orders TO service_role;
ALTER TABLE public.coach_standing_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read their standing orders" ON public.coach_standing_orders FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Members can stop their standing orders" ON public.coach_standing_orders FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ===== drizzle/migrations/0034_goal_missions.sql =====
CREATE TABLE public.goal_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  goal_id uuid,
  title text NOT NULL,
  state text NOT NULL DEFAULT 'CAPTURED' CHECK (state IN ('CAPTURED','UNDERSTANDING','RESEARCHING','MODELLING','FEASIBILITY_CHECK','PATHWAY_READY','PLANNING','SCHEDULED','EXECUTING','BLOCKED','ADAPTING','VERIFYING','ACHIEVED')),
  tier text NOT NULL DEFAULT 'simple' CHECK (tier IN ('simple','moderate','complex')),
  experts text[] NOT NULL DEFAULT '{}',
  contract jsonb NOT NULL DEFAULT '{}'::jsonb,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  council jsonb NOT NULL DEFAULT '{}'::jsonb,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_signal jsonb,
  last_signal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX goal_missions_one_per_goal ON public.goal_missions (user_id, goal_id) WHERE goal_id IS NOT NULL;
CREATE INDEX goal_missions_user ON public.goal_missions (user_id, updated_at DESC);
GRANT SELECT ON public.goal_missions TO authenticated;
GRANT ALL ON public.goal_missions TO service_role;
ALTER TABLE public.goal_missions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read their missions" ON public.goal_missions FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ===== drizzle/migrations/0035_allow_erasure_plan_versions.sql =====
CREATE OR REPLACE FUNCTION public.validate_plan_version_change() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_user NOT IN ('authenticated', 'anon') THEN
      RETURN OLD; -- account erasure by privileged roles only
    END IF;
    RAISE EXCEPTION 'Plan versions cannot be deleted';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.week_start IS DISTINCT FROM OLD.week_start
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.trigger IS DISTINCT FROM OLD.trigger
    OR NEW.feasibility IS DISTINCT FROM OLD.feasibility
    OR NEW.explanation IS DISTINCT FROM OLD.explanation
    OR NEW.diff_summary IS DISTINCT FROM OLD.diff_summary
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Plan version content is immutable';
  END IF;
  IF NOT (
    (OLD.status = 'proposed' AND NEW.status IN ('approved','rejected','superseded','deleted'))
    OR (OLD.status = 'approved' AND NEW.status IN ('superseded','deleted'))
    OR (OLD.status = 'superseded' AND NEW.status = 'deleted')
    OR (OLD.status = NEW.status AND OLD.approved_at IS NOT DISTINCT FROM NEW.approved_at)
  ) THEN
    RAISE EXCEPTION 'Invalid plan version transition';
  END IF;
  IF NEW.status = 'approved' AND NEW.approved_at IS NULL THEN
    RAISE EXCEPTION 'Approved plan versions require an approval time';
  END IF;
  RETURN NEW;
END; $$;

-- ===== drizzle/migrations/0036_harden_reserve_ai_budget.sql =====
CREATE OR REPLACE FUNCTION public.reserve_ai_budget(_user_id uuid, _day date, _in int, _out int, _max_in int, _max_out int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE cur_in int; cur_out int;
BEGIN
  IF _user_id IS NULL OR _in IS NULL OR _out IS NULL OR _in < 0 OR _out < 0 OR _max_in < 0 OR _max_out < 0 THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.ai_usage (user_id, day) VALUES (_user_id, _day)
  ON CONFLICT (user_id, day) DO NOTHING;
  SELECT input_tokens, output_tokens INTO cur_in, cur_out FROM public.ai_usage WHERE user_id = _user_id AND day = _day FOR UPDATE;
  IF cur_in + _in > _max_in OR cur_out + _out > _max_out THEN
    RETURN FALSE;
  END IF;
  UPDATE public.ai_usage SET input_tokens = input_tokens + _in, output_tokens = output_tokens + _out WHERE user_id = _user_id AND day = _day;
  RETURN TRUE;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserve_ai_budget(uuid, date, int, int, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_budget(uuid, date, int, int, int, int) TO service_role;

-- ===== drizzle/migrations/0037_reserve_ai_budget_allow_server_settle.sql =====
CREATE OR REPLACE FUNCTION public.reserve_ai_budget(_user_id uuid, _day date, _in int, _out int, _max_in int, _max_out int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE cur_in int; cur_out int;
BEGIN
  -- Only the server (service role) may call this; negative deltas settle over-estimates but never drop below zero.
  IF _user_id IS NULL OR _in IS NULL OR _out IS NULL THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.ai_usage (user_id, day) VALUES (_user_id, _day)
  ON CONFLICT (user_id, day) DO NOTHING;
  SELECT input_tokens, output_tokens INTO cur_in, cur_out FROM public.ai_usage WHERE user_id = _user_id AND day = _day FOR UPDATE;
  IF cur_in + _in > _max_in OR cur_out + _out > _max_out THEN
    RETURN FALSE;
  END IF;
  UPDATE public.ai_usage SET input_tokens = GREATEST(0, input_tokens + _in), output_tokens = GREATEST(0, output_tokens + _out) WHERE user_id = _user_id AND day = _day;
  RETURN TRUE;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserve_ai_budget(uuid, date, int, int, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_budget(uuid, date, int, int, int, int) TO service_role;

-- ===== drizzle/migrations/0038_mission_metrics.sql =====
ALTER TABLE public.goal_missions ADD COLUMN IF NOT EXISTS metrics jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.goal_missions.metrics IS 'Execution evidence rolled up from queue task outcomes: totals per metric label, per-task ledger (idempotent) and which entries reached the linked goal.';

-- ===== drizzle/migrations/0039_web_push_and_prompt_prefs.sql =====
ALTER TABLE public.push_devices DROP CONSTRAINT IF EXISTS push_devices_platform_check;
ALTER TABLE public.push_devices ADD CONSTRAINT push_devices_platform_check CHECK (platform = ANY (ARRAY['expo','apns','fcm','web']));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_muted_kinds text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_motivating boolean NOT NULL DEFAULT true;

-- ===== drizzle/migrations/0040_atomic_usage_reservations.sql =====
CREATE TABLE public.usage_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 period_start date NOT NULL, kind text NOT NULL, ref text NOT NULL UNIQUE,
 included_micro bigint NOT NULL DEFAULT 0, credit_micro bigint NOT NULL DEFAULT 0,
 included_seconds integer NOT NULL DEFAULT 0, topup_seconds integer NOT NULL DEFAULT 0,
 actual_topup_seconds integer NOT NULL DEFAULT 0, actual_seconds integer NOT NULL DEFAULT 0,
 campaign_id uuid, settled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT (now()+interval '15 minutes')
);
GRANT SELECT ON public.usage_reservations TO authenticated;
GRANT ALL ON public.usage_reservations TO service_role;
ALTER TABLE public.usage_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_usage_reservations ON public.usage_reservations FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE INDEX usage_reservations_active ON public.usage_reservations(user_id,period_start) WHERE NOT settled;
CREATE OR REPLACE FUNCTION public.reserve_paid_ai(_user uuid,_period date,_cost bigint,_ref text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE lim bigint; used bigint; held bigint; bal bigint; inc bigint; cred bigint; rid uuid; t text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(_user::text));
 SELECT id INTO rid FROM usage_reservations WHERE ref=_ref AND user_id=_user; IF FOUND THEN RETURN rid; END IF;
 SELECT tier INTO t FROM profiles WHERE id=_user; IF NOT FOUND THEN RETURN NULL; END IF;
 IF has_role(_user,'admin') THEN lim:=9223372036854775807; ELSE lim:=CASE t WHEN 'pro' THEN 8000000 WHEN 'execute' THEN 26000000 ELSE 0 END; END IF;
 SELECT coalesce(sum(provider_cost_micro),0) INTO used FROM spend_ledger WHERE user_id=_user AND period_start=_period AND funded_by='included';
 SELECT coalesce(sum(included_micro),0) INTO held FROM usage_reservations WHERE user_id=_user AND period_start=_period AND NOT settled AND expires_at>now();
 SELECT coalesce(sum(amount_micro),0) INTO bal FROM ai_credit_ledger WHERE user_id=_user;
 SELECT bal-coalesce(sum(credit_micro),0) INTO bal FROM usage_reservations WHERE user_id=_user AND NOT settled AND expires_at>now();
 inc:=least(greatest(0,lim-used-held),greatest(0,_cost)); cred:=greatest(0,_cost-inc);
 IF cred>greatest(0,bal) THEN RETURN NULL; END IF;
 INSERT INTO usage_reservations(user_id,period_start,kind,ref,included_micro,credit_micro) VALUES(_user,_period,'ai',_ref,inc,cred) RETURNING id INTO rid; RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.reserve_paid_ai(uuid,date,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_paid_ai(uuid,date,bigint,text) TO service_role;
CREATE OR REPLACE FUNCTION public.settle_paid_ai(_id uuid,_cost bigint,_feature text,_retail bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r usage_reservations; inc bigint; cred bigint;
BEGIN
 SELECT * INTO r FROM usage_reservations WHERE id=_id; IF NOT FOUND THEN RAISE EXCEPTION 'Reservation missing'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(r.user_id::text));
 SELECT * INTO r FROM usage_reservations WHERE id=_id FOR UPDATE; IF r.settled THEN RETURN; END IF;
 inc:=least(greatest(0,_cost),r.included_micro); cred:=least(greatest(0,_cost-inc),r.credit_micro);
 IF inc>0 THEN INSERT INTO spend_ledger(user_id,period_start,kind,feature,provider_cost_micro,retail_micro,funded_by,ref) VALUES(r.user_id,r.period_start,'ai',_feature,inc,_retail,'included',r.ref||':included'); END IF;
 IF cred>0 THEN
 INSERT INTO spend_ledger(user_id,period_start,kind,feature,provider_cost_micro,retail_micro,funded_by,ref) VALUES(r.user_id,r.period_start,'ai',_feature,cred,0,'credit',r.ref||':credit');
 INSERT INTO ai_credit_ledger(user_id,amount_micro,reason,external_ref) VALUES(r.user_id,-cred,'spend',r.ref);
 END IF;
 IF _cost>inc+cred THEN INSERT INTO spend_ledger(user_id,period_start,kind,feature,provider_cost_micro,retail_micro,funded_by,ref) VALUES(r.user_id,r.period_start,'ai',_feature,_cost-inc-cred,0,'over',r.ref||':over'); END IF;
 UPDATE usage_reservations SET settled=true WHERE id=_id;
END $$;
REVOKE ALL ON FUNCTION public.settle_paid_ai(uuid,bigint,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_paid_ai(uuid,bigint,text,bigint) TO service_role;
CREATE OR REPLACE FUNCTION public.reserve_call_usage(_user uuid,_period date,_start timestamptz,_end timestamptz,_ref text,_campaign uuid,_seconds integer,_micro_per_second bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t text; lim bigint; used bigint; held bigint; money_left bigint; count_used integer; seconds_used integer; seconds_held integer; topup integer; topup_used integer; topup_held integer; inc integer; extra integer; need integer; rid uuid; c call_campaigns;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(_user::text));
 IF EXISTS(SELECT 1 FROM usage_reservations WHERE ref=_ref) THEN RETURN NULL; END IF;
 SELECT * INTO c FROM call_campaigns WHERE id=_campaign AND user_id=_user FOR UPDATE;
 IF NOT FOUND OR c.state NOT IN ('CALL_QUEUED','RETRY_SCHEDULED','CALL_CREATED') THEN RETURN NULL; END IF;
 IF c.state='CALL_CREATED' AND EXISTS(SELECT 1 FROM usage_reservations WHERE campaign_id=_campaign AND NOT settled AND expires_at>now()) THEN RETURN NULL; END IF;
 SELECT tier INTO t FROM profiles WHERE id=_user; IF t NOT IN ('pro','execute') THEN RETURN NULL; END IF;
 lim:=CASE t WHEN 'pro' THEN 8000000 ELSE 26000000 END;
 SELECT coalesce(sum(provider_cost_micro),0) INTO used FROM spend_ledger WHERE user_id=_user AND period_start=_period AND funded_by='included';
 SELECT coalesce(sum(included_micro),0) INTO held FROM usage_reservations WHERE user_id=_user AND period_start=_period AND NOT settled AND expires_at>now();
 money_left:=greatest(0,lim-used-held);
 SELECT count(*) FILTER(WHERE consumed_at IS NOT NULL),coalesce(sum(connected_seconds),0) INTO count_used,seconds_used FROM call_campaigns WHERE user_id=_user AND service_month_start>=_start AND service_month_start<_end;
 SELECT count_used+count(*) FILTER(WHERE included_seconds>0 AND campaign_id<>_campaign),coalesce(sum(included_seconds),0),coalesce(sum(topup_seconds),0) INTO count_used,seconds_held,topup_held FROM usage_reservations WHERE user_id=_user AND kind='call' AND NOT settled AND expires_at>now() AND period_start=_period;
 SELECT coalesce(sum(actual_topup_seconds),0) INTO topup_used FROM usage_reservations WHERE user_id=_user AND kind='call' AND settled AND period_start=_period;
 SELECT coalesce(sum(amount),0) INTO topup FROM entitlement_ledger WHERE user_id=_user AND capability='execute.voice_topup_seconds' AND created_at>=_start AND created_at<_end;
 inc:=greatest(0,(CASE t WHEN 'pro' THEN 1200 ELSE 7200 END)-greatest(0,seconds_used-topup_used)-seconds_held);
 IF t='pro' AND count_used>=20 AND c.consumed_at IS NULL THEN inc:=0; END IF;
 inc:=least(inc,least(2147483647,money_left/greatest(1,_micro_per_second))::integer,greatest(0,_seconds));
 extra:=least(greatest(0,topup-topup_used-topup_held),greatest(0,_seconds-inc));
 need:=inc+extra; IF need<=0 THEN RETURN NULL; END IF;
 INSERT INTO usage_reservations(user_id,period_start,kind,ref,included_micro,included_seconds,topup_seconds,campaign_id) VALUES(_user,_period,'call',_ref,inc*_micro_per_second,inc,extra,_campaign) RETURNING id INTO rid;
 UPDATE call_campaigns SET state='CALL_CREATED',next_attempt_at=NULL WHERE id=_campaign;
 RETURN jsonb_build_object('id',rid,'seconds',need);
END $$;
REVOKE ALL ON FUNCTION public.reserve_call_usage(uuid,date,timestamptz,timestamptz,text,uuid,integer,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_call_usage(uuid,date,timestamptz,timestamptz,text,uuid,integer,bigint) TO service_role;
CREATE OR REPLACE FUNCTION public.settle_call_usage(_ref text,_seconds integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r usage_reservations; secs integer;
BEGIN
 SELECT * INTO r FROM usage_reservations WHERE ref=_ref; IF NOT FOUND THEN RETURN; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(r.user_id::text));
 SELECT * INTO r FROM usage_reservations WHERE ref=_ref FOR UPDATE; IF r.settled THEN RETURN; END IF;
 secs:=greatest(0,_seconds);
 UPDATE usage_reservations SET settled=true,actual_seconds=secs,actual_topup_seconds=greatest(0,secs-r.included_seconds) WHERE id=r.id;
 UPDATE call_campaigns SET connected_seconds=connected_seconds+secs WHERE id=r.campaign_id;
END $$;
REVOKE ALL ON FUNCTION public.settle_call_usage(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_call_usage(text,integer) TO service_role;

-- ===== drizzle/migrations/0041_reserved_call_cost_settlement.sql =====
CREATE OR REPLACE FUNCTION public.charge_reserved_call(_user uuid,_ref text,_cost bigint,_feature text,_part text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r usage_reservations; used bigint; inc bigint; rest bigint; existing text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(_user::text));
 SELECT funded_by INTO existing FROM spend_ledger WHERE ref=_ref; IF FOUND THEN RETURN existing; END IF;
 SELECT * INTO r FROM usage_reservations WHERE user_id=_user AND ref='call:'||split_part(_ref,':',2);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT coalesce(sum(provider_cost_micro),0) INTO used FROM spend_ledger WHERE user_id=_user AND ref IN ('carriage:'||split_part(_ref,':',2),'voice:'||split_part(_ref,':',2));
 inc:=least(greatest(0,r.included_micro-used),greatest(0,_cost)); rest:=greatest(0,_cost-inc);
 IF inc>0 THEN INSERT INTO spend_ledger(user_id,period_start,kind,feature,provider_cost_micro,retail_micro,funded_by,ref) VALUES(_user,r.period_start,'call',_feature,inc,0,'included',_ref); END IF;
 IF rest>0 THEN INSERT INTO spend_ledger(user_id,period_start,kind,feature,provider_cost_micro,retail_micro,funded_by,ref) VALUES(_user,r.period_start,'call',_feature,rest,0,'over',CASE WHEN inc>0 THEN _ref||':extra' ELSE _ref END); END IF;
 RETURN CASE WHEN inc>0 THEN 'included' ELSE 'over' END;
END $$;
REVOKE ALL ON FUNCTION public.charge_reserved_call(uuid,text,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.charge_reserved_call(uuid,text,bigint,text,text) TO service_role;

-- ===== drizzle/migrations/0042_pro_calls_shared_allowance_only.sql =====
CREATE OR REPLACE FUNCTION public.reserve_call_usage(_user uuid,_period date,_start timestamptz,_end timestamptz,_ref text,_campaign uuid,_seconds integer,_micro_per_second bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t text; lim bigint; used bigint; held bigint; money_left bigint; seconds_used integer; seconds_held integer; topup integer; topup_used integer; topup_held integer; inc integer; extra integer; need integer; rid uuid; c call_campaigns;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(_user::text));
 IF EXISTS(SELECT 1 FROM usage_reservations WHERE ref=_ref) THEN RETURN NULL; END IF;
 SELECT * INTO c FROM call_campaigns WHERE id=_campaign AND user_id=_user FOR UPDATE;
 IF NOT FOUND OR c.state NOT IN ('CALL_QUEUED','RETRY_SCHEDULED','CALL_CREATED') THEN RETURN NULL; END IF;
 IF c.state='CALL_CREATED' AND EXISTS(SELECT 1 FROM usage_reservations WHERE campaign_id=_campaign AND NOT settled AND expires_at>now()) THEN RETURN NULL; END IF;
 SELECT tier INTO t FROM profiles WHERE id=_user; IF t NOT IN ('pro','execute') THEN RETURN NULL; END IF;
 lim:=CASE t WHEN 'pro' THEN 8000000 ELSE 26000000 END;
 SELECT coalesce(sum(provider_cost_micro),0) INTO used FROM spend_ledger WHERE user_id=_user AND period_start=_period AND funded_by='included';
 SELECT coalesce(sum(included_micro),0) INTO held FROM usage_reservations WHERE user_id=_user AND period_start=_period AND NOT settled AND expires_at>now();
 money_left:=greatest(0,lim-used-held);
 SELECT coalesce(sum(connected_seconds),0) INTO seconds_used FROM call_campaigns WHERE user_id=_user AND service_month_start>=_start AND service_month_start<_end;
 SELECT coalesce(sum(included_seconds),0),coalesce(sum(topup_seconds),0) INTO seconds_held,topup_held FROM usage_reservations WHERE user_id=_user AND kind='call' AND NOT settled AND expires_at>now() AND period_start=_period;
 SELECT coalesce(sum(actual_topup_seconds),0) INTO topup_used FROM usage_reservations WHERE user_id=_user AND kind='call' AND settled AND period_start=_period;
 SELECT coalesce(sum(amount),0) INTO topup FROM entitlement_ledger WHERE user_id=_user AND capability='execute.voice_topup_seconds' AND created_at>=_start AND created_at<_end;
 inc:=CASE WHEN t='pro' THEN greatest(0,_seconds) ELSE greatest(0,7200-greatest(0,seconds_used-topup_used)-seconds_held) END;
 inc:=least(inc,least(2147483647,money_left/greatest(1,_micro_per_second))::integer,greatest(0,_seconds));
 extra:=least(greatest(0,topup-topup_used-topup_held),greatest(0,_seconds-inc));
 need:=inc+extra; IF need<=0 THEN RETURN NULL; END IF;
 INSERT INTO usage_reservations(user_id,period_start,kind,ref,included_micro,included_seconds,topup_seconds,campaign_id) VALUES(_user,_period,'call',_ref,inc*_micro_per_second,inc,extra,_campaign) RETURNING id INTO rid;
 UPDATE call_campaigns SET state='CALL_CREATED',next_attempt_at=NULL WHERE id=_campaign;
 RETURN jsonb_build_object('id',rid,'seconds',need);
END $$;
REVOKE ALL ON FUNCTION public.reserve_call_usage(uuid,date,timestamptz,timestamptz,text,uuid,integer,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_call_usage(uuid,date,timestamptz,timestamptz,text,uuid,integer,bigint) TO service_role;

commit;
