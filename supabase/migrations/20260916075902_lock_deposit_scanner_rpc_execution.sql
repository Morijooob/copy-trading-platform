-- Security hardening: the deposit scanner readiness RPC is service-side only.
-- Keep it out of the public REST RPC surface so anon/authenticated users cannot
-- invoke a SECURITY DEFINER readiness check directly.
REVOKE EXECUTE ON FUNCTION public.enforce_deposit_scanner_ready() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_deposit_scanner_ready() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_deposit_scanner_ready() FROM authenticated;
