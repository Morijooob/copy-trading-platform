-- Server-only access to encrypted Exir credentials.
create or replace function public.get_exchange_account_secrets(p_account_id uuid)
returns table (api_key text, api_secret text)
language sql
security definer
set search_path = public, vault
as $$
  select k.decrypted_secret, s.decrypted_secret
  from public.exchange_accounts a
  join vault.decrypted_secrets k on k.id = a.api_key_secret_id
  join vault.decrypted_secrets s on s.id = a.api_secret_secret_id
  where a.id = p_account_id
    and a.exchange = 'exir'
    and a.withdraw_permission = false
  limit 1;
$$;
revoke all on function public.get_exchange_account_secrets(uuid) from public, anon, authenticated;
grant execute on function public.get_exchange_account_secrets(uuid) to service_role;

create or replace function public.store_exchange_account_secrets(p_user_id uuid, p_api_key text, p_api_secret text, p_trade_permission boolean, p_withdraw_permission boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  account_id uuid;
  key_id uuid;
  secret_id uuid;
begin
  if p_withdraw_permission then raise exception 'withdrawal_permission_forbidden'; end if;
  if p_api_key is null or length(trim(p_api_key)) < 8 then raise exception 'invalid_api_key'; end if;
  if p_api_secret is null or length(trim(p_api_secret)) < 8 then raise exception 'invalid_api_secret'; end if;
  key_id := vault.create_secret(p_api_key, 'exir_api_key_' || p_user_id::text, 'Encrypted Exir API key');
  secret_id := vault.create_secret(p_api_secret, 'exir_api_secret_' || p_user_id::text, 'Encrypted Exir API secret');
  insert into public.exchange_accounts(user_id, exchange, api_key_secret_id, api_secret_secret_id, state, read_permission, trade_permission, withdraw_permission)
  values (p_user_id, 'exir', key_id, secret_id, 'pending', false, coalesce(p_trade_permission,false), false)
  on conflict (user_id, exchange) do update set
    api_key_secret_id = excluded.api_key_secret_id,
    api_secret_secret_id = excluded.api_secret_secret_id,
    state = 'pending', read_permission = false, trade_permission = excluded.trade_permission,
    withdraw_permission = false, updated_at = now()
  returning id into account_id;
  return account_id;
end;
$$;
revoke all on function public.store_exchange_account_secrets(uuid,text,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.store_exchange_account_secrets(uuid,text,text,boolean,boolean) to service_role;
