import assert from 'node:assert/strict';
import { ExecutionProofChain } from '../src/execution-proof-chain.js';

const riskSnapshot = { version: 'risk-v1:gate12', hash: 'snapshot-gate12' };
const chain = new ExecutionProofChain();

const intent = chain.createIntent({
  masterId: 'master-12', followerId: 'follower-1', signalId: 'signal-12', sequence: 1,
  side: 'buy', symbol: 'BTCUSDT', quantity: 0.01, riskSnapshot
});
chain.acknowledge({ idempotencyKey: intent.idempotencyKey, exchangeOrderId: 'ex-12', riskSnapshot });

const fill1 = chain.recordFill({
  idempotencyKey: intent.idempotencyKey, exchangeOrderId: 'ex-12', fillId: 'fill-1', quantity: 0.004, price: 100000
});
const fill2 = chain.recordFill({
  idempotencyKey: intent.idempotencyKey, exchangeOrderId: 'ex-12', fillId: 'fill-2', quantity: 0.006, price: 100100
});

assert.throws(() => chain.recordFill({
  idempotencyKey: intent.idempotencyKey, exchangeOrderId: 'ex-12', fillId: 'fill-1', quantity: 0.005, price: 100000
}), /conflicting_duplicate_fill/);

assert.throws(() => chain.assertReconciled(intent.idempotencyKey), /ledger_reconciliation_missing/);
chain.reconcileLedger({ fillId: fill1.fillId, ledgerId: 'ledger-1' });
assert.throws(() => chain.assertReconciled(intent.idempotencyKey), /ledger_reconciliation_missing/);
chain.reconcileLedger({ fillId: fill2.fillId, ledgerId: 'ledger-2' });
assert.deepEqual(chain.assertIntegrity(), { ok: true, intentCount: 1, fillCount: 2, ledgerCount: 2 });
assert.equal(chain.assertReconciled(intent.idempotencyKey).fillCount, 2);

// Corrupted fill hash must fail closed.
const corruptedFillState = chain.exportState();
corruptedFillState.fills[0].fillHash = 'tampered';
assert.throws(() => ExecutionProofChain.fromState(corruptedFillState).assertIntegrity(), /fill_hash_mismatch/);

// Ledger bound to the wrong order/hash must fail closed.
const corruptedLedgerState = chain.exportState();
corruptedLedgerState.ledger[0].exchangeOrderId = 'wrong-order';
assert.throws(() => ExecutionProofChain.fromState(corruptedLedgerState).assertIntegrity(), /ledger_order_binding_mismatch/);

const corruptedLedgerHashState = chain.exportState();
corruptedLedgerHashState.ledger[0].fillHash = 'wrong-hash';
assert.throws(() => ExecutionProofChain.fromState(corruptedLedgerHashState).assertIntegrity(), /ledger_fill_hash_mismatch/);

// Orphan ledger and orphan fill are both fail-closed.
const orphanLedgerState = chain.exportState();
orphanLedgerState.ledger.push({ ledgerId: 'ledger-orphan', fillId: 'missing-fill', exchangeOrderId: 'ex-12', fillHash: fill1.fillHash });
assert.throws(() => ExecutionProofChain.fromState(orphanLedgerState).assertIntegrity(), /orphan_ledger/);

const orphanFillState = chain.exportState();
orphanFillState.fills.push({ ...fill1, fillId: 'fill-orphan', fillHash: 'will-fail' });
assert.throws(() => ExecutionProofChain.fromState(orphanFillState).assertIntegrity(), /fill_hash_mismatch/);

console.log('Gate 12 ledger integrity torture: partial fills, exact hash binding, orphan detection and fail-closed corruption checks PASSED');
