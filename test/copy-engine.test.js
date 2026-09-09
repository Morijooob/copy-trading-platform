import assert from 'node:assert/strict';
import test from 'node:test';
import { createCopyEngine } from '../src/copy-engine.js';
import { createCopySignal } from '../src/copy-signal.js';
import { COPY_TRADING_MODES } from '../src/copy-trading-mode.js';
import { createMasterProfile, createFollowerSubscription, subscriptionKey } from '../src/master-follower.js';

const master = createMasterProfile({ masterId: 'm1', name: 'Master One' });
const signal = createCopySignal({ signalId: 'sig-1', masterId: 'm1', symbol: 'btcusdt', side: 'BUY', quantity: 2, price: 100, timestamp: 1700000000000 });
const paperSub = (followerId, allocation = 1) => createFollowerSubscription({ followerId, masterId: 'm1', mode: COPY_TRADING_MODES.PAPER, allocation, maxRiskPercent: 50 });

const unrelatedPaperSub = (followerId, masterId, allocation = 1) => createFollowerSubscription({ followerId, masterId, mode: COPY_TRADING_MODES.PAPER, allocation, maxRiskPercent: 50 });

test('fans one master signal out to all active matching followers', () => {
  const subscriptions = new Map([
    [subscriptionKey({ followerId: 'f1', masterId: 'm1' }), paperSub('f1', 1)],
    [subscriptionKey({ followerId: 'f2', masterId: 'm1' }), paperSub('f2', 0.5)],
    [subscriptionKey({ followerId: 'other', masterId: 'm2' }), unrelatedPaperSub('other', 'm2', 1)]
  ]);
  const engine = createCopyEngine();
  const intents = engine.planSignal({ master, signal, subscriptions, mode: COPY_TRADING_MODES.PAPER });

  assert.equal(intents.length, 2);
  assert.equal(intents[0].quantity, 2);
  assert.equal(intents[1].quantity, 1);
  assert.equal(intents[0].symbol, 'BTCUSDT');
});

test('paused follower is skipped without failing the fanout', () => {
  const subscriptions = new Map([
    [subscriptionKey({ followerId: 'f1', masterId: 'm1' }), paperSub('f1')],
    [subscriptionKey({ followerId: 'f2', masterId: 'm1' }), createFollowerSubscription({ followerId: 'f2', masterId: 'm1', mode: COPY_TRADING_MODES.PAPER, status: 'PAUSED' })]
  ]);
  const engine = createCopyEngine();
  const intents = engine.planSignal({ master, signal, subscriptions, mode: COPY_TRADING_MODES.PAPER });
  assert.deepEqual(intents.map((intent) => intent.followerId), ['f1']);
});

test('same signal is idempotent per follower', () => {
  const subscriptions = new Map([
    [subscriptionKey({ followerId: 'f1', masterId: 'm1' }), paperSub('f1')],
    [subscriptionKey({ followerId: 'f2', masterId: 'm1' }), paperSub('f2')]
  ]);
  const engine = createCopyEngine();
  assert.equal(engine.planSignal({ master, signal, subscriptions, mode: COPY_TRADING_MODES.PAPER }).length, 2);
  assert.equal(engine.planSignal({ master, signal, subscriptions, mode: COPY_TRADING_MODES.PAPER }).length, 0);
});

test('DEMO and PAPER planning never requires an exchange', () => {
  const subscriptions = new Map([[subscriptionKey({ followerId: 'f1', masterId: 'm1' }), paperSub('f1')]]);
  const engine = createCopyEngine();
  const intents = engine.planSignal({ master, signal, subscriptions, mode: COPY_TRADING_MODES.PAPER });
  assert.equal(intents[0].exchangeAdapter, null);
});

test('LIVE planning fails closed without explicit live execution', () => {
  const liveSub = createFollowerSubscription({ followerId: 'f1', masterId: 'm1', mode: COPY_TRADING_MODES.LIVE, liveExecutionEnabled: true, exchangeAdapter: { mode: 'LIVE', submitOrder() {} } });
  const subscriptions = new Map([[subscriptionKey(liveSub), liveSub]]);
  const engine = createCopyEngine();
  assert.throws(() => engine.planSignal({ master, signal, subscriptions, mode: COPY_TRADING_MODES.LIVE }), /live execution is disabled/);
});

test('LIVE planning requires an explicit LIVE adapter and does not submit orders', () => {
  let submits = 0;
  const adapter = { mode: 'LIVE', submitOrder() { submits += 1; } };
  const liveSub = createFollowerSubscription({ followerId: 'f1', masterId: 'm1', mode: COPY_TRADING_MODES.LIVE, liveExecutionEnabled: true, exchangeAdapter: adapter });
  const subscriptions = new Map([[subscriptionKey(liveSub), liveSub]]);
  const engine = createCopyEngine();
  const intents = engine.planSignal({ master, signal, subscriptions, mode: COPY_TRADING_MODES.LIVE, liveExecutionEnabled: true, exchangeAdapter: adapter });
  assert.equal(intents.length, 1);
  assert.equal(intents[0].exchangeAdapter, adapter);
  assert.equal(submits, 0);
});

test('inactive master cannot publish a copy signal', () => {
  const inactiveMaster = createMasterProfile({ masterId: 'm1', name: 'Master One', status: 'PAUSED' });
  const subscriptions = new Map([[subscriptionKey({ followerId: 'f1', masterId: 'm1' }), paperSub('f1')]]);
  const engine = createCopyEngine();
  assert.throws(() => engine.planSignal({ master: inactiveMaster, signal, subscriptions, mode: COPY_TRADING_MODES.PAPER }), /master is not active/);
});
