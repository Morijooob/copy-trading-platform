import assert from 'node:assert/strict';
import test from 'node:test';
import { COPY_TRADING_MODES } from '../src/copy-trading-mode.js';
import {
  addSubscription,
  assertMasterCanPublish,
  assertSubscriptionCanCopy,
  createFollowerSubscription,
  createMasterProfile,
  subscriptionKey
} from '../src/master-follower.js';

test('master profile can exist without an exchange account', () => {
  const master = createMasterProfile({ masterId: 'm1', name: 'Alpha', strategy: 'BREAKOUT' });
  assert.equal(master.status, 'ACTIVE');
  assert.doesNotThrow(() => assertMasterCanPublish(master));
});

test('DEMO and PAPER subscriptions require no exchange adapter', () => {
  for (const mode of [COPY_TRADING_MODES.DEMO, COPY_TRADING_MODES.PAPER]) {
    const subscription = createFollowerSubscription({ followerId: 'f1', masterId: 'm1', mode });
    assert.equal(subscription.exchangeAdapter, null);
    assert.equal(subscription.liveExecutionEnabled, false);
    assert.doesNotThrow(() => assertSubscriptionCanCopy(subscription));
  }
});

test('LIVE subscription fails closed unless explicitly enabled with LIVE adapter', () => {
  assert.throws(
    () => createFollowerSubscription({ followerId: 'f1', masterId: 'm1', mode: COPY_TRADING_MODES.LIVE }),
    /live execution is disabled/
  );

  assert.throws(
    () => createFollowerSubscription({
      followerId: 'f1',
      masterId: 'm1',
      mode: COPY_TRADING_MODES.LIVE,
      liveExecutionEnabled: true,
      exchangeAdapter: { mode: 'PAPER', submitOrder() {} }
    }),
    /explicit LIVE exchange adapter/
  );
});

test('LIVE subscription accepts only an explicit LIVE adapter', () => {
  const adapter = { mode: 'LIVE', submitOrder() {} };
  const subscription = createFollowerSubscription({
    followerId: 'f1',
    masterId: 'm1',
    mode: COPY_TRADING_MODES.LIVE,
    liveExecutionEnabled: true,
    exchangeAdapter: adapter
  });
  assert.equal(subscription.exchangeAdapter, adapter);
  assert.equal(subscription.liveExecutionEnabled, true);
});

test('duplicate follower-master subscriptions are rejected', () => {
  const map = new Map();
  const subscription = createFollowerSubscription({ followerId: 'f1', masterId: 'm1' });
  addSubscription(map, subscription);
  assert.equal(subscriptionKey(subscription), 'f1:m1');
  assert.throws(() => addSubscription(map, subscription), /already subscribed/);
});

test('inactive master or subscription cannot publish/copy', () => {
  assert.throws(
    () => assertMasterCanPublish(createMasterProfile({ masterId: 'm1', name: 'Paused', status: 'PAUSED' })),
    /master is not active/
  );
  assert.throws(
    () => assertSubscriptionCanCopy(createFollowerSubscription({ followerId: 'f1', masterId: 'm1', status: 'PAUSED' })),
    /subscription is not active/
  );
});
