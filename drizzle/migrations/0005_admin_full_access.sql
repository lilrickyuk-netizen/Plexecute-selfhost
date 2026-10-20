-- Owner decision: admins get full (Execute-level) access to every feature without a subscription.
CREATE OR REPLACE FUNCTION public.grant_admin_full_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    UPDATE public.profiles SET tier = 'execute' WHERE id = NEW.user_id AND tier IS DISTINCT FROM 'execute';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.grant_admin_full_access() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_roles_admin_full_access ON public.user_roles;
CREATE TRIGGER user_roles_admin_full_access AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.grant_admin_full_access();

UPDATE public.profiles p SET tier = 'execute'
WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role = 'admin') AND p.tier IS DISTINCT FROM 'execute';