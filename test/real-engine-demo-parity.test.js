import assert from 'node:assert/strict';
import { RealCopyTradingEngine } from '../src/real/real-copy-trading-engine.js';

const security = Object.fromEntries([
  'backendOnlyExecution', 'authenticatedSessions', 'secureCookies',
  'twoFactorForRealTrading', 'serverSideSecretStore', 'withdrawalsDisabled',
  'killSwitch', 'riskLimits', 'idempotency', 'auditIntegrity', 'monitoringAndAlerts'
].map((key) => [key, true]));

const safety = {
  maxOrderNotional: 1000,
  maxDailyLoss: 100,
  maxExposure: 2000,
  monitoringHeartbeatMaxAgeMs: 60_000
};

const order = { symbol: 'BTCUSDT', side: 'buy', quantity: 0.001, price: 100000 };
const calls = [];
const mode = new Map();

const adapter = {
  async order(nextOrder) {
    const followerId = this.followerId;
    const scenario = mode.get(followerId) || 'normal';
    calls.push({ followerId, scenario, order: { ...nextOrder } });

    if (scenario === 'timeout-once') {
      mode.set(followerId, 'normal');
      const error = new Error('exchange timeout before confirmation');
      error.code = 'TIMEOUT';
      throw error;
    }

    if (scenario === 'partial') {
      mode.set(followerId, 'partial-completed');
      return {
        order_id: `partial-${followerId}`,
        status: 'partial',
        filled_quantity: nextOrder.quantity / 2,
        remaining_quantity: nextOrder.quantity / 2
      };
    }

    if (scenario === 'recovery') {
      return {
        order_id: `recovery-${followerId}`,
        status: 'filled',
        filled_quantity: nextOrder.quantity,
        remaining_quantity: 0
      };
    }

    return { order_id: `normal-${followerId}`, status: 'filled', filled_quantity: nextOrder.quantity, remaining_quantity: 0 };
  }
};

const resolver = async (follower) => ({
  ...adapter,
  followerId: follower.id
});

const engine = new RealCopyTradingEngine({
  security,
  safety,
  enableRealExecution: true,
  exchangeResolver: resolver
});
engine.service.safety.heartbeat(Date.now());
assert.equal(engine.status().canPlaceOrders, true);

// 1) Normal: one master signal reaches the intended follower exactly once.
const normal = await engine.executeFollowerOrder({
  idempotencyKey: 'parity-normal', masterId: 'master-1', follower: { id: 'f-normal' }, order
});
assert.equal(normal.exchangeOrder.status, 'filled');
const normalDuplicate = await engine.executeFollowerOrder({
  idempotencyKey: 'parity-normal', masterId: 'master-1', follower: { id: 'f-normal' }, order
});
assert.equal(normalDuplicate.duplicate, true);

// 2) Timeout before confirmation: first attempt fails; retry is allowed and succeeds.
mode.set('f-timeout', 'timeout-once');
await assert.rejects(
  engine.executeFollowerOrder({
    idempotencyKey: 'parity-timeout', masterId: 'master-1', follower: { id: 'f-timeout' }, order
  }),
  /exchange timeout/
);
const timeoutRetry = await engine.executeFollowerOrder({
  idempotencyKey: 'parity-timeout', masterId: 'master-1', follower: { id: 'f-timeout' }, order
});
assert.equal(timeoutRetry.exchangeOrder.status, 'filled');

// 3) Partial fill: the original intent is considered completed only for the
// exchange response; the remaining quantity must use a NEW idempotency key.
mode.set('f-partial', 'partial');
const partial = await engine.executeFollowerOrder({
  idempotencyKey: 'parity-partial', masterId: 'master-1', follower: { id: 'f-partial' }, order
});
assert.equal(partial.exchangeOrder.status, 'partial');
assert.equal(partial.exchangeOrder.remaining_quantity, order.quantity / 2);

mode.set('f-partial', 'recovery');
const recovery = await engine.executeFollowerOrder({
  idempotencyKey: 'parity-partial-recovery',
  masterId: 'master-1',
  follower: { id: 'f-partial' },
  order: { ...order, quantity: order.quantity / 2 }
});
assert.equal(recovery.exchangeOrder.status, 'filled');
assert.equal(recovery.exchangeOrder.remaining_quantity, 0);

// 4) Concurrent duplicate signal: idempotency collapses it to one exchange call.
const before = calls.filter((x) => x.followerId === 'f-concurrent').length;
const concurrentAdapter = await resolver({ id: 'f-concurrent' });
let concurrentCalls = 0;
concurrentAdapter.order = async (nextOrder) => {
  concurrentCalls += 1;
  await new Promise((resolve) => setTimeout(resolve, 10));
  return { order_id: 'concurrent-1', status: 'filled', filled_quantity: nextOrder.quantity, remaining_quantity: 0 };
};
const concurrentResolver = async () => concurrentAdapter;
const concurrentEngine = new RealCopyTradingEngine({ security, safety, enableRealExecution: true, exchangeResolver: concurrentResolver });
concurrentEngine.service.safety.heartbeat(Date.now());
const results = await Promise.all([
  concurrentEngine.executeFollowerOrder({ idempotencyKey: 'parity-concurrent', masterId: 'master-1', follower: { id: 'f-concurrent' }, order }),
  concurrentEngine.executeFollowerOrder({ idempotencyKey: 'parity-concurrent', masterId: 'master-1', follower: { id: 'f-concurrent' }, order })
]);
assert.equal(concurrentCalls, 1);
assert.equal(results.filter((r) => r.duplicate).length, 1);
assert.equal(calls.filter((x) => x.followerId === 'f-concurrent').length, before);

// 5) Missing follower adapter fails closed.
const blocked = new RealCopyTradingEngine({
  security, safety, enableRealExecution: true,
  exchangeResolver: async () => null
});
blocked.service.safety.heartbeat(Date.now());
await assert.rejects(
  blocked.executeFollowerOrder({
    idempotencyKey: 'parity-no-adapter', masterId: 'master-1', follower: { id: 'missing' }, order
  }),
  /follower exchange adapter not configured/
);

console.log('real engine demo parity torture tests: ok');
