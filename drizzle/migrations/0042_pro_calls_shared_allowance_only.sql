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