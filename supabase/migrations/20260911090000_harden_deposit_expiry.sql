-- Harden USDT/BEP20 deposit expiry at the database boundary.
-- A deposit request is valid for 30 minutes from creation. Expiry must be
-- enforced server-side so a stale client cannot cause a credit after timeout.

create or replace function public.credit_verified_deposit(
  p_deposit_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_currency text,
  p_tx_hash text,
  p_network text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.wallet_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.wallet_accounts;
  claimed boolean;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid deposit amount';
  end if;

  if upper(p_currency) <> 'USDT' or upper(p_network) <> 'BEP20' then
    raise exception 'unsupported deposit asset/network';
  end if;

  if p_tx_hash is null or length(trim(p_tx_hash)) < 20 then
    raise exception 'invalid transaction hash';
  end if;

  -- Expire the request before any credit can happen. This covers both
  -- pending requests and requests that were verified but never credited.
  update public.wallet_deposit_requests
     set status = 'expired',
         reviewed_at = now(),
         verification_metadata = coalesce(verification_metadata, '{}'::jsonb)
           || jsonb_build_object('expired_at', now(), 'reason', '30_minute_expiry')
   where id = p_deposit_id
     and user_id = p_user_id
     and status in ('pending', 'verified')
     and expires_at <= now()
     and credited_at is null;

  if found then
    raise exception 'deposit request expired';
  end if;

  update public.wallet_deposit_requests
     set status = 'credited',
         credited_at = now(),
         verified_at = coalesce(verified_at, now()),
         amount = p_amount,
         currency = 'USDT',
         network = 'BEP20',
         tx_hash = lower(trim(p_tx_hash)),
         verification_metadata = coalesce(verification_metadata, '{}'::jsonb)
           || coalesce(p_metadata, '{}'::jsonb)
   where id = p_deposit_id
     and user_id = p_user_id
     and status = 'verified'
     and verified_at is not null
     and credited_at is null
     and expires_at > now()
   returning true into claimed;

  if coalesce(claimed, false) <> true then
    raise exception 'deposit is not verified, expired, already credited, or not owned by user';
  end if;

  insert into public.wallet_accounts(user_id, currency, balance, locked_balance)
  values(p_user_id, 'USDT', p_amount, 0)
  on conflict(user_id) do update
    set balance = public.wallet_accounts.balance + p_amount,
        updated_at = now();

  insert into public.ledger_entries(
    user_id, trade_id, entry_type, amount, currency,
    wallet_scope, platform_wallet_currency, metadata
  )
  values(
    p_user_id, null, 'adjustment', p_amount, 'USDT', 'USER', null,
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'source', 'verified_bep20_deposit',
        'tx_hash', lower(trim(p_tx_hash)),
        'network', 'BEP20',
        'deposit_id', p_deposit_id
      )
  );

  select * into w
    from public.wallet_accounts
   where user_id = p_user_id and currency = 'USDT';

  return w;
end;
$$;

revoke all on function public.credit_verified_deposit(uuid, uuid, numeric, text, text, text, jsonb)
from public, anon, authenticated;
