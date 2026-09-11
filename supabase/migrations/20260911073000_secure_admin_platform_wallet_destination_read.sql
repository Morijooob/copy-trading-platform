create or replace function public.get_platform_wallet_destination()
returns table(currency text, network text, address text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'admin access required';
  end if;
  return query
    select d.currency, d.network, d.address, d.updated_at
    from public.platform_wallet_destinations d
    where d.currency = 'USDT'
    limit 1;
end;
$$;

revoke execute on function public.get_platform_wallet_destination() from public, anon, authenticated;
grant execute on function public.get_platform_wallet_destination() to authenticated;

drop function if exists public.get_platform_wallet_destination(text);
