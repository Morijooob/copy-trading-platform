import assert from 'node:assert/strict';
import { ExecutionProofChain } from '../src/execution-proof-chain.js';

const riskSnapshot = { version: 'risk-v1:42', hash: 'snapshot-hash-42' };
const chain = new ExecutionProofChain();

const intent = chain.createIntent({ masterId: 'master-1', followerId: 'follower-1', signalId: 'signal-1', sequence: 1, side: 'buy', symbol: 'BTCUSDT', quantity: 0.01, riskSnapshot });
assert.equal(intent.status, 'admitted');
assert.equal(intent.duplicate, false);

const duplicateIntent = chain.createIntent({ masterId: 'master-1', followerId: 'follower-1', signalId: 'signal-1', sequence: 1, side: 'buy', symbol: 'BTCUSDT', quantity: 0.01, riskSnapshot });
assert.equal(duplicateIntent.duplicate, true);
assert.equal(duplicateIntent.intentHash, intent.intentHash);

assert.throws(() => chain.createIntent({ masterId: 'master-1', followerId: 'follower-2', signalId: 'signal-2', sequence: 3, side: 'buy', symbol: 'BTCUSDT', quantity: 0.01, riskSnapshot }), /non_monotonic_sequence/);
assert.throws(() => chain.acknowledge({ idempotencyKey: intent.idempotencyKey, exchangeOrderId: 'ex-1', riskSnapshot: { version: 'risk-v1:41', hash: 'old' } }), /risk_snapshot_mismatch/);

const ack = chain.acknowledge({ idempotencyKey: intent.idempotencyKey, exchangeOrderId: 'ex-1', riskSnapshot });
assert.equal(ack.status, 'acknowledged');

assert.throws(() => chain.recordFill({ idempotencyKey: intent.idempotencyKey, exchangeOrderId: 'ex-other', fillId: 'fill-1', quantity: 0.01, price: 100000 }), /order_binding_mismatch/);
const fill = chain.recordFill({ idempotencyKey: intent.idempotencyKey, exchangeOrderId: 'ex-1', fillId: 'fill-1', quantity: 0.01, price: 100000 });
assert.equal(fill.duplicate, false);
const duplicateFill = chain.recordFill({ idempotencyKey: intent.idempotencyKey, exchangeOrderId: 'ex-1', fillId: 'fill-1', quantity: 0.01, price: 100000 });
assert.equal(duplicateFill.duplicate, true);
assert.equal(duplicateFill.fillHash, fill.fillHash);

assert.throws(() => chain.assertReconciled(intent.idempotencyKey), /ledger_reconciliation_missing/);
const ledger = chain.reconcileLedger({ fillId: 'fill-1', ledgerId: 'ledger-1' });
assert.equal(ledger.duplicate, false);
assert.equal(chain.assertReconciled(intent.idempotencyKey).ok, true);
const duplicateLedger = chain.reconcileLedger({ fillId: 'fill-1', ledgerId: 'ledger-1-retry' });
assert.equal(duplicateLedger.duplicate, true);
assert.equal(duplicateLedger.ledgerId, 'ledger-1');

// Simulate crash/retry at each boundary: repeat the same calls and require idempotent results.
const retryIntent = chain.createIntent({ masterId: 'master-1', followerId: 'follower-1', signalId: 'signal-1', sequence: 1, side: 'buy', symbol: 'BTCUSDT', quantity: 0.01, riskSnapshot });
const retryAck = chain.acknowledge({ idempotencyKey: intent.idempotencyKey, exchangeOrderId: 'ex-1', riskSnapshot });
const retryFill = chain.recordFill({ idempotencyKey: intent.idempotencyKey, exchangeOrderId: 'ex-1', fillId: 'fill-1', quantity: 0.01, price: 100000 });
const retryLedger = chain.reconcileLedger({ fillId: 'fill-1', ledgerId: 'ledger-1' });
assert.equal(retryIntent.duplicate, true);
assert.equal(retryAck.exchangeOrderId, 'ex-1');
assert.equal(retryFill.duplicate, true);
assert.equal(retryLedger.duplicate, true);

// Two followers may progress independently, but each master signal sequence remains monotonic.
const follower2 = chain.createIntent({ masterId: 'master-1', followerId: 'follower-2', signalId: 'signal-2', sequence: 2, side: 'sell', symbol: 'BTCUSDT', quantity: 0.02, riskSnapshot });
assert.equal(follower2.sequence, 2);
assert.throws(() => chain.createIntent({ masterId: 'master-1', followerId: 'follower-3', signalId: 'signal-3', sequence: 2, side: 'sell', symbol: 'BTCUSDT', quantity: 0.02, riskSnapshot }), /non_monotonic_sequence/);

console.log('Execution proof chain: idempotency, stale-snapshot, ACK binding, duplicate fill, ledger recovery and sequence-race torture PASSED');
