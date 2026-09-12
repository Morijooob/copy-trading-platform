-- Server-only resolver for per-user Exir credentials.
-- Secrets remain in Supabase Vault; callers receive them only through service_role.

create or replace function public.vault_get_exchange_credentials(p_user_id uuid, p_exchange text default 'exir')
returns table (
  account_id uuid,
  api_key text,
  api_secret text,
  state text,
  read_permission boolean,
  trade_permission boolean,
  withdraw_permission boolean
)
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  return query
  select
    ea.id,
    ak.decrypted_secret,
    asct.decrypted_secret,
    ea.state,
    ea.read_permission,
    ea.trade_permission,
    ea.withdraw_permission
  from public.exchange_accounts ea
  left join vault.decrypted_secrets ak on ak.id = ea.api_key_secret_id
  left join vault.decrypted_secrets asct on asct.id = ea.api_secret_secret_id
  where ea.user_id = p_user_id
    and ea.exchange = p_exchange
    and ea.state = 'verified'
  limit 1;
end;
$$;

revoke all on function public.vault_get_exchange_credentials(uuid,text) from public, anon, authenticated;
grant execute on function public.vault_get_exchange_credentials(uuid,text) to service_role;
