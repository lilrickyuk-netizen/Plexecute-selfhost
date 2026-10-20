CREATE OR REPLACE FUNCTION public.prevent_append_only_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND current_user NOT IN ('authenticated', 'anon') THEN
    RETURN OLD; -- account erasure (cascade from profile deletion) by privileged roles only
  END IF;
  RAISE EXCEPTION 'This record is append-only';
END; $function$;