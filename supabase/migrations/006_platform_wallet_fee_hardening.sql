-- User Wallet / Platform Wallet separation + fee hardening.
-- Safe to re-run against an already migrated database.

create table if not exists public.platform_wallet_accounts (
  currency text primary key,
  balance numeric(30,8) not null default 0,
  locked_balance numeric(30,8) not null default 0,
  updated_at timestamptz not null default now(),
  check (balance >= 0),
  check (locked_balance >= 0)
);

insert into public.platform_wallet_accounts(currency) values ('USDT') on conflict do nothing;

alter table public.ledger_entries add column if not exists wallet_scope text not null default 'USER';
alter table public.ledger_entries add column if not exists platform_wallet_currency text;

do $$ begin
  alter table public.ledger_entries add constraint ledger_entries_wallet_scope_chk check (wallet_scope in ('USER','PLATFORM'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.ledger_entries add constraint ledger_entries_scope_owner_chk
    check ((wallet_scope='USER' and user_id is not null) or (wallet_scope='PLATFORM' and platform_wallet_currency is not null));
exception when duplicate_object then null; end $$;

create index if not exists ledger_entries_user_scope_idx on public.ledger_entries(user_id,currency,created_at);
create index if not exists ledger_entries_platform_scope_idx on public.ledger_entries(platform_wallet_currency,currency,created_at);

create or replace view public.platform_wallet_summary as
select currency,balance,locked_balance,(balance+locked_balance) total_balance,updated_at from public.platform_wallet_accounts;

create unique index if not exists ledger_entries_trade_scope_type_uidx
on public.ledger_entries(trade_id,wallet_scope,entry_type) where trade_id is not null;

create or replace function public.record_platform_fee(p_user_id uuid,p_amount numeric,p_currency text default 'USDT',p_trade_id uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_amount numeric := round(p_amount,8);
begin
  if v_amount <= 0 then raise exception 'platform fee must be positive'; end if;
  if p_currency <> 'USDT' then raise exception 'unsupported currency'; end if;
  if p_trade_id is null then raise exception 'trade id is required for idempotent platform fee settlement'; end if;
  if exists (select 1 from public.ledger_entries where trade_id=p_trade_id and wallet_scope='PLATFORM' and entry_type='commission') then return; end if;
  update public.wallet_accounts set balance=balance-v_amount,updated_at=now() where user_id=p_user_id and currency=p_currency and balance >= v_amount;
  if not found then raise exception 'insufficient user wallet balance'; end if;
  update public.platform_wallet_accounts set balance=balance+v_amount,updated_at=now() where currency=p_currency;
  if not found then raise exception 'platform wallet currency not configured'; end if;
  insert into public.ledger_entries(user_id,trade_id,entry_type,amount,currency,metadata,wallet_scope,platform_wallet_currency)
  values
    (p_user_id,p_trade_id,'commission',-v_amount,p_currency,jsonb_build_object('kind','platform_fee','destination','PLATFORM_WALLET'),'USER',null),
    (null,p_trade_id,'commission',v_amount,p_currency,jsonb_build_object('kind','platform_fee','source_user_id',p_user_id),'PLATFORM',p_currency);
end; $$;
revoke all on function public.record_platform_fee(uuid,numeric,text,uuid) from public;

create or replace function public.settle_wallet_profit_with_platform_fee(
  p_user_id uuid,p_gross_profit numeric,p_fee_bps integer,p_currency text default 'USDT',p_trade_id uuid default null,p_metadata jsonb default '{}'::jsonb
)
returns public.wallet_accounts language plpgsql security definer set search_path=public as $$
declare
  w public.wallet_accounts;
  v_gross numeric := round(p_gross_profit,8);
  v_fee numeric;
  v_net numeric;
begin
  if v_gross <= 0 then raise exception 'invalid profit amount'; end if;
  if p_fee_bps < 0 or p_fee_bps > 10000 then raise exception 'invalid fee bps'; end if;
  if p_currency <> 'USDT' then raise exception 'unsupported currency'; end if;
  if p_trade_id is null then raise exception 'trade id is required for idempotent settlement'; end if;
  if exists (select 1 from public.ledger_entries where trade_id=p_trade_id and wallet_scope='USER' and entry_type='pnl') then
    select * into w from public.wallet_accounts where user_id=p_user_id; return w;
  end if;
  v_fee := round(v_gross * p_fee_bps / 10000.0,8);
  v_net := v_gross-v_fee;
  insert into public.wallet_accounts(user_id,currency,balance,locked_balance) values(p_user_id,p_currency,v_net,0)
  on conflict(user_id) do update set balance=public.wallet_accounts.balance+excluded.balance,updated_at=now();
  insert into public.ledger_entries(user_id,trade_id,entry_type,amount,currency,metadata,wallet_scope,platform_wallet_currency)
  values(p_user_id,p_trade_id,'pnl',v_net,p_currency,p_metadata || jsonb_build_object('source','copy_trade_profit','gross_profit',v_gross,'platform_fee',v_fee,'fee_bps',p_fee_bps),'USER',null);
  if v_fee > 0 then
    update public.platform_wallet_accounts set balance=balance+v_fee,updated_at=now() where currency=p_currency;
    if not found then raise exception 'platform wallet currency not configured'; end if;
    insert into public.ledger_entries(user_id,trade_id,entry_type,amount,currency,metadata,wallet_scope,platform_wallet_currency)
    values(null,p_trade_id,'commission',v_fee,p_currency,jsonb_build_object('kind','platform_fee','source_user_id',p_user_id,'gross_profit',v_gross,'fee_bps',p_fee_bps),'PLATFORM',p_currency);
  end if;
  select * into w from public.wallet_accounts where user_id=p_user_id; return w;
end; $$;
revoke all on function public.settle_wallet_profit_with_platform_fee(uuid,numeric,integer,text,uuid,jsonb) from public,anon,authenticated;
