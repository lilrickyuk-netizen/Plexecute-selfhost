create or replace function public.owner_analytics(_from timestamptz, _to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Forbidden'; end if;
  with
  subs as (select s.*, p.acquisition_source src, to_char(date_trunc('month',p.created_at),'YYYY-MM') cohort
           from subscriptions s join profiles p on p.id=s.user_id),
  prof as (select id, tier, acquisition_source src, created_at, to_char(date_trunc('month',created_at),'YYYY-MM') cohort from profiles where account_status is distinct from 'deleted'),
  act as (select user_id, max(occurred_at) last_at from plan_block_events where actor_type='user' group by user_id),
  ret as (
    select p.*, d.days,
      (p.created_at < now() - make_interval(days => d.days)) eligible,
      exists (select 1 from plan_block_events e where e.user_id=p.id and e.actor_type='user' and e.occurred_at >= p.created_at + make_interval(days => d.days)) kept
    from prof p cross join (values (7),(14),(30),(60),(90)) d(days)),
  blocks as (select status from plan_blocks where starts_at between _from and _to and occurrence_kind is distinct from 'commitment'),
  calls as (select * from call_logs where created_at between _from and _to),
  camps as (select c.*, p.tier from call_campaigns c left join profiles p on p.id=c.user_id where c.created_at between _from and _to),
  usage as (select * from usage_events where created_at between _from and _to)
  select jsonb_build_object(
    'revenue', jsonb_build_object(
      'active', (select coalesce(jsonb_object_agg(k, n),'{}') from (select tier||'_'||coalesce(billing_interval,'month') k, count(*) n from subs where status in ('active','past_due') group by 1) x),
      'trialing', (select count(*) from subs where status='trialing'),
      'newSubs', (select count(*) from subs where current_period_start between _from and _to and status in ('active','trialing')),
      'cancelling', (select count(*) from subs where cancel_at_period_end),
      'cancelled', (select count(*) from subs where status='canceled' and updated_at between _from and _to),
      'pastDue', (select count(*) from subs where status in ('past_due','unpaid')),
      'bySource', (select coalesce(jsonb_object_agg(src, n),'{}') from (select src, count(*) n from subs where status in ('active','past_due') group by 1) x),
      'byCohort', (select coalesce(jsonb_object_agg(cohort, n),'{}') from (select cohort, count(*) n from subs where status in ('active','past_due') group by 1) x),
      'topups', (select count(*) from entitlement_ledger where capability='execute.voice_topup_seconds' and amount > 0 and created_at between _from and _to),
      'billingEventTypes', (select coalesce(jsonb_object_agg(type, n),'{}') from (select type, count(*) n from billing_events where received_at between _from and _to group by 1) x),
      'rewardsEarned', (select count(*) from execution_rewards where state in ('EARNED','APPLIED') and coalesce(earned_at,created_at) between _from and _to),
      'rewardsApplied', (select count(*) from execution_rewards where state='APPLIED' and applied_at between _from and _to),
      'rewardPenceApplied', (select coalesce(sum(amount_pence),0) from execution_rewards where state='APPLIED' and applied_at between _from and _to)),
    'retention', jsonb_build_object(
      'overall', (select coalesce(jsonb_object_agg(days, jsonb_build_object('eligible', e, 'kept', k)),'{}') from (select days, count(*) filter (where eligible) e, count(*) filter (where eligible and kept) k from ret group by days) x),
      'byTier', (select coalesce(jsonb_object_agg(tier, v),'{}') from (select tier, jsonb_object_agg(days, jsonb_build_object('eligible', e, 'kept', k)) v from (select tier, days, count(*) filter (where eligible) e, count(*) filter (where eligible and kept) k from ret group by 1,2) y group by tier) x),
      'bySource', (select coalesce(jsonb_object_agg(src, v),'{}') from (select src, jsonb_object_agg(days, jsonb_build_object('eligible', e, 'kept', k)) v from (select src, days, count(*) filter (where eligible) e, count(*) filter (where eligible and kept) k from ret group by 1,2) y group by src) x),
      'byCohort', (select coalesce(jsonb_object_agg(cohort, v),'{}') from (select cohort, jsonb_object_agg(days, jsonb_build_object('eligible', e, 'kept', k)) v from (select cohort, days, count(*) filter (where eligible) e, count(*) filter (where eligible and kept) k from ret group by 1,2) y group by cohort) x),
      'paying', (select count(*) from subs where status in ('active','past_due')),
      'cancelled', (select count(*) from subs where status='canceled'),
      'cancelling', (select count(*) from subs where cancel_at_period_end),
      'inactive30', (select count(*) from prof p left join act a on a.user_id=p.id where p.created_at < now()-interval '30 days' and (a.last_at is null or a.last_at < now()-interval '30 days'))),
    'execution', jsonb_build_object(
      'members', (select count(*) from prof),
      'lifeAudit', (select count(*) from profiles where life_audit is not null and life_audit <> '{}'::jsonb),
      'planAccepted', (select count(distinct user_id) from plan_versions where approved_at is not null),
      'versionsInRange', (select count(*) from plan_versions where created_at between _from and _to),
      'acceptedInRange', (select count(*) from plan_versions where approved_at between _from and _to),
      'recoveryUses', (select count(*) from plan_versions where trigger='recovery' and created_at between _from and _to),
      'blocks', (select coalesce(jsonb_object_agg(status, n),'{}') from (select status, count(*) n from blocks group by 1) x),
      'movedBlocks', (select count(*) from plan_blocks where starts_at between _from and _to and original_starts_at is not null and original_starts_at <> starts_at),
      'movedDone', (select count(*) from plan_blocks where starts_at between _from and _to and original_starts_at is not null and original_starts_at <> starts_at and status='done'),
      'rewards', (select coalesce(jsonb_object_agg(state, n),'{}') from (select state, count(*) n from execution_rewards where period_end between _from and _to group by 1) x),
      'outcomes', (select count(*) from outcome_ledger where created_at between _from and _to),
      'evidence', (select coalesce(jsonb_object_agg(coalesce(evidence_class,'unclassified'), n),'{}') from (select evidence_class, count(*) n from outcome_ledger where created_at between _from and _to group by 1) x)),
    'calls', jsonb_build_object(
      'campaigns', (select count(*) from camps),
      'campaignsByTier', (select coalesce(jsonb_object_agg(coalesce(tier,'unknown'), n),'{}') from (select tier, count(*) n from camps group by 1) x),
      'campaignStates', (select coalesce(jsonb_object_agg(state, n),'{}') from (select state, count(*) n from camps group by 1) x),
      'attempts', (select count(*) from calls),
      'answered', (select count(*) from calls where coalesce(connected_seconds,0) > 0),
      'busy', (select count(*) from calls where provider_status='busy'),
      'noAnswer', (select count(*) from calls where provider_status in ('no-answer','no_answer')),
      'failed', (select count(*) from calls where provider_status in ('failed','canceled')),
      'machine', (select count(*) from calls where answered_by like 'machine%'),
      'acked', (select count(*) from camps where acknowledgement is not null),
      'retries', (select count(*) from calls where attempt_no > 1),
      'connectedSeconds', (select coalesce(sum(connected_seconds),0) from calls),
      'connectedByTier', (select coalesce(jsonb_object_agg(coalesce(tier,'unknown'), s),'{}') from (select tier, sum(connected_seconds) s from camps group by 1) x),
      'stopAll', (select count(*) from profiles where calls_stopped_at between _from and _to),
      'providerErrors', (select count(*) from provider_calls where provider='twilio' and not ok and created_at between _from and _to)),
    'usage', jsonb_build_object(
      'rows', (select coalesce(jsonb_agg(x),'[]') from (select provider, feature, unit, coalesce(tier,'unknown') tier, sum(quantity) quantity, count(*) events, count(*) filter (where not ok) failed, count(distinct user_id) members from usage group by 1,2,3,4 order by 1,2) x),
      'providers', (select coalesce(jsonb_agg(x),'[]') from (select provider, count(*) calls, count(*) filter (where not ok) failed, round(avg(latency_ms)) latency from provider_calls where created_at between _from and _to group by 1 order by 1) x),
      'activeByTier', (select coalesce(jsonb_object_agg(tier, n),'{}') from (select p.tier, count(distinct e.user_id) n from plan_block_events e join profiles p on p.id=e.user_id where e.occurred_at between _from and _to and e.actor_type='user' group by 1) x))
  ) into r;
  return r;
end $$;