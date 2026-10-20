alter table public.profiles add column if not exists acquisition_source text not null default 'Organic'
  check (acquisition_source in ('Waiting List','Founding Tester','Organic','Paid Marketing','Referral','Partnership','Other'));
alter table public.support_requests add column if not exists severity text not null default 'normal' check (severity in ('low','normal','high','critical')),
  add column if not exists assigned_to uuid, add column if not exists resolution text, add column if not exists resolved_at timestamptz;

create table public.owner_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  category text not null check (category in ('bug','confusing_ux','poor_recommendation','accountability','billing','integration','missing_feature','positive','other')),
  severity text not null default 'normal' check (severity in ('low','normal','high','critical')),
  notes text not null check (length(notes) between 1 and 4000),
  source text not null default 'owner',
  status text not null default 'OPEN' check (status in ('OPEN','INVESTIGATING','FIXED','CLOSED')),
  resolution text, linked_ref text, created_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.cancellation_reasons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  reason text not null check (reason in ('too_expensive','not_used_enough','not_helpful','calling_not_useful','too_complicated','missing_feature','technical_problem','privacy_concern','other')),
  details text check (length(details) <= 1000), tier text,
  created_at timestamptz not null default now());
create table public.owner_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, author_id uuid not null,
  note text not null check (length(note) between 1 and 2000),
  created_at timestamptz not null default now());
create table public.owner_cohorts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  rules jsonb not null default '{}', created_by uuid not null,
  created_at timestamptz not null default now());
create index on public.owner_feedback(status, created_at desc);
create index on public.cancellation_reasons(created_at desc);
create index on public.owner_notes(user_id, created_at desc);
create index if not exists profiles_created_idx on public.profiles(created_at);
create index if not exists support_status_idx on public.support_requests(status, created_at desc);

alter table public.owner_feedback enable row level security;
alter table public.cancellation_reasons enable row level security;
alter table public.owner_notes enable row level security;
alter table public.owner_cohorts enable row level security;
create policy "admins manage feedback" on public.owner_feedback for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "own cancellation reason insert" on public.cancellation_reasons for insert to authenticated with check (auth.uid() = user_id);
create policy "own or admin read reasons" on public.cancellation_reasons for select to authenticated using (auth.uid() = user_id or public.has_role(auth.uid(),'admin'));
create policy "admins manage notes" on public.owner_notes for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "admins manage cohorts" on public.owner_cohorts for all to authenticated using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
grant select, insert, update, delete on public.owner_feedback, public.owner_notes, public.owner_cohorts to authenticated;
grant select, insert on public.cancellation_reasons to authenticated;
grant all on public.owner_feedback, public.owner_notes, public.owner_cohorts, public.cancellation_reasons to service_role;

-- Scalable aggregate for the Owner Overview: one round trip, computed in SQL, admin-only.
create or replace function public.owner_overview(_from timestamptz, _to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Forbidden'; end if;
  select jsonb_build_object(
    'total', (select count(*) from profiles where account_status is distinct from 'deleted'),
    'free', (select count(*) from profiles where tier='free'),
    'pro', (select count(*) from profiles where tier='pro'),
    'execute', (select count(*) from profiles where tier='execute'),
    'paying', (select count(*) from subscriptions where status in ('active','past_due') and tier in ('pro','execute')),
    'newToday', (select count(*) from profiles where created_at >= date_trunc('day', now())),
    'new7', (select count(*) from profiles where created_at >= now() - interval '7 days'),
    'new30', (select count(*) from profiles where created_at >= now() - interval '30 days'),
    'newInRange', (select count(*) from profiles where created_at between _from and _to),
    'activeInRange', (select count(distinct user_id) from plan_block_events where occurred_at between _from and _to and actor_type='user'),
    'wau', (select count(distinct user_id) from plan_block_events where occurred_at >= now()-interval '7 days' and actor_type='user'),
    'lifeAudit', (select count(*) from profiles where life_audit is not null and life_audit <> '{}'::jsonb),
    'planAccepted', (select count(distinct user_id) from plan_versions where approved_at is not null),
    'retained30', (select count(*) from profiles p where p.created_at < now()-interval '30 days' and exists (select 1 from plan_block_events e where e.user_id=p.id and e.occurred_at >= p.created_at + interval '30 days')),
    'eligible30', (select count(*) from profiles where created_at < now()-interval '30 days'),
    'retained90', (select count(*) from profiles p where p.created_at < now()-interval '90 days' and exists (select 1 from plan_block_events e where e.user_id=p.id and e.occurred_at >= p.created_at + interval '90 days')),
    'eligible90', (select count(*) from profiles where created_at < now()-interval '90 days'),
    'cancelling', (select count(*) from subscriptions where cancel_at_period_end or status='canceled'),
    'pastDue', (select count(*) from subscriptions where status in ('past_due','unpaid')),
    'billingEvents', (select count(*) from billing_events where received_at between _from and _to),
    'rewardsEarned', (select count(*) from execution_rewards where state in ('EARNED','APPLIED') and coalesce(earned_at,created_at) between _from and _to),
    'rewardsApplied', (select count(*) from execution_rewards where state='APPLIED' and applied_at between _from and _to),
    'blocksPlanned', (select count(*) from plan_blocks where starts_at between _from and _to and status <> 'cancelled'),
    'blocksDone', (select count(*) from plan_blocks where starts_at between _from and _to and status='done'),
    'voiceSeconds', (select coalesce(sum(coalesce(connected_seconds,0)),0) from call_logs where created_at between _from and _to),
    'calls', (select count(*) from call_logs where created_at between _from and _to),
    'callsAnswered', (select count(*) from call_logs where created_at between _from and _to and coalesce(connected_seconds,0) > 0),
    'callsAcked', (select count(*) from call_logs where created_at between _from and _to and outcome in ('confirmed_done','not_yet','done','snooze','reschedule','skip')),
    'supportOpen', (select count(*) from support_requests where status in ('open','OPEN','INVESTIGATING')),
    'feedbackOpen', (select count(*) from owner_feedback where status in ('OPEN','INVESTIGATING')),
    'jobFailures', (select count(*) from background_jobs where status in ('failed','dead') and updated_at between _from and _to),
    'integrationFailures', (select count(*) from provider_calls where ok is false and created_at between _from and _to),
    'incidentsOpen', (select count(*) from incidents where status <> 'resolved')
  ) into r;
  return r;
end $$;
revoke all on function public.owner_overview(timestamptz,timestamptz) from public, anon;
grant execute on function public.owner_overview(timestamptz,timestamptz) to authenticated;