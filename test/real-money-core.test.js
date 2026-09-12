import assert from 'node:assert/strict';
import { CommissionEngine } from '../src/real/commission.js';
import { WalletLedger } from '../src/real/wallet-ledger.js';
import { RealTradingService } from '../src/real/real-trading-service.js';

const c = new CommissionEngine({ rateBps: 500 });
assert.deepEqual(c.calculate(100), { grossProfit: 100, commission: 5, netProfit: 95 });
assert.deepEqual(c.calculate(-10), { grossProfit: 0, commission: 0, netProfit: 0 });

const ledger = new WalletLedger();
ledger.credit('u1', 'USDT', 1000, 'deposit');
assert.equal(ledger.balance('u1', 'USDT'), 1000);
const settlement = ledger.recordProfit('u1', 'USDT', 100, 5, 'trade-1');
assert.deepEqual(settlement, { grossProfit: 100, commission: 5, netProfit: 95, balance: 1095 });
assert.equal(ledger.balance('u1', 'USDT'), 1095);
assert.throws(() => ledger.debit('u1', 'USDT', 5000, 'bad'), /insufficient balance/);

const blocked = new RealTradingService({ exchange: { order: async () => ({ id: 'x' }) } });
assert.equal(blocked.state().readyForRealMoney, false);
await assert.rejects(() => blocked.copyMasterOrder({ idempotencyKey: 'x', follower: { id: 'u1' }, order: { symbol: 'btc-usdt', side: 'buy', quantity: 1, price: 100 } }), /real-money trading blocked/);

let calls = 0;
const ready = new RealTradingService({
  security: {
    backendOnlyExecution: true, authenticatedSessions: true, secureCookies: true,
    twoFactorForRealTrading: true, serverSideSecretStore: true, withdrawalsDisabled: true,
    killSwitch: true, riskLimits: true, idempotency: true, auditIntegrity: true, monitoringAndAlerts: true
  },
  enableRealExecution: true,
  exchange: { order: async (order) => { calls++; return { id: 'ok', ...order }; } }
});
const order = { symbol: 'btc-usdt', side: 'buy', quantity: 1, price: 100 };

// Fail-closed monitoring is mandatory: explicitly prove that stale/uninitialized
// monitoring blocks execution, then provide a fresh heartbeat for the happy path.
await assert.rejects(
  () => ready.copyMasterOrder({ idempotencyKey: 'stale', follower: { id: 'u1' }, order }),
  /execution blocked: MONITORING_HEARTBEAT_STALE/
);
assert.equal(calls, 0);
ready.safety.heartbeat(Date.now());

const first = await ready.copyMasterOrder({ idempotencyKey: 'same', follower: { id: 'u1' }, order });
assert.equal(first.exchangeOrder.id, 'ok');
assert.equal(calls, 1);
const duplicate = await ready.copyMasterOrder({ idempotencyKey: 'same', follower: { id: 'u1' }, order });
assert.equal(duplicate.duplicate, true);
assert.equal(calls, 1);

const safetyBlocked = new RealTradingService({
  security: {
    backendOnlyExecution: true, authenticatedSessions: true, secureCookies: true,
    twoFactorForRealTrading: true, serverSideSecretStore: true, withdrawalsDisabled: true,
    killSwitch: true, riskLimits: true, idempotency: true, auditIntegrity: true, monitoringAndAlerts: true
  },
  enableRealExecution: true,
  safety: { killSwitch: true },
  exchange: { order: async () => ({ id: 'must-not-run' }) }
});
// Establish healthy monitoring first so this assertion specifically verifies
// that the kill switch, not the monitoring guard, is the blocking condition.
safetyBlocked.safety.heartbeat(Date.now());
await assert.rejects(() => safetyBlocked.copyMasterOrder({ idempotencyKey: 'blocked', follower: { id: 'u1' }, order }), /execution blocked: KILL_SWITCH/);

console.log('REAL MONEY CORE: ALL TESTS PASSED');
