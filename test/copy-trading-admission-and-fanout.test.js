import assert from 'node:assert/strict';
import { MasterFollowerCapacity } from '../src/master-follower-capacity.js';
import { RealCopyTradingEngine } from '../src/real/real-copy-trading-engine.js';

// Admission rule: for a given master, only two followers may be active.
// Everyone after the first two must remain queued; duplicate joins must not
// consume another slot.
const capacity = new MasterFollowerCapacity({ maxActive: 2 });
const masterId = 'master-admission-test';
const followers = Array.from({ length: 8 }, (_, i) => `user-${i + 1}`);
const admissions = await Promise.all(
  followers.map((followerId) => Promise.resolve(capacity.join({ masterId, followerId })))
);

assert.equal(admissions.filter((x) => x.status === 'active').length, 2);
assert.equal(admissions.filter((x) => x.status === 'queued').length, 6);
assert.deepEqual(capacity.snapshot(masterId).active, ['user-1', 'user-2']);
assert.deepEqual(capacity.snapshot(masterId).queue, followers.slice(2));

const duplicateThird = capacity.join({ masterId, followerId: 'user-3' });
assert.deepEqual(duplicateThird, { status: 'queued', position: 1, duplicate: true });

const leaveFirst = capacity.leave({ masterId, followerId: 'user-1' });
assert.equal(leaveFirst.promoted, 'user-3');
assert.deepEqual(leaveFirst.snapshot.active, ['user-2', 'user-3']);

// Fan-out must be isolated per follower and duplicate signals must not execute twice.
const security = Object.fromEntries([
  'backendOnlyExecution', 'authenticatedSessions', 'secureCookies',
  'twoFactorForRealTrading', 'serverSideSecretStore', 'withdrawalsDisabled',
  'killSwitch', 'riskLimits', 'idempotency', 'auditIntegrity', 'monitoringAndAlerts'
].map((key) => [key, true]));
const safety = { maxOrderNotional: 1000, maxDailyLoss: 100, maxExposure: 2000, monitoringHeartbeatMaxAgeMs: 60_000 };
const calls = [];
const adapters = new Map([
  ['user-2', { order: async (order) => { calls.push(['user-2', order]); return { order_id: 'u2-1' }; } }],
  ['user-3', { order: async (order) => { calls.push(['user-3', order]); return { order_id: 'u3-1' }; } }]
]);
const engine = new RealCopyTradingEngine({
  security,
  safety,
  enableRealExecution: true,
  exchangeResolver: async (follower) => adapters.get(follower.id) || null
});
engine.service.safety.heartbeat(Date.now());

await Promise.all([
  engine.executeFollowerOrder({
    idempotencyKey: 'signal-1:user-2', masterId,
    follower: { id: 'user-2' },
    order: { symbol: 'BTCUSDT', side: 'buy', quantity: 0.001, price: 100000 }
  }),
  engine.executeFollowerOrder({
    idempotencyKey: 'signal-1:user-3', masterId,
    follower: { id: 'user-3' },
    order: { symbol: 'BTCUSDT', side: 'buy', quantity: 0.002, price: 100000 }
  })
]);

assert.deepEqual(calls.map(([id]) => id).sort(), ['user-2', 'user-3']);

await engine.executeFollowerOrder({
  idempotencyKey: 'signal-1:user-2', masterId,
  follower: { id: 'user-2' },
  order: { symbol: 'BTCUSDT', side: 'buy', quantity: 0.001, price: 100000 }
});
assert.equal(calls.filter(([id]) => id === 'user-2').length, 1);

console.log('two-user admission + queued third + isolated idempotent fan-out PASSED');
