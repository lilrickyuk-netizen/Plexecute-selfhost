CREATE TABLE public.rate_limits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  hits int NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
GRANT ALL ON public.rate_limits TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Fixed-window counter; returns true when the call is allowed. Old windows are pruned by the daily retention run.
CREATE OR REPLACE FUNCTION public.hit_rate_limit(_bucket text, _window_seconds int, _max int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws timestamptz := to_timestamp(floor(extract(epoch FROM now()) / _window_seconds) * _window_seconds); n int;
BEGIN
  INSERT INTO rate_limits (bucket, window_start, hits) VALUES (_bucket, ws, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limits.hits + 1
  RETURNING hits INTO n;
  RETURN n <= _max;
END $$;
REVOKE EXECUTE ON FUNCTION public.hit_rate_limit(text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hit_rate_limit(text, int, int) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_retention()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb := '{}'; n int;
BEGIN
  DELETE FROM coach_messages WHERE created_at < now() - interval '12 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('coach_messages', n);
  DELETE FROM notifications WHERE created_at < now() - interval '12 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('notifications', n);
  DELETE FROM call_logs WHERE created_at < now() - interval '24 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('call_logs', n);
  DELETE FROM call_campaigns WHERE created_at < now() - interval '24 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('call_campaigns', n);
  DELETE FROM health_samples WHERE created_at < now() - interval '24 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('health_samples', n);
  DELETE FROM audit_events WHERE created_at < now() - interval '24 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('audit_events', n);
  DELETE FROM safety_events WHERE created_at < now() - interval '24 months'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('safety_events', n);
  DELETE FROM coach_tool_calls WHERE created_at < now() - interval '90 days'; GET DIAGNOSTICS n = ROW_COUNT; r := r || jsonb_build_object('coach_tool_calls', n);
  DELETE FROM rate_limits WHERE window_start < now() - interval '1 day';
  DELETE FROM retention_runs WHERE ran_at < now() - interval '24 months';
  INSERT INTO retention_runs (removed) VALUES (r);
  RETURN r;
END $$;