create table if not exists public.platform_controls (
  id boolean primary key default true check (id = true),
  kill_switch boolean not null default true,
  kill_switch_reason text not null default 'real trading disabled until production gate passes',
  max_order_notional numeric not null default 1000 check (max_order_notional > 0),
  max_daily_loss numeric not null default 200 check (max_daily_loss > 0),
  max_exposure numeric not null default 1500 check (max_exposure > 0),
  monitoring_heartbeat_max_age_seconds integer not null default 60 check (monitoring_heartbeat_max_age_seconds > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.platform_controls (id) values (true) on conflict (id) do nothing;

alter table public.platform_controls enable row level security;
revoke all on public.platform_controls from anon, authenticated;
revoke all on public.platform_controls from public;

create policy platform_controls_deny_all on public.platform_controls
for all to anon, authenticated using (false) with check (false);

create or replace function public.get_platform_controls()
returns public.platform_controls
language sql
security definer
set search_path = public
as $$ select * from public.platform_controls where id = true; $$;

revoke all on function public.get_platform_controls() from public, anon, authenticated;
grant execute on function public.get_platform_controls() to service_role;

create or replace function public.set_platform_kill_switch(p_enabled boolean, p_reason text, p_actor uuid default null)
returns public.platform_controls
language plpgsql
security definer
set search_path = public
as $$
declare result public.platform_controls;
begin
  update public.platform_controls
     set kill_switch = p_enabled,
         kill_switch_reason = coalesce(nullif(trim(p_reason), ''), case when p_enabled then 'manual emergency stop' else 'manual reset' end),
         updated_at = now(),
         updated_by = p_actor
   where id = true
   returning * into result;
  return result;
end;
$$;

revoke all on function public.set_platform_kill_switch(boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.set_platform_kill_switch(boolean, text, uuid) to service_role;

create index if not exists platform_controls_updated_at_idx on public.platform_controls(updated_at desc);

create or replace function public.touch_exchange_account()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
