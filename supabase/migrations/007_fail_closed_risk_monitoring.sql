create table if not exists public.risk_monitor_state (
  id boolean primary key default true check (id = true),
  as_of_date date not null,
  daily_loss numeric not null default 0 check (daily_loss >= 0),
  gross_exposure numeric not null default 0 check (gross_exposure >= 0),
  heartbeat_at timestamptz not null,
  source text not null,
  updated_at timestamptz not null default now(),
  constraint risk_monitor_state_source_chk check (length(trim(source)) > 0)
);

alter table public.risk_monitor_state enable row level security;
revoke all on public.risk_monitor_state from anon, authenticated;

do $$
begin
  if not exists (select 1 from public.risk_monitor_state) then
    insert into public.risk_monitor_state (id, as_of_date, daily_loss, gross_exposure, heartbeat_at, source)
    values (true, current_date, 0, 0, now(), 'bootstrap-locked');
  end if;
end $$;

comment on table public.risk_monitor_state is 'Trusted fail-closed runtime risk telemetry. Missing/stale telemetry blocks real execution.';
comment on column public.risk_monitor_state.daily_loss is 'Absolute loss accrued for as_of_date; unknown/stale values must block execution.';
comment on column public.risk_monitor_state.gross_exposure is 'Current gross exposure across live execution scope; unknown/stale values must block execution.';
comment on column public.risk_monitor_state.heartbeat_at is 'Freshness heartbeat for trusted risk telemetry.';
comment on column public.risk_monitor_state.source is 'Trusted producer identifier; must never be client supplied.';
