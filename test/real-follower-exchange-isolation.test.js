import assert from 'node:assert/strict';
import { RealCopyTradingEngine } from '../src/real/real-copy-trading-engine.js';

const allSecurity = Object.fromEntries([
  'backendOnlyExecution', 'authenticatedSessions', 'secureCookies',
  'twoFactorForRealTrading', 'serverSideSecretStore', 'withdrawalsDisabled',
  'killSwitch', 'riskLimits', 'idempotency', 'auditIntegrity', 'monitoringAndAlerts'
].map((key) => [key, true]));

const safety = { maxOrderNotional: 1000, maxDailyLoss: 100, maxExposure: 2000, monitoringHeartbeatMaxAgeMs: 60_000 };
const calls = [];
const adapters = new Map([
  ['follower-a', { order: async (order) => { calls.push(['follower-a', order]); return { order_id: 'a-1' }; } }],
  ['follower-b', { order: async (order) => { calls.push(['follower-b', order]); return { order_id: 'b-1' }; } }]
]);

const engine = new RealCopyTradingEngine({
  security: allSecurity,
  safety,
  enableRealExecution: true,
  exchangeResolver: async (follower) => adapters.get(follower.id) || null
});
engine.service.safety.heartbeat(Date.now());
assert.equal(engine.status().followerExchangeIsolation, true);
assert.equal(engine.status().canPlaceOrders, true);

await engine.executeFollowerOrder({
  idempotencyKey: 'iso-a', masterId: 'master-1', follower: { id: 'follower-a' },
  order: { symbol: 'BTCUSDT', side: 'buy', quantity: 0.001, price: 100000 }
});
await engine.executeFollowerOrder({
  idempotencyKey: 'iso-b', masterId: 'master-1', follower: { id: 'follower-b' },
  order: { symbol: 'BTCUSDT', side: 'buy', quantity: 0.002, price: 100000 }
});

assert.deepEqual(calls.map(([id]) => id), ['follower-a', 'follower-b']);
assert.equal(calls[0][1].quantity, 0.001);
assert.equal(calls[1][1].quantity, 0.002);

const disabledResolver = new RealCopyTradingEngine({
  security: allSecurity,
  safety,
  enableRealExecution: true,
  exchangeResolver: async () => null
});
disabledResolver.service.safety.heartbeat(Date.now());
await assert.rejects(
  disabledResolver.executeFollowerOrder({
    idempotencyKey: 'missing-account', masterId: 'master-1', follower: { id: 'missing' },
    order: { symbol: 'BTCUSDT', side: 'buy', quantity: 0.001, price: 100000 }
  }),
  /follower exchange adapter not configured/
);

console.log('real follower exchange isolation tests passed');
