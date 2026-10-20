CREATE OR REPLACE FUNCTION public.guard_twin_fact_provenance()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('service_role','postgres','supabase_admin') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.source <> 'USER_ASSERTED' THEN RAISE EXCEPTION 'Members can only add facts they state themselves' USING ERRCODE = '42501'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.source IS DISTINCT FROM OLD.source OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
     OR NEW.fact_value IS DISTINCT FROM OLD.fact_value OR NEW.confidence IS DISTINCT FROM OLD.confidence
     OR NEW.observed_at IS DISTINCT FROM OLD.observed_at OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.domain IS DISTINCT FROM OLD.domain OR NEW.fact_key IS DISTINCT FROM OLD.fact_key
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id THEN
    RAISE EXCEPTION 'Facts are corrected by adding a new version, not by editing history' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER life_twin_facts_provenance BEFORE INSERT OR UPDATE ON public.life_twin_facts FOR EACH ROW EXECUTE FUNCTION public.guard_twin_fact_provenance();