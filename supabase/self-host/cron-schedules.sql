-- Plexecute scheduled jobs for a self-hosted Supabase project.
-- Replaces the schedules Lovable Cloud ran for you. Run ONCE in Supabase → SQL Editor
-- after the app is deployed and CRON_SECRET is set on Cloudflare.
--
-- 1. Replace YOUR_CRON_SECRET below with the exact CRON_SECRET value you set on Cloudflare.
-- 2. Replace https://plexecute.io if your app lives elsewhere.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Keep the secret in Supabase Vault, not in the job text.
select vault.create_secret('YOUR_CRON_SECRET', 'plexecute_cron_secret');
select vault.create_secret('https://plexecute.io', 'plexecute_app_url');

create or replace function public.plexecute_cron_call(path text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  secret text;
  base text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'plexecute_cron_secret';
  select decrypted_secret into base from vault.decrypted_secrets where name = 'plexecute_app_url';
  perform net.http_post(
    url := base || path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.plexecute_cron_call(text) from public, anon, authenticated;

-- Every minute: place due accountability calls.
select cron.schedule('plexecute-calls', '* * * * *', $$select public.plexecute_cron_call('/api/public/cron/calls')$$);
-- Every minute: queue and send Coach prompts at their exact time.
select cron.schedule('plexecute-prompts', '* * * * *', $$select public.plexecute_cron_call('/api/public/cron/prompts')$$);
-- Every 5 minutes: reminders, notifications and background jobs (recovery net).
select cron.schedule('plexecute-reminders', '*/5 * * * *', $$select public.plexecute_cron_call('/api/public/cron/reminders')$$);
-- Every 15 minutes: calendar sync (harmless until calendar keys are added).
select cron.schedule('plexecute-calendar', '*/15 * * * *', $$select public.plexecute_cron_call('/api/public/cron/calendar')$$);
-- Wearables are hidden for now. When you switch them on, run:
-- select cron.schedule('plexecute-wearables', '*/30 * * * *', $$select public.plexecute_cron_call('/api/public/cron/wearables')$$);

-- Check they are registered:
-- select jobname, schedule from cron.job order by jobname;
-- See recent runs / HTTP results:
-- select * from cron.job_run_details order by start_time desc limit 20;
-- select id, status_code, left(content, 200) from net._http_response order by created desc limit 20;
