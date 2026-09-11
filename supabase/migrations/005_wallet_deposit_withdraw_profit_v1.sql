create table if not exists public.wallet_deposit_requests (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null default 'USDT', amount numeric not null check (amount > 0), tx_hash text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), reviewed_at timestamptz
);
create index if not exists idx_wallet_deposit_user_created on public.wallet_deposit_requests(user_id,created_at desc);
create table if not exists public.wallet_withdrawal_requests (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null default 'USDT', amount numeric not null check (amount > 0), destination text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','paid')),
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), reviewed_at timestamptz
);
create index if not exists idx_wallet_withdraw_user_created on public.wallet_withdrawal_requests(user_id,created_at desc);
alter table public.wallet_deposit_requests enable row level security;
alter table public.wallet_withdrawal_requests enable row level security;
create policy wallet_deposit_self_select on public.wallet_deposit_requests for select to authenticated using ((select auth.uid())=user_id);
create policy wallet_deposit_self_insert on public.wallet_deposit_requests for insert to authenticated with check ((select auth.uid())=user_id);
create policy wallet_withdraw_self_select on public.wallet_withdrawal_requests for select to authenticated using ((select auth.uid())=user_id);
create policy wallet_withdraw_self_insert on public.wallet_withdrawal_requests for insert to authenticated with check ((select auth.uid())=user_id);
create or replace function public.ensure_wallet(p_user_id uuid) returns public.wallet_accounts language plpgsql security definer set search_path to 'public' as $$
declare w public.wallet_accounts; begin
 if auth.uid() is null or auth.uid() <> p_user_id then raise exception 'not authorized'; end if;
 insert into public.wallet_accounts(user_id) values (p_user_id) on conflict (user_id) do nothing;
 select * into w from public.wallet_accounts where user_id=p_user_id; return w; end; $$;
revoke execute on function public.ensure_wallet(uuid) from public,anon;
grant execute on function public.ensure_wallet(uuid) to authenticated;
create or replace function public.credit_wallet_profit(p_user_id uuid,p_amount numeric,p_currency text default 'USDT',p_trade_id uuid default null,p_metadata jsonb default '{}'::jsonb)
returns public.wallet_accounts language plpgsql security definer set search_path to 'public' as $$
declare w public.wallet_accounts; begin
 if p_amount is null or p_amount <= 0 then raise exception 'invalid profit amount'; end if;
 if p_currency <> 'USDT' then raise exception 'unsupported currency'; end if;
 insert into public.wallet_accounts(user_id,currency,balance,locked_balance) values(p_user_id,p_currency,p_amount,0)
 on conflict(user_id) do update set balance=public.wallet_accounts.balance+p_amount, updated_at=now();
 insert into public.ledger_entries(user_id,trade_id,entry_type,amount,currency,metadata) values(p_user_id,p_trade_id,'pnl',p_amount,p_currency,p_metadata || jsonb_build_object('source','copy_trade_profit'));
 select * into w from public.wallet_accounts where user_id=p_user_id; return w; end; $$;
revoke execute on function public.credit_wallet_profit(uuid,numeric,text,uuid,jsonb) from public,anon,authenticated;