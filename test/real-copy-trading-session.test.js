import assert from 'node:assert/strict';
import { RealCopyTradingEngine } from '../src/real/real-copy-trading-engine.js';
import { RealCopyTradingSession } from '../src/real/real-copy-trading-session.js';

const security = Object.fromEntries([
  'backendOnlyExecution', 'authenticatedSessions', 'secureCookies',
  'twoFactorForRealTrading', 'serverSideSecretStore', 'withdrawalsDisabled',
  'killSwitch', 'riskLimits', 'idempotency', 'auditIntegrity', 'monitoringAndAlerts'
].map((key) => [key, true]));
const safety = { maxOrderNotional: 1000, maxDailyLoss: 100, maxExposure: 2000, monitoringHeartbeatMaxAgeMs: 60000 };
const calls = [];
const resolver = async (follower) => ({
  async order(order) {
    calls.push({ followerId: follower.id, order: { ...order } });
    return { order_id: `${follower.id}-${calls.length}`, status: 'filled', filled_quantity: order.quantity, remaining_quantity: 0 };
  }
});

const engine = new RealCopyTradingEngine({ security, safety, enableRealExecution: true, exchangeResolver: resolver });
engine.service.safety.heartbeat(Date.now());
const session = new RealCopyTradingSession({
  engine,
  masterId: 'master-1',
  followers: [{ id: 'f1' }, { id: 'f2' }]
});

assert.equal(session.start().type, 'START');
await session.applyMasterEvent({ eventId: 'e1', type: 'OPEN', symbol: 'ETHUSDT', side: 'LONG', quantity: 0.01, price: 2500 });
assert.equal(calls.length, 2);
assert.equal(calls[0].order.side, 'buy');
assert.equal(calls[1].order.side, 'buy');
assert.equal(session.state().positions['f1:ETHUSDT'].side, 'buy');
assert.equal(session.state().positions['f1:ETHUSDT'].quantity, 0.01);
assert.equal(session.state().positions['f2:ETHUSDT'].quantity, 0.01);

const hold = await session.applyMasterEvent({ eventId: 'e2', type: 'HOLD', symbol: 'ETHUSDT', price: 2510 });
assert.equal(hold.type, 'HOLD');
assert.equal(calls.length, 2);

await session.applyMasterEvent({ eventId: 'e3', type: 'CLOSE', symbol: 'ETHUSDT', price: 2544 });
assert.equal(calls.length, 4);
assert.equal(calls[2].order.side, 'sell');
assert.equal(calls[3].order.side, 'sell');
assert.equal(session.state().positions['f1:ETHUSDT'], undefined);
assert.equal(session.state().positions['f2:ETHUSDT'], undefined);

// Same master event must not produce a second exchange call for either follower.
await session.applyMasterEvent({ eventId: 'e3', type: 'CLOSE', symbol: 'ETHUSDT', price: 2544 });
assert.equal(calls.length, 4);

// SHORT must normalize to the engine's canonical sell side.
await session.applyMasterEvent({ eventId: 'e4', type: 'OPEN', symbol: 'BTCUSDT', side: 'SHORT', quantity: 0.01, price: 60000 });
assert.equal(calls.length, 6);
assert.equal(calls[4].order.side, 'sell');
assert.equal(calls[5].order.side, 'sell');
assert.equal(session.state().positions['f1:BTCUSDT'].side, 'sell');

await assert.rejects(
  session.applyMasterEvent({ eventId: 'e5', type: 'OPEN', symbol: 'BTCUSDT', side: 'SIDEWAYS', quantity: 0.01, price: 60000 }),
  /invalid master side/
);

session.stop();
await assert.rejects(
  session.applyMasterEvent({ eventId: 'e6', type: 'OPEN', symbol: 'ETHUSDT', side: 'BUY', quantity: 0.01, price: 2500 }),
  /session is stopped/
);

console.log('real copy-trading session demo parity: ok');
