create extension if not exists pg_net;
create table if not exists public.internal_cron_tokens (name text primary key, token text not null, created_at timestamptz not null default now());
grant all on public.internal_cron_tokens to service_role;
revoke all on public.internal_cron_tokens from anon, authenticated;
alter table public.internal_cron_tokens enable row level security;
insert into public.internal_cron_tokens(name, token) values ('scheduler', encode(extensions.gen_random_bytes(32),'hex')) on conflict (name) do nothing;
create or replace function public.verify_cron_token(p_token text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.internal_cron_tokens where name = 'scheduler' and token = p_token and length(coalesce(p_token,'')) >= 32)
$$;
revoke all on function public.verify_cron_token(text) from public, anon, authenticated;
grant execute on function public.verify_cron_token(text) to service_role;