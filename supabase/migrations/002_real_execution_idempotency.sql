-- Persistent idempotency ledger for server-side execution.
-- Real trading stays disabled until the full production security gate passes.
create table if not exists public.execution_intents (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  master_trade_id uuid references public.trades(id) on delete set null,
  follower_trade_id uuid references public.follower_trades(id) on delete set null,
  exchange text not null default 'exir',
  status text not null default 'pending' check (status in ('pending','submitted','partial','filled','failed','cancelled')),
  exchange_order_id text,
  request_hash text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_execution_intents_user_created
  on public.execution_intents(user_id, created_at desc);

create index if not exists idx_execution_intents_status_created
  on public.execution_intents(status, created_at);

alter table public.execution_intents enable row level security;

create policy execution_intents_self_select
  on public.execution_intents
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Inserts/updates are backend-only. The Edge Function uses its privileged server context
-- after authenticating the caller and validating the risk/security gate.
revoke all on public.execution_intents from anon, authenticated;
