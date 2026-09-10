-- Secure per-user Exir credential references.
-- Secret values are stored only in Supabase Vault; this table stores Vault UUIDs, never plaintext credentials.
create extension if not exists pgcrypto;

create table if not exists public.exchange_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exchange text not null check (exchange in ('exir')),
  api_key_secret_id uuid,
  api_secret_secret_id uuid,
  state text not null default 'pending' check (state in ('pending','verified','disabled')),
  read_permission boolean not null default false,
  trade_permission boolean not null default false,
  withdraw_permission boolean not null default false,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, exchange)
);

alter table public.exchange_accounts enable row level security;
drop policy if exists exchange_accounts_self_select on public.exchange_accounts;
create policy exchange_accounts_self_select on public.exchange_accounts for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.exchange_accounts from anon, authenticated;
grant select on public.exchange_accounts to authenticated;

create index if not exists idx_exchange_accounts_user on public.exchange_accounts(user_id);

create or replace function public.touch_exchange_account()
returns trigger language plpgsql security invoker
set search_path = public
as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists exchange_accounts_touch on public.exchange_accounts;
create trigger exchange_accounts_touch before update on public.exchange_accounts for each row execute function public.touch_exchange_account();

create or replace function public.vault_store_exchange_credential(p_secret text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  if p_secret is null or length(trim(p_secret)) = 0 then raise exception 'secret required'; end if;
  select id into v_id from vault.secrets where name = p_name limit 1;
  if v_id is not null then
    perform vault.update_secret(v_id, p_secret, p_name, 'Exchange credential');
    return v_id;
  end if;
  return vault.create_secret(p_secret, p_name, 'Exchange credential');
end;
$$;

revoke all on function public.vault_store_exchange_credential(text,text) from public, anon, authenticated;
grant execute on function public.vault_store_exchange_credential(text,text) to service_role;
