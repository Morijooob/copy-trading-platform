import assert from 'node:assert/strict';
import { NetworkPersistenceStore } from '../src/network-persistence-store.js';
import { PersistentNetworkResilientExecutor } from '../src/persistent-network-resilience.js';

{
  let submitCalls = 0;
  let reconcileCalls = 0;
  let exchangeAccepted = false;
  const submit = async () => {
    submitCalls += 1;
    if (submitCalls > 1) throw new Error('DUPLICATE EXCHANGE SUBMISSION');
    exchangeAccepted = true;
    throw new Error('timeout after acceptance');
  };
  const reconcile = async () => {
    reconcileCalls += 1;
    return exchangeAccepted ? { confirmed: true, exchangeOrderId: 'ex-chaos-1', filledQty: 0.4 } : { confirmed: false };
  };
  const first = new PersistentNetworkResilientExecutor({ store: new NetworkPersistenceStore(), submit, reconcile });
  const firstResult = await first.execute({ clientRequestId: 'chaos-1', symbol: 'ETHUSDT', side: 'BUY', quantity: 1 });
  assert.equal(firstResult.status, 'UNKNOWN');
  assert.equal(submitCalls, 1);
  const restarted = new PersistentNetworkResilientExecutor({ store: first.store, submit, reconcile });
  const recovered = await restarted.recoverAfterRestart();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, 'CONFIRMED');
  assert.equal(recovered[0].filledQty, 0.4);
  assert.equal(recovered[0].exchangeOrderId, 'ex-chaos-1');
  assert.equal(submitCalls, 1);
  assert.equal(reconcileCalls, 1);
  const duplicate = await restarted.execute({ clientRequestId: 'chaos-1', symbol: 'ETHUSDT', side: 'BUY', quantity: 1 });
  assert.equal(duplicate.status, 'CONFIRMED');
  assert.equal(submitCalls, 1);
  assert.equal(1 - recovered[0].filledQty, 0.6);
}

{
  let submitCalls = 0;
  let releaseSubmit;
  const gate = new Promise((resolve) => { releaseSubmit = resolve; });
  const executor = new PersistentNetworkResilientExecutor({
    store: new NetworkPersistenceStore(),
    submit: async () => { submitCalls += 1; await gate; throw new Error('concurrent timeout'); },
    reconcile: async () => ({ confirmed: false }),
  });
  const p1 = executor.execute({ clientRequestId: 'concurrent-1', symbol: 'BTCUSDT', side: 'BUY', quantity: 1 });
  const p2 = executor.execute({ clientRequestId: 'concurrent-1', symbol: 'BTCUSDT', side: 'BUY', quantity: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  releaseSubmit();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(submitCalls, 1, 'same intent must never be submitted twice');
  assert.ok(['UNKNOWN', 'CONFIRMED'].includes(r1.status));
  assert.ok(['UNKNOWN', 'CONFIRMED'].includes(r2.status));
}

console.log('PASS: combined chaos torture scenarios');
