import assert from 'node:assert/strict';
import test from 'node:test';
import { createCopyEngine } from '../src/copy-engine.js';
import { createCopySignal } from '../src/copy-signal.js';
import { createMasterProfile, createFollowerSubscription } from '../src/master-follower.js';
import { COPY_TRADING_MODES } from '../src/copy-trading-mode.js';

const LIVE_ADAPTER = Object.freeze({ mode: 'LIVE', submitOrder: async () => ({ ok: true }) });

function buildFixture({ masters = 3, followersPerMaster = 100, mode = COPY_TRADING_MODES.DEMO } = {}) {
  const masterProfiles = [];
  const subscriptions = new Map();

  for (let m = 0; m < masters; m += 1) {
    const master = createMasterProfile({ masterId: `master-${m}`, name: `Master ${m}` });
    masterProfiles.push(master);
    for (let f = 0; f < followersPerMaster; f += 1) {
      const followerId = `follower-${m}-${f}`;
      subscriptions.set(`${followerId}:${master.masterId}`, createFollowerSubscription({
        followerId,
        masterId: master.masterId,
        mode,
        allocation: 0.5 + (f % 3) * 0.25,
        maxRiskPercent: 25,
        liveExecutionEnabled: mode === COPY_TRADING_MODES.LIVE,
        exchangeAdapter: mode === COPY_TRADING_MODES.LIVE ? LIVE_ADAPTER : null
      }));
    }
  }
  return { masterProfiles, subscriptions };
}

test('stress: 3 masters x 100 followers produce deterministic fan-out', () => {
  const { masterProfiles, subscriptions } = buildFixture();
  const engine = createCopyEngine();

  let total = 0;
  for (const master of masterProfiles) {
    const signal = createCopySignal({
      signalId: `stress-${master.masterId}`,
      masterId: master.masterId,
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 2,
      price: 100000,
      timestamp: 1700000000000
    });
    const intents = engine.planSignal({ master, signal, subscriptions });
    assert.equal(intents.length, 100);
    assert.equal(new Set(intents.map((x) => x.idempotencyKey)).size, 100);
    total += intents.length;
  }
  assert.equal(total, 300);
});

test('duplicate: same signal is copied once per follower', () => {
  const { masterProfiles, subscriptions } = buildFixture({ masters: 1, followersPerMaster: 50 });
  const engine = createCopyEngine();
  const master = masterProfiles[0];
  const signal = createCopySignal({ signalId: 'duplicate-1', masterId: master.masterId, symbol: 'ETHUSDT', side: 'SELL', quantity: 1 });

  const first = engine.planSignal({ master, signal, subscriptions });
  const second = engine.planSignal({ master, signal, subscriptions });

  assert.equal(first.length, 50);
  assert.equal(second.length, 0);
  assert.equal(engine.processedKeys.size, 50);
});

test('multiple masters: follower only receives its subscribed master signal', () => {
  const { masterProfiles, subscriptions } = buildFixture({ masters: 3, followersPerMaster: 20 });
  const engine = createCopyEngine();
  const signal = createCopySignal({ signalId: 'master-1-only', masterId: 'master-1', symbol: 'SOLUSDT', side: 'BUY', quantity: 3 });
  const intents = engine.planSignal({ master: masterProfiles[1], signal, subscriptions });

  assert.equal(intents.length, 20);
  assert.ok(intents.every((x) => x.masterId === 'master-1'));
  assert.ok(intents.every((x) => x.followerId.startsWith('follower-1-')));
});

test('failure: master/signal mismatch fails closed', () => {
  const { masterProfiles, subscriptions } = buildFixture({ masters: 2, followersPerMaster: 5 });
  const engine = createCopyEngine();
  const signal = createCopySignal({ signalId: 'wrong-master', masterId: 'master-1', symbol: 'BTCUSDT', side: 'BUY', quantity: 1 });

  assert.throws(() => engine.planSignal({ master: masterProfiles[0], signal, subscriptions }), /signal master does not match master profile/);
});

test('failure: malformed signal is rejected before fan-out', () => {
  const { masterProfiles, subscriptions } = buildFixture({ masters: 1, followersPerMaster: 5 });
  const engine = createCopyEngine();
  assert.throws(() => engine.planSignal({
    master: masterProfiles[0],
    signal: { signalId: 'bad', masterId: 'master-0', symbol: 'BTCUSDT', side: 'BUY', quantity: 0 },
    subscriptions
  }), /quantity must be positive/);
  assert.equal(engine.processedKeys.size, 0);
});

test('paused/disabled followers are excluded without poisoning other followers', () => {
  const master = createMasterProfile({ masterId: 'master-paused', name: 'Paused Test' });
  const subscriptions = new Map([
    ['active:master-paused', createFollowerSubscription({ followerId: 'active', masterId: master.masterId })],
    ['paused:master-paused', createFollowerSubscription({ followerId: 'paused', masterId: master.masterId, status: 'PAUSED' })],
    ['disabled:master-paused', createFollowerSubscription({ followerId: 'disabled', masterId: master.masterId, status: 'DISABLED' })]
  ]);
  const engine = createCopyEngine();
  const signal = createCopySignal({ signalId: 'status-test', masterId: master.masterId, symbol: 'BTCUSDT', side: 'BUY', quantity: 1 });
  const intents = engine.planSignal({ master, signal, subscriptions });

  assert.deepEqual(intents.map((x) => x.followerId), ['active']);
});

test('live gate: LIVE mode fails closed unless explicitly enabled with LIVE adapter', () => {
  const { masterProfiles, subscriptions } = buildFixture({ masters: 1, followersPerMaster: 2, mode: COPY_TRADING_MODES.LIVE });
  const master = masterProfiles[0];
  const signal = createCopySignal({ signalId: 'live-gate', masterId: master.masterId, symbol: 'BTCUSDT', side: 'BUY', quantity: 1 });
  const engine = createCopyEngine();

  assert.throws(() => engine.planSignal({ master, signal, subscriptions, mode: COPY_TRADING_MODES.LIVE }), /live execution is disabled/);
  assert.throws(() => engine.planSignal({ master, signal, subscriptions, mode: COPY_TRADING_MODES.LIVE, liveExecutionEnabled: true }), /LIVE copy execution requires/);
  const intents = engine.planSignal({ master, signal, subscriptions, mode: COPY_TRADING_MODES.LIVE, liveExecutionEnabled: true, exchangeAdapter: LIVE_ADAPTER });
  assert.equal(intents.length, 2);
});

test('timeout budget: 100 concurrent planning calls complete within 2 seconds', async () => {
  const { masterProfiles, subscriptions } = buildFixture({ masters: 1, followersPerMaster: 200 });
  const master = masterProfiles[0];
  const engine = createCopyEngine();
  const calls = Array.from({ length: 100 }, (_, i) => Promise.resolve().then(() => engine.planSignal({
    master,
    signal: createCopySignal({ signalId: `concurrent-${i}`, masterId: master.masterId, symbol: 'BTCUSDT', side: i % 2 ? 'SELL' : 'BUY', quantity: 1 }),
    subscriptions
  })));

  const started = Date.now();
  const results = await Promise.race([
    Promise.all(calls),
    new Promise((_, reject) => setTimeout(() => reject(new Error('copy-engine stress timeout')), 2000))
  ]);
  assert.equal(results.length, 100);
  assert.equal(engine.processedKeys.size, 20000);
  assert.ok(Date.now() - started < 2000);
});
