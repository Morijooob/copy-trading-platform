-- Withdrawal RPC is intentionally server-side only.
-- The function validates auth.uid() = p_user_id, but exposing SECURITY DEFINER
-- execution to authenticated clients is unnecessary and triggers a Supabase
-- security warning. Real withdrawal requests must go through the trusted
-- server/service-role execution path.
revoke execute on function public.request_wallet_withdrawal(uuid,numeric,text,text,text) from authenticated;
grant execute on function public.request_wallet_withdrawal(uuid,numeric,text,text,text) to service_role;
