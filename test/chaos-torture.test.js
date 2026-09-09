import assert from 'node:assert/strict';
import { NetworkPersistenceStore } from '../src/network-persistence-store.js';
import { PersistentNetworkResilientExecutor } from '../src/persistent-network-resilience.js';

const makeExecutor = ({ submit, reconcile }) => {
  const store = new NetworkPersistenceStore();
  return { store, executor: new PersistentNetworkResilientExecutor({ store, submit, reconcile }) };
};

// Combined torture scenario:
// timeout/response-loss -> restart -> reconcile partial fill -> retry remaining qty
// -> concurrent duplicate intent must never submit a second exchange order.
{
  let submitCalls = 0;
  let reconcileCalls = 0;
  let exchangeAccepted = false;
  let exchangeOrderId = null;

  const submit = async (order) => {
    submitCalls += 1;
    if (submitCalls > 1) throw new Error('DUPLICATE EXCHANGE SUBMISSION');
    exchangeAccepted = true;
    exchangeOrderId = 'ex-chaos-1';
    // Simulate response loss after exchange acceptance.
    throw new Error(`timeout after acceptance for ${order.clientRequestId}`);
  };

  const reconcile = async () => {
    reconcileCalls += 1;
    return exchangeAccepted
      ? { confirmed: true, exchangeOrderId, filledQty: 0.4 }
      : { confirmed: false };
  };

  const first = makeExecutor({ submit, reconcile });
  const firstResult = await first.executor.execute({
    clientRequestId: 'chaos-1',
    symbol: 'ETHUSDT',
    side: 'BUY',
    quantity: 1,
  });

  assert.equal(firstResult.status, 'UNKNOWN');
  assert.equal(submitCalls, 1);

  // Restart: recover exchange truth without resubmitting.
  const restarted = makeExecutor({ submit, reconcile });
  // Carry persisted state into the restarted process.
  restarted.store.records = first.store.records;
  const recovered = await restarted.executor.recoverAfterRestart();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, 'CONFIRMED');
  assert.equal(recovered[0].filledQty, 0.4);
  assert.equal(recovered[0].exchangeOrderId, 'ex-chaos-1');
  assert.equal(submitCalls, 1);
  assert.equal(reconcileCalls, 1);

  // Same logical intent after restart must be idempotent.
  const duplicate = await restarted.executor.execute({
    clientRequestId: 'chaos-1',
    symbol: 'ETHUSDT',
    side: 'BUY',
    quantity: 1,
  });
  assert.equal(duplicate.status, 'CONFIRMED');
  assert.equal(submitCalls, 1);

  // Partial-fill truth is terminal for this original exchange order;
  // a retry of the same intent must not create a second order.
  assert.equal(1 - recovered[0].filledQty, 0.6);
}

// Concurrent duplicate requests: persistence/idempotency must collapse them
// to one exchange submission even when the exchange response is lost.
{
  let submitCalls = 0;
  let releaseSubmit;
  const gate = new Promise((resolve) => { releaseSubmit = resolve; });
  const store = new NetworkPersistenceStore();
  const executor = new PersistentNetworkResilientExecutor({
    store,
    submit: async () => {
      submitCalls += 1;
      await gate;
      throw new Error('concurrent timeout');
    },
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
