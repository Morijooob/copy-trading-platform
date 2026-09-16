create table if not exists public.copy_execution_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  master_id uuid not null references public.masters(id) on delete restrict,
  idempotency_key text not null,
  symbol text not null,
  side text not null,
  quantity numeric not null,
  type text not null,
  price numeric,
  estimated_notional numeric not null,
  status text not null default 'reserved',
  exchange_order_id text,
  response_payload jsonb,
  recovery_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint copy_execution_intents_idempotency_unique unique(user_id,idempotency_key),
  constraint copy_execution_intents_status_chk check(status in ('reserved','submitted','filled','rejected','unknown','recovered')),
  constraint copy_execution_intents_side_chk check(side in ('buy','sell')),
  constraint copy_execution_intents_type_chk check(type in ('market','limit')),
  constraint copy_execution_intents_quantity_chk check(quantity > 0),
  constraint copy_execution_intents_notional_chk check(estimated_notional > 0)
);

create index if not exists copy_execution_intents_exchange_order_idx on public.copy_execution_intents(exchange_order_id);
create index if not exists copy_execution_intents_user_created_idx on public.copy_execution_intents(user_id,created_at desc);

alter table public.copy_execution_intents enable row level security;
revoke all on public.copy_execution_intents from anon, authenticated;
drop policy if exists copy_execution_intents_no_client_access on public.copy_execution_intents;
create policy copy_execution_intents_no_client_access on public.copy_execution_intents
  for all to anon, authenticated using (false) with check (false);
