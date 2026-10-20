create table public.owner_member_tags (
  user_id uuid not null, tag text not null check (length(tag) between 1 and 40),
  created_by uuid not null, created_at timestamptz not null default now(),
  primary key (user_id, tag));
grant select, insert, delete on public.owner_member_tags to authenticated;
grant all on public.owner_member_tags to service_role;
alter table public.owner_member_tags enable row level security;
create policy "admins manage member tags" on public.owner_member_tags for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create index on public.owner_member_tags(tag);

create or replace function public.owner_cohort_metrics(_rules jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Forbidden'; end if;
  with base as (
    select p.id, p.created_at, p.life_audit, p.tier from profiles p
    left join subscriptions s on s.user_id = p.id
    where p.account_status is distinct from 'deleted'
      and (_rules->>'signup_from' is null or p.created_at >= (_rules->>'signup_from')::date)
      and (_rules->>'signup_to' is null or p.created_at < (_rules->>'signup_to')::date + 1)
      and (_rules->>'tier' is null or p.tier = _rules->>'tier')
      and (_rules->>'source' is null or p.acquisition_source = _rules->>'source')
      and (_rules->>'sub_state' is null or coalesce(s.status,'none') = _rules->>'sub_state')
      and (_rules->>'tag' is null or exists (select 1 from owner_member_tags t where t.user_id=p.id and t.tag=_rules->>'tag'))
      and (_rules->>'paying_only' is distinct from 'true' or s.status in ('active','past_due','trialing'))
      and (coalesce(_rules->>'active','') = '' or (exists (select 1 from plan_blocks b where b.user_id=p.id and b.status='completed' and b.completed_at > now() - interval '30 days')) = (_rules->>'active')::boolean)
  ), m as (
    select * from base order by created_at
    limit case when _rules->>'first_n' is null then null else (_rules->>'first_n')::int end
  )
  select jsonb_build_object(
    'members', (select count(*) from m),
    'lifeAudit', (select count(*) from m where life_audit is not null),
    'planAccepted', (select count(distinct v.user_id) from plan_versions v join m on m.id=v.user_id where v.approved_at is not null),
    'activeWeek', (select count(distinct b.user_id) from plan_blocks b join m on m.id=b.user_id where b.status='completed' and b.completed_at > now() - interval '7 days'),
    'active30', (select count(distinct b.user_id) from plan_blocks b join m on m.id=b.user_id where b.status='completed' and b.completed_at > now() - interval '30 days'),
    'blocksPlanned', (select count(*) from plan_blocks b join m on m.id=b.user_id where b.starts_at > now() - interval '30 days' and b.starts_at <= now() and b.occurrence_kind is distinct from 'commitment'),
    'blocksDone', (select count(*) from plan_blocks b join m on m.id=b.user_id where b.status='completed' and b.starts_at > now() - interval '30 days' and b.starts_at <= now() and b.occurrence_kind is distinct from 'commitment'),
    'rewardsEarned', (select count(*) from execution_rewards e join m on m.id=e.user_id where e.state in ('EARNED','APPLIED')),
    'paying', (select count(*) from subscriptions s join m on m.id=s.user_id where s.status in ('active','past_due')),
    'renewed', (select count(*) from subscriptions s join m on m.id=s.user_id where s.status='active' and s.current_period_start > m.created_at + interval '25 days'),
    'cancelled', (select count(*) from subscriptions s join m on m.id=s.user_id where s.status='canceled' or s.cancel_at_period_end),
    'byTier', (select coalesce(jsonb_object_agg(tier, n),'{}') from (select tier, count(*) n from m group by tier) x),
    'supportIssues', (select count(*) from support_requests q join m on m.id=q.user_id),
    'callCampaigns', (select count(*) from call_campaigns c join m on m.id=c.user_id),
    'connectedSeconds', (select coalesce(sum(c.connected_seconds),0) from call_campaigns c join m on m.id=c.user_id),
    'aiEvents', (select count(*) from usage_events u join m on m.id=u.user_id where u.feature ilike '%coach%' or u.provider in ('lovable_ai','openai','gemini')),
    'outcomes', (select count(*) from outcome_ledger o join m on m.id=o.user_id)
  ) into r;
  return r;
end $$;
revoke all on function public.owner_cohort_metrics(jsonb) from public, anon;
grant execute on function public.owner_cohort_metrics(jsonb) to authenticated;