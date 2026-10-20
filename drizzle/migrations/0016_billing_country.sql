ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS billing_country text CHECK (billing_country IN ('GB','US'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS billing_country_source text CHECK (billing_country_source IN ('hint','member','checkout'));
UPDATE public.profiles SET billing_country = CASE WHEN timezone LIKE 'America/%' OR timezone LIKE 'US/%' THEN 'US' ELSE 'GB' END, billing_country_source='hint' WHERE billing_country IS NULL;
UPDATE public.profiles SET units='imperial' WHERE billing_country='US' AND units='metric' AND billing_country_source='hint' AND false;
-- Members may not change billing country while a paid subscription is live; only service role (checkout address) can.
CREATE OR REPLACE FUNCTION public.guard_billing_country() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.billing_country IS DISTINCT FROM OLD.billing_country AND auth.role() <> 'service_role' THEN
    IF EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = NEW.id AND s.status IN ('trialing','active','past_due')) THEN
      RAISE EXCEPTION 'Billing country can''t change while a subscription is active. Cancel first, or contact support.';
    END IF;
    NEW.billing_country_source := 'member';
  END IF;
  IF NEW.billing_country_source = 'checkout' AND OLD.billing_country_source IS DISTINCT FROM 'checkout' AND auth.role() <> 'service_role' THEN
    NEW.billing_country_source := OLD.billing_country_source;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_billing_country ON public.profiles;
CREATE TRIGGER guard_billing_country BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_billing_country();