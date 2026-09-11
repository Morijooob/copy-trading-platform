# Secure USDT Transfer Service

This service is intentionally **disabled by default**. It is the future backend signer boundary for USDT BEP20 treasury withdrawals.

## Security boundary

- No private key is stored in the repository, browser, GitHub Actions, or Supabase database.
- No real transfer is enabled by this scaffold.
- Production signing must use a dedicated secret-managed signer/custody provider.
- The service must validate an approved withdrawal request, exact BEP20 destination, amount, idempotency, and kill switch before signing.
- A transfer is not completed merely because a transaction hash was submitted; the service must verify the transaction on-chain before final settlement.

## Required production flow

1. Admin creates a platform withdrawal request.
2. Backend authorizes exactly one pending request.
3. Signer service validates policy and idempotency.
4. Signer sends USDT on BSC using the protected signing boundary.
5. Service records the transaction hash as pending verification.
6. Service verifies recipient, token contract, amount, chain, and confirmation state.
7. Only then is the withdrawal marked completed.
8. Any failure leaves the request recoverable and prevents duplicate transfer.

## Current state

`TRANSFER_EXECUTION_ENABLED=false` must remain the default until the signer implementation and security gates are complete.
