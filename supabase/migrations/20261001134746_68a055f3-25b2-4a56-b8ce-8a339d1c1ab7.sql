REVOKE ALL ON public.billing_events FROM anon, authenticated;
GRANT ALL ON public.billing_events TO service_role;
CREATE POLICY "No client access to billing events" ON public.billing_events AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);