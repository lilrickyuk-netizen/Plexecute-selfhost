CREATE OR REPLACE FUNCTION public.enforce_free_goal_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_tier text;
  active_count int;
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;
  SELECT tier INTO user_tier FROM public.profiles WHERE id = NEW.user_id;
  IF user_tier IS DISTINCT FROM 'free' THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO active_count FROM public.goals
  WHERE user_id = NEW.user_id AND status = 'active' AND id IS DISTINCT FROM NEW.id;
  IF active_count >= 3 THEN
    RAISE EXCEPTION 'Free includes up to 3 active goals. Pause or complete one, or upgrade for unlimited goals.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER goals_free_limit
BEFORE INSERT OR UPDATE OF status ON public.goals
FOR EACH ROW EXECUTE FUNCTION public.enforce_free_goal_limit();