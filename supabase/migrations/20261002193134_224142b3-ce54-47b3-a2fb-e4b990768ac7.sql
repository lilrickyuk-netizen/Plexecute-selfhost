CREATE OR REPLACE FUNCTION public.guard_notification_member_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user = 'authenticated' AND (to_jsonb(NEW) - 'read_at' - 'interaction' - 'interaction_at') IS DISTINCT FROM (to_jsonb(OLD) - 'read_at' - 'interaction' - 'interaction_at') THEN
    RAISE EXCEPTION 'Only read and response details of a notification can be changed' USING ERRCODE = '42501';
  END IF;
  IF current_user = 'authenticated' AND NEW.interaction IS NOT NULL AND NEW.interaction NOT IN ('opened','dismissed','snoozed','acted') THEN
    RAISE EXCEPTION 'Unknown response' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notifications_member_update BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.guard_notification_member_update();