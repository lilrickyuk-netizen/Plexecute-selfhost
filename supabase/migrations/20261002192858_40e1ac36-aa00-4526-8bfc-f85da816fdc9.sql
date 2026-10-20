CREATE OR REPLACE FUNCTION public.protect_profile_tier()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    NEW.tier := OLD.tier;
    NEW.call_consent_version := OLD.call_consent_version;
    NEW.call_consent_at := OLD.call_consent_at;
    NEW.calls_stopped_at := OLD.calls_stopped_at;
    NEW.processing_restricted := OLD.processing_restricted;
    NEW.processing_restricted_at := OLD.processing_restricted_at;
    NEW.account_status := OLD.account_status;
    NEW.calendar_token := OLD.calendar_token;
    NEW.health_token := OLD.health_token;
    IF OLD.date_of_birth IS NOT NULL THEN
      NEW.date_of_birth := OLD.date_of_birth;
    ELSIF NEW.date_of_birth IS NOT NULL AND NEW.date_of_birth > (current_date - interval '18 years')::date THEN
      RAISE EXCEPTION 'Plexecute is for adults aged 18 and over' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;