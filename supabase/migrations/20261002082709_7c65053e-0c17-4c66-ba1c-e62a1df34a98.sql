UPDATE public.plan_blocks SET evidence = CASE evidence WHEN 'workout_log' THEN 'supported' WHEN 'call_confirmed' THEN 'self_reported' WHEN 'self_reported' THEN 'self_reported' WHEN 'verified_external' THEN 'verified_external' WHEN 'supported' THEN 'supported' ELSE 'unknown' END;
ALTER TABLE public.plan_blocks ADD CONSTRAINT plan_blocks_evidence_class CHECK (evidence IN ('verified_external','supported','self_reported','unknown'));
ALTER TABLE public.plan_blocks ADD COLUMN evidence_detail jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.outcome_ledger DROP CONSTRAINT IF EXISTS outcome_ledger_evidence_class_check;
ALTER TABLE public.outcome_ledger ADD CONSTRAINT outcome_ledger_evidence_class_check CHECK (evidence_class IN ('verified_external','supported','self_reported','unknown')) NOT VALID;

CREATE TABLE public.evidence_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  block_id uuid NOT NULL REFERENCES public.plan_blocks(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('health_activity','workout_session','wellness_session','movement_session','call_log')),
  source_ref text NOT NULL CHECK (char_length(source_ref) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_kind, source_ref)
);
GRANT SELECT ON public.evidence_claims TO authenticated;
GRANT ALL ON public.evidence_claims TO service_role;
ALTER TABLE public.evidence_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own evidence claims" ON public.evidence_claims FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.guard_evidence_class() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.evidence IS DISTINCT FROM OLD.evidence
     AND NEW.evidence IN ('verified_external','supported')
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'EVIDENCE_UPGRADE_FORBIDDEN';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_blocks_guard_evidence BEFORE UPDATE ON public.plan_blocks FOR EACH ROW EXECUTE FUNCTION public.guard_evidence_class();