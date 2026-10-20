ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS processing_restricted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS processing_restricted_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active' CHECK (account_status IN ('active','deletion_pending'));

CREATE TABLE public.data_rights_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('access','rectification','erasure','restriction','objection','portability','consent_withdrawal','complaint')),
  details text,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','in_progress','paused','completed','rejected','withdrawn')),
  identity_check text NOT NULL DEFAULT 'signed_in_session',
  received_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL DEFAULT (now() + interval '28 days'),
  paused_reason text,
  search_scope text[],
  response text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.data_rights_requests TO authenticated;
GRANT ALL ON public.data_rights_requests TO service_role;
ALTER TABLE public.data_rights_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rights requests" ON public.data_rights_requests FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX ON public.data_rights_requests (user_id, received_at DESC);

-- Deletion jobs outlive the account (no FK) so completion stays auditable without personal content.
CREATE TABLE public.deletion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_ref text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','revoking','purging','completed','failed')),
  steps jsonb NOT NULL DEFAULT '[]',
  requested_at timestamptz NOT NULL DEFAULT now(),
  purge_by timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  completed_at timestamptz,
  error text
);
GRANT ALL ON public.deletion_jobs TO service_role;
ALTER TABLE public.deletion_jobs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.retention_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  removed jsonb NOT NULL DEFAULT '{}'
);
GRANT ALL ON public.retention_runs TO service_role;
ALTER TABLE public.retention_runs ENABLE ROW LEVEL SECURITY;

-- V3 §79 locked retention schedule.
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
  DELETE FROM retention_runs WHERE ran_at < now() - interval '24 months';
  INSERT INTO retention_runs (removed) VALUES (r);
  RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION public.apply_retention() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_retention() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('plexecute-retention-daily', '17 3 * * *', $$SELECT public.apply_retention()$$);