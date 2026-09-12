import assert from 'node:assert/strict';
import { RealCopyTradingEngine } from '../src/real/real-copy-trading-engine.js';

const allSecurity = Object.fromEntries([
  'backendOnlyExecution', 'authenticatedSessions', 'secureCookies',
  'twoFactorForRealTrading', 'serverSideSecretStore', 'withdrawalsDisabled',
  'killSwitch', 'riskLimits', 'idempotency', 'auditIntegrity', 'monitoringAndAlerts'
].map((key) => [key, true]));

const safety = {
  maxNotional: 1000,
  maxDailyLoss: 100,
  maxExposure: 2000
};

let placed = 0;
const exchange = {
  async order(order) {
    placed += 1;
    return { order_id: `ex-${placed}`, ...order, status: 'NEW' };
  }
};

// 1) Fail closed by default.
const disabled = new RealCopyTradingEngine({ security: allSecurity, safety, exchange });
assert.equal(disabled.status().canPlaceOrders, false);
await assert.rejects(
  disabled.executeFollowerOrder({
    idempotencyKey: 'off-1', masterId: 'master-1', follower: { id: 'f-1' },
    order: { symbol: 'BTCUSDT', side: 'buy', quantity: 0.001, price: 100000 }
  }),
  /explicitly disabled/
);
assert.equal(placed, 0);

// 2) Production controls + explicit flag are required.
const engine = new RealCopyTradingEngine({
  security: allSecurity,
  safety,
  exchange,
  enableRealExecution: true
});
assert.equal(engine.status().canPlaceOrders, true);

const first = await engine.executeFollowerOrder({
  idempotencyKey: 'copy-1',
  masterId: 'master-1',
  follower: { id: 'f-1' },
  order: { symbol: 'BTCUSDT', side: 'buy', quantity: 0.001, price: 100000 }
});
assert.equal(first.duplicate, false);
assert.equal(first.exchangeOrder.order_id, 'ex-1');
assert.equal(placed, 1);

const duplicate = await engine.executeFollowerOrder({
  idempotencyKey: 'copy-1',
  masterId: 'master-1',
  follower: { id: 'f-1' },
  order: { symbol: 'BTCUSDT', side: 'buy', quantity: 0.001, price: 100000 }
});
assert.equal(duplicate.duplicate, true);
assert.equal(placed, 1);

// 3) Risk blocks before the exchange call.
await assert.rejects(
  engine.executeFollowerOrder({
    idempotencyKey: 'copy-risk',
    masterId: 'master-1',
    follower: { id: 'f-1' },
    dailyLoss: 101,
    order: { symbol: 'BTCUSDT', side: 'buy', quantity: 0.001, price: 100000 }
  }),
  /execution blocked/
);
assert.equal(placed, 1);

// 4) A failed exchange call must not permanently consume the idempotency key.
let fail = true;
const flakyExchange = {
  async order(order) {
    if (fail) { fail = false; throw new Error('temporary exchange failure'); }
    placed += 1;
    return { order_id: `ex-${placed}`, ...order, status: 'NEW' };
  }
};
const retryEngine = new RealCopyTradingEngine({ security: allSecurity, safety, exchange: flakyExchange, enableRealExecution: true });
await assert.rejects(
  retryEngine.executeFollowerOrder({
    idempotencyKey: 'retry-1', masterId: 'master-1', follower: { id: 'f-2' },
    order: { symbol: 'ETHUSDT', side: 'sell', quantity: 0.01, price: 3000 }
  }),
  /temporary exchange failure/
);
const retried = await retryEngine.executeFollowerOrder({
  idempotencyKey: 'retry-1', masterId: 'master-1', follower: { id: 'f-2' },
  order: { symbol: 'ETHUSDT', side: 'sell', quantity: 0.01, price: 3000 }
});
assert.equal(retried.duplicate, false);

console.log('real copy-trading engine tests passed');
