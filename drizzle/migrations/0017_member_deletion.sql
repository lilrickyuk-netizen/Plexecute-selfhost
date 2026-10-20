-- Deleting a goal keeps finished-session history (goal link cleared) instead of erasing it.
ALTER TABLE public.plan_blocks DROP CONSTRAINT plan_blocks_goal_id_fkey;
ALTER TABLE public.plan_blocks ADD CONSTRAINT plan_blocks_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.goals(id) ON DELETE SET NULL;

-- A member may delete a week's plan: the version is kept for history with status 'deleted'.
CREATE OR REPLACE FUNCTION public.validate_plan_version_change()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
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
END; $function$;