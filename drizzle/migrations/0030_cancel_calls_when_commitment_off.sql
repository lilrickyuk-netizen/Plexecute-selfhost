CREATE OR REPLACE FUNCTION public.cancel_calls_for_commitment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.scheduled_calls SET status = 'cancelled', status_reason = 'commitment_removed'
      WHERE commitment_id = OLD.id AND status = 'scheduled';
    RETURN OLD;
  ELSIF NEW.active = false AND OLD.active IS DISTINCT FROM false THEN
    UPDATE public.scheduled_calls SET status = 'cancelled', status_reason = 'commitment_paused'
      WHERE commitment_id = NEW.id AND status = 'scheduled';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS commitments_cancel_calls ON public.commitments;
CREATE TRIGGER commitments_cancel_calls BEFORE DELETE OR UPDATE OF active ON public.commitments
FOR EACH ROW EXECUTE FUNCTION public.cancel_calls_for_commitment();