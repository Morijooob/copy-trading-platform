import assert from 'node:assert/strict';
import { NetworkPersistenceStore } from '../src/network-persistence-store.js';
import { PersistentNetworkResilience } from '../src/persistent-network-resilience.js';

const order = { symbol: 'ETHUSDT', side: 'BUY', quantity: 1 };

{
  let submitCalls = 0;
  let reconcileCalls = 0;
  let exchangeAccepted = false;
  const submit = () => {
    submitCalls += 1;
    if (submitCalls > 1) throw new Error('DUPLICATE EXCHANGE SUBMISSION');
    exchangeAccepted = true;
    throw new Error('timeout after acceptance');
  };
  const reconcile = () => {
    reconcileCalls += 1;
    return exchangeAccepted
      ? { confirmed: true, exchangeOrderId: 'ex-chaos-1', filledQty: 0.4 }
      : { confirmed: false };
  };
  const store = new NetworkPersistenceStore();
  const first = new PersistentNetworkResilience({ store, submit, reconcile });
  const firstResult = first.execute({ clientRequestId: 'chaos-1', order });
  assert.equal(firstResult.status, 'UNKNOWN');
  assert.equal(submitCalls, 1);

  const restarted = new PersistentNetworkResilience({ store, submit, reconcile });
  const recovered = restarted.recoverAfterRestart();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, 'CONFIRMED');
  assert.equal(recovered[0].filledQty, 0.4);
  assert.equal(recovered[0].exchangeOrderId, 'ex-chaos-1');
  assert.equal(submitCalls, 1);
  assert.equal(reconcileCalls, 1);

  const duplicate = restarted.execute({ clientRequestId: 'chaos-1', order });
  assert.equal(duplicate.status, 'CONFIRMED');
  assert.equal(submitCalls, 1);
  assert.equal(1 - recovered[0].filledQty, 0.6);
}

{
  let submitCalls = 0;
  let releaseSubmit;
  const gate = new Promise((resolve) => { releaseSubmit = resolve; });
  const executor = new PersistentNetworkResilience({
    store: new NetworkPersistenceStore(),
    submit: () => {
      submitCalls += 1;
      throw new Error('concurrent timeout');
    },
    reconcile: () => ({ confirmed: false }),
  });

  const p1 = Promise.resolve(executor.execute({ clientRequestId: 'concurrent-1', order }));
  const p2 = Promise.resolve(executor.execute({ clientRequestId: 'concurrent-1', order }));
  releaseSubmit?.();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(submitCalls, 1, 'same intent must never be submitted twice');
  assert.equal(r1.status, 'UNKNOWN');
  assert.equal(r2.status, 'UNKNOWN');
}

{
  const followers = ['follower-a', 'follower-b', 'follower-c', 'follower-d'];
  const submitCalls = new Map();
  const executors = new Map();

  for (const followerId of followers) {
    submitCalls.set(followerId, 0);
    executors.set(
      followerId,
      new PersistentNetworkResilience({
        store: new NetworkPersistenceStore(),
        submit: () => {
          submitCalls.set(followerId, submitCalls.get(followerId) + 1);
          throw new Error(`timeout-${followerId}`);
        },
        reconcile: () => ({ confirmed: false }),
      }),
    );
  }

  const results = await Promise.all(
    followers.flatMap((followerId) => [
      Promise.resolve(executors.get(followerId).execute({ clientRequestId: `master-1:${followerId}`, order })),
      Promise.resolve(executors.get(followerId).execute({ clientRequestId: `master-1:${followerId}`, order })),
    ]),
  );

  assert.equal(results.length, followers.length * 2);
  for (const followerId of followers) {
    assert.equal(submitCalls.get(followerId), 1, `follower ${followerId} received a duplicate exchange submission`);
  }
}

console.log('PASS: combined chaos torture scenarios');
