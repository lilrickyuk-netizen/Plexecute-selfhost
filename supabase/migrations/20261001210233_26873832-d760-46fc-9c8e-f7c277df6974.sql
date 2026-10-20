ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS quiet_start time without time zone NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS quiet_end time without time zone NOT NULL DEFAULT '07:00';

CREATE OR REPLACE FUNCTION public.validate_profile_timezone()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Unknown time zone %', NEW.timezone USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_timezone_valid ON public.profiles;
CREATE TRIGGER profiles_timezone_valid BEFORE INSERT OR UPDATE OF timezone ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_profile_timezone();