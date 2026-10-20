CREATE OR REPLACE FUNCTION public.usage_summary(_month date)
RETURNS TABLE(tier text, provider text, feature text, unit text, market text, platform text, quantity numeric, events bigint, failed bigint, members bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tier, provider, feature, unit, market, platform, sum(quantity), count(*), count(*) FILTER (WHERE NOT ok), count(DISTINCT user_id)
  FROM public.usage_events WHERE service_month = _month
  GROUP BY tier, provider, feature, unit, market, platform
  ORDER BY provider, feature, unit
$$;
REVOKE ALL ON FUNCTION public.usage_summary(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.usage_summary(date) TO service_role;