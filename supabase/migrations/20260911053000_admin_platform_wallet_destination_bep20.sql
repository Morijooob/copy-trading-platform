-- Platform commission destination is intentionally restricted to USDT/BEP20.
-- The same policy is already applied to production; this migration records it in source control.

create or replace function public.save_platform_wallet_destination(
  p_currency text,
  p_network text,
  p_address text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select role into v_role
  from public.profiles
  where id = auth.uid();

  if coalesce(v_role, 'user') <> 'admin' then
    raise exception 'admin access required';
  end if;

  if upper(trim(p_currency)) <> 'USDT' then
    raise exception 'only USDT is supported';
  end if;

  if upper(trim(p_network)) <> 'BEP20' then
    raise exception 'only BEP20 is supported for USDT platform commission wallet';
  end if;

  if length(trim(p_address)) < 10 then
    raise exception 'invalid wallet address';
  end if;

  insert into public.platform_wallet_destinations(currency, network, address, updated_at)
  values ('USDT', 'BEP20', trim(p_address), now())
  on conflict (currency) do update
    set network = excluded.network,
        address = excluded.address,
        updated_at = now();

  insert into public.audit_log(user_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    'platform_wallet_destination_updated',
    'platform_wallet_destination',
    'USDT',
    jsonb_build_object(
      'currency', 'USDT',
      'network', 'BEP20',
      'address', trim(p_address)
    )
  );
end;
$$;

revoke execute on function public.save_platform_wallet_destination(text, text, text) from public, anon, authenticated;
grant execute on function public.save_platform_wallet_destination(text, text, text) to authenticated;
