ALTER TABLE public.plan_blocks ALTER COLUMN original_starts_at SET DEFAULT now();
CREATE OR REPLACE FUNCTION public.guard_plan_block_integrity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.original_starts_at := NEW.starts_at;
    IF current_user = 'authenticated' AND (NEW.status NOT IN ('planned','scheduled') OR NEW.completed_at IS NOT NULL) THEN
      RAISE EXCEPTION 'PLAN_BLOCK_CLIENT_FORBIDDEN';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_user = 'authenticated' THEN RAISE EXCEPTION 'PLAN_BLOCK_CLIENT_FORBIDDEN'; END IF;
    RETURN OLD;
  END IF;
  NEW.original_starts_at := OLD.original_starts_at;
  IF current_user = 'authenticated' AND (
    NEW.status IS DISTINCT FROM OLD.status OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
    OR NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
    OR NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.plan_version_id IS DISTINCT FROM OLD.plan_version_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.duration_min IS DISTINCT FROM OLD.duration_min) THEN
    RAISE EXCEPTION 'PLAN_BLOCK_CLIENT_FORBIDDEN';
  END IF;
  RETURN NEW;
END $$;