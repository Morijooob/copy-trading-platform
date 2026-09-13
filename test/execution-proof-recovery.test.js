import assert from 'node:assert/strict';
import { ExecutionProofChain } from '../src/execution-proof-chain.js';

const riskSnapshot = { version: 'risk-v1:recovery', hash: 'snapshot-recovery' };
const base = {
  masterId: 'master-recovery', followerId: 'follower-recovery', signalId: 'signal-recovery',
  sequence: 1, side: 'buy', symbol: 'BTCUSDT', quantity: 0.01, riskSnapshot
};
const key = 'master-recovery:follower-recovery:signal-recovery:1';

const buildCheckpoint = (checkpoint) => {
  const chain = new ExecutionProofChain();
  if (checkpoint === 'before_intent') return chain;
  chain.createIntent(base);
  if (checkpoint === 'after_intent') return chain;
  chain.acknowledge({ idempotencyKey: key, exchangeOrderId: 'ex-recovery', riskSnapshot });
  if (checkpoint === 'after_ack') return chain;
  chain.recordFill({ idempotencyKey: key, exchangeOrderId: 'ex-recovery', fillId: 'fill-partial', quantity: 0.004, price: 100000 });
  if (checkpoint === 'after_partial_fill') return chain;
  chain.recordFill({ idempotencyKey: key, exchangeOrderId: 'ex-recovery', fillId: 'fill-final', quantity: 0.006, price: 100100 });
  if (checkpoint === 'after_fill_before_ledger') return chain;
  chain.reconcileLedger({ fillId: 'fill-partial', ledgerId: 'ledger-partial' });
  chain.reconcileLedger({ fillId: 'fill-final', ledgerId: 'ledger-final' });
  return chain;
};

for (const checkpoint of [
  'before_intent', 'after_intent', 'after_ack', 'after_partial_fill', 'after_fill_before_ledger', 'after_ledger'
]) {
  const chain = buildCheckpoint(checkpoint);
  const recovered = ExecutionProofChain.fromState(chain.exportState());

  const retryIntent = recovered.createIntent(base);
  assert.equal(retryIntent.duplicate, checkpoint !== 'before_intent', `${checkpoint}: intent retry semantics`);

  if (checkpoint === 'before_intent') continue;

  const retryAck = recovered.acknowledge({ idempotencyKey: key, exchangeOrderId: 'ex-recovery', riskSnapshot });
  assert.equal(retryAck.exchangeOrderId, 'ex-recovery');

  if (checkpoint === 'after_intent' || checkpoint === 'after_ack') {
    assert.throws(() => recovered.assertReconciled(key), /fill_missing/);
    continue;
  }

  const partialRetry = recovered.recordFill({ idempotencyKey: key, exchangeOrderId: 'ex-recovery', fillId: 'fill-partial', quantity: 0.004, price: 100000 });
  assert.equal(partialRetry.duplicate, true);

  if (checkpoint === 'after_partial_fill') {
    assert.throws(() => recovered.assertReconciled(key), /ledger_reconciliation_missing/);
    recovered.reconcileLedger({ fillId: 'fill-partial', ledgerId: 'ledger-partial' });
  }

  const finalRetry = recovered.recordFill({ idempotencyKey: key, exchangeOrderId: 'ex-recovery', fillId: 'fill-final', quantity: 0.006, price: 100100 });
  assert.equal(finalRetry.duplicate, checkpoint !== 'after_partial_fill');

  if (checkpoint === 'after_fill_before_ledger') {
    assert.throws(() => recovered.assertReconciled(key), /ledger_reconciliation_missing/);
  }

  if (checkpoint === 'after_fill_before_ledger') {
    recovered.reconcileLedger({ fillId: 'fill-partial', ledgerId: 'ledger-partial' });
    recovered.reconcileLedger({ fillId: 'fill-final', ledgerId: 'ledger-final' });
  } else if (checkpoint === 'after_partial_fill') {
    recovered.reconcileLedger({ fillId: 'fill-final', ledgerId: 'ledger-final' });
  }

  if (checkpoint === 'after_ledger') {
    const duplicateLedger = recovered.reconcileLedger({ fillId: 'fill-final', ledgerId: 'ledger-final-retry' });
    assert.equal(duplicateLedger.duplicate, true);
    assert.equal(duplicateLedger.ledgerId, 'ledger-final');
  }

  assert.equal(recovered.assertReconciled(key).ok, true);
  assert.equal(recovered.assertReconciled(key).fillCount, 2);
}

const conflicting = new ExecutionProofChain();
conflicting.createIntent(base);
assert.throws(() => conflicting.createIntent({ ...base, quantity: 0.02 }), /conflicting_duplicate_intent/);

const corrupted = new ExecutionProofChain();
corrupted.createIntent(base);
const state = corrupted.exportState();
state.sequenceByMaster = [['master-recovery', 0]];
const recovered = ExecutionProofChain.fromState(state);
assert.throws(() => recovered.createIntent({ ...base, sequence: 2 }), /non_monotonic_sequence/);

console.log('Gate 11 recovery torture: crash checkpoints, durable replay, partial-fill recovery, idempotent retries and fail-closed corruption checks PASSED');
