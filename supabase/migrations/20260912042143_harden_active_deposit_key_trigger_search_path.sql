-- Keep the active deposit-address integrity trigger on a fixed search_path.
-- This removes the Supabase security-linter warning without changing behavior.

create or replace function public.assert_active_deposit_address_has_key()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status='active' and new.secret_id is null then
    raise exception 'active deposit address requires vault secret reference';
  end if;
  return new;
end;
$$;
