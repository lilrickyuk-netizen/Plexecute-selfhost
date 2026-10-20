ALTER TABLE public.plan_blocks ADD CONSTRAINT plan_blocks_status_chk CHECK (status IN ('planned','scheduled','upcoming','due','contacting','acknowledged','started','in_progress','done','partial','snoozed','rescheduled','skipped','blocked','expired','cancelled','safety_stopped'));

CREATE OR REPLACE FUNCTION public.validate_plan_block_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE allowed text[];
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  allowed := CASE OLD.status
    WHEN 'planned' THEN ARRAY['scheduled','upcoming','due','contacting','acknowledged','started','in_progress','snoozed','rescheduled','expired','cancelled','done','partial','blocked','skipped','safety_stopped']
    WHEN 'scheduled' THEN ARRAY['upcoming','due','contacting','acknowledged','started','in_progress','snoozed','rescheduled','expired','cancelled','done','partial','blocked','skipped','safety_stopped']
    WHEN 'upcoming' THEN ARRAY['due','contacting','acknowledged','started','in_progress','snoozed','rescheduled','expired','cancelled','done','partial','blocked','skipped','safety_stopped']
    WHEN 'due' THEN ARRAY['contacting','acknowledged','started','in_progress','snoozed','rescheduled','expired','cancelled','done','partial','blocked','skipped','safety_stopped']
    WHEN 'contacting' THEN ARRAY['due','acknowledged','started','in_progress','snoozed','expired','done','partial','blocked','skipped','safety_stopped']
    WHEN 'acknowledged' THEN ARRAY['due','contacting','started','in_progress','snoozed','rescheduled','expired','cancelled','done','partial','blocked','skipped','safety_stopped']
    WHEN 'snoozed' THEN ARRAY['upcoming','due','contacting','acknowledged','started','in_progress','snoozed','rescheduled','expired','cancelled','done','partial','blocked','skipped','safety_stopped']
    WHEN 'started' THEN ARRAY['in_progress','done','partial','blocked','skipped','safety_stopped']
    WHEN 'in_progress' THEN ARRAY['done','partial','blocked','skipped','safety_stopped']
    WHEN 'done' THEN ARRAY['planned','partial']
    WHEN 'partial' THEN ARRAY['planned','done']
    WHEN 'blocked' THEN ARRAY['planned']
    WHEN 'skipped' THEN ARRAY['planned']
    WHEN 'safety_stopped' THEN ARRAY['planned']
    WHEN 'expired' THEN ARRAY['planned','done','partial','skipped']
    ELSE ARRAY[]::text[] END;
  IF NOT (NEW.status = ANY(allowed)) THEN
    RAISE EXCEPTION 'EXECUTION_TRANSITION_INVALID: % -> %', OLD.status, NEW.status USING ERRCODE = 'P0409';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER plan_blocks_validate_transition BEFORE UPDATE OF status ON public.plan_blocks FOR EACH ROW EXECUTE FUNCTION public.validate_plan_block_transition();

ALTER TABLE public.plan_block_events
  ADD COLUMN actor_type text NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user','system','call','device','coach')),
  ADD COLUMN actor_id text,
  ADD COLUMN source_channel text NOT NULL DEFAULT 'app' CHECK (source_channel IN ('app','call','scheduler','workout_log','wellness_log','plan_approval','calendar','api')),
  ADD COLUMN evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX plan_block_events_idem ON public.plan_block_events(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;