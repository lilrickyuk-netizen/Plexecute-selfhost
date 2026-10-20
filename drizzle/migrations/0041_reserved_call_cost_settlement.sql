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