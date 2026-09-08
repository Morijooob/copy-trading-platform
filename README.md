# Copy Trading Platform

## Gate 1 — Crash + Timeout + Partial Fill + Recovery

Gate 1 validates order integrity and ledger correctness before Replay Engine and Risk Engine work begins.

### Pipeline

`Master Trade → Validator → Risk Engine → Copy Engine → Virtual Exchange → Partial Fill → Timeout/Crash → Reconciliation → Ledger`

### Gate 1 invariants

- Duplicate Orders = 0
- Lost Orders = 0
- Blind Retries = 0
- Ledger Mismatch = 0
- Negative Position = 0
- Negative Balance = 0
- Unreconciled Orders = 0
- Impossible Balance = 0

A single critical failure means Gate 1 FAIL.

## Scope

This stage is simulation-only. No live exchange, real API keys, authentication, or real-money execution is included.

The simulator must model:

- deterministic order IDs / clientOrderId
- partial fills
- timeout with UNKNOWN state
- exchange reconciliation
- crash recovery
- duplicate-order protection
- balance and position invariants
- deterministic fault injection

## Test contract

Every scenario follows:

`INPUT → FAULT INJECTION → EXPECTED STATE → ACTUAL STATE → PASS/FAIL`

The test runner must report actual executed results; PASS is never assumed.
