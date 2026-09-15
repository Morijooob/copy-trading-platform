alter table public.wallet_withdrawal_requests
  add column if not exists idempotency_key text;

create unique index if not exists wallet_withdrawal_requests_user_idempotency_key_uq
  on public.wallet_withdrawal_requests(user_id, idempotency_key)
  where idempotency_key is not null;

drop function if exists public.request_wallet_withdrawal(uuid,numeric,text,text);

create or replace function public.request_wallet_withdrawal(
  p_user_id uuid,
  p_amount numeric,
  p_currency text,
  p_destination text,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
begin
  if auth.uid() is null or auth.uid()<>p_user_id then raise exception 'not authorized'; end if;
  if p_currency<>'USDT' then raise exception 'unsupported currency'; end if;
  if p_amount is null or p_amount < 5 then raise exception 'minimum user withdrawal is 5 USDT'; end if;
  if length(trim(p_destination))<10 then raise exception 'destination invalid'; end if;
  if p_idempotency_key is not null and (length(trim(p_idempotency_key))<8 or length(trim(p_idempotency_key))>128) then raise exception 'invalid idempotency key'; end if;
  if p_idempotency_key is not null then
    select id into v_id from public.wallet_withdrawal_requests where user_id=p_user_id and idempotency_key=trim(p_idempotency_key) limit 1;
    if found then return v_id; end if;
  end if;
  perform public.ensure_wallet(p_user_id);
  update public.wallet_accounts set locked_balance=locked_balance+p_amount, balance=balance-p_amount, updated_at=now() where user_id=p_user_id and currency=p_currency and balance>=p_amount;
  if not found then raise exception 'insufficient available balance'; end if;
  insert into public.wallet_withdrawal_requests(user_id,currency,amount,destination,status,idempotency_key,metadata)
  values (p_user_id,p_currency,p_amount,trim(p_destination),'pending',nullif(trim(p_idempotency_key),''),jsonb_build_object('execution_locked',true)) returning id into v_id;
  return v_id;
exception when unique_violation then
  select id into v_id from public.wallet_withdrawal_requests where user_id=p_user_id and idempotency_key=trim(p_idempotency_key) limit 1;
  if v_id is not null then return v_id; end if;
  raise;
end;
$function$;

grant execute on function public.request_wallet_withdrawal(uuid,numeric,text,text,text) to authenticated,service_role;
revoke execute on function public.request_wallet_withdrawal(uuid,numeric,text,text,text) from public;
