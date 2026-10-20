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