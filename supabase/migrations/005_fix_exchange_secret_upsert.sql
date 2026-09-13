-- Fix repeated Exir account connections.
-- Reuse the user's Vault secret records instead of creating duplicate names.
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
  key_name text := 'exir_api_key_' || p_user_id::text;
  secret_name text := 'exir_api_secret_' || p_user_id::text;
begin
  if p_withdraw_permission then raise exception 'withdrawal_permission_forbidden'; end if;
  if p_api_key is null or length(trim(p_api_key)) < 8 then raise exception 'invalid_api_key'; end if;
  if p_api_secret is null or length(trim(p_api_secret)) < 8 then raise exception 'invalid_api_secret'; end if;

  select id into key_id from vault.secrets where name = key_name limit 1;
  if key_id is null then
    key_id := vault.create_secret(p_api_key, key_name, 'Encrypted Exir API key');
  else
    perform vault.update_secret(key_id, p_api_key, key_name, 'Encrypted Exir API key');
  end if;

  select id into secret_id from vault.secrets where name = secret_name limit 1;
  if secret_id is null then
    secret_id := vault.create_secret(p_api_secret, secret_name, 'Encrypted Exir API secret');
  else
    perform vault.update_secret(secret_id, p_api_secret, secret_name, 'Encrypted Exir API secret');
  end if;

  insert into public.exchange_accounts(user_id, exchange, api_key_secret_id, api_secret_secret_id, state, read_permission, trade_permission, withdraw_permission)
  values (p_user_id, 'exir', key_id, secret_id, 'pending', false, coalesce(p_trade_permission,false), false)
  on conflict (user_id, exchange) do update set
    api_key_secret_id = excluded.api_key_secret_id,
    api_secret_secret_id = excluded.api_secret_secret_id,
    state = 'pending',
    read_permission = false,
    trade_permission = excluded.trade_permission,
    withdraw_permission = false,
    updated_at = now()
  returning id into account_id;
  return account_id;
end;
$$;
