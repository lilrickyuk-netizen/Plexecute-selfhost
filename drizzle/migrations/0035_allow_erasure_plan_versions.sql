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