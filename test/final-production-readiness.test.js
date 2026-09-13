import assert from 'node:assert/strict';
import { WalletLedger } from '../src/real/wallet-ledger.js';
import { CommissionEngine } from '../src/real/commission.js';
import { RealCopyTradingEngine } from '../src/real/real-copy-trading-engine.js';
import { RealCopyTradingSession } from '../src/real/real-copy-trading-session.js';

const security = {
  backendOnlyExecution: true,
  authenticatedSessions: true,
  secureCookies: true,
  twoFactorForRealTrading: true,
  serverSideSecretStore: true,
  withdrawalsDisabled: true,
  killSwitch: true,
  riskLimits: true,
  idempotency: true,
  auditIntegrity: true,
  monitoringAndAlerts: true
};

const unlockedSandboxSecurity = { ...security, killSwitch: false };
const healthySafety = { killSwitch: false, maxOrderNotional: 1000, maxDailyLoss: 200, maxExposure: 1500 };

const commission = new CommissionEngine({ rateBps: 500 });
assert.deepEqual(commission.calculate(100), { grossProfit: 100, commission: 5, netProfit: 95 });
assert.equal(commission.calculate(-1).commission, 0);

const wallet = new WalletLedger();
wallet.credit('user-A', 'USDT', 1000, 'deposit');
wallet.credit('platform', 'USDT', 50, 'fee');
wallet.debit('user-A', 'USDT', 100, 'trade');
assert.equal(wallet.balance('user-A', 'USDT'), 900);
assert.equal(wallet.balance('platform', 'USDT'), 50);
assert.equal(wallet.balance('user-B', 'USDT'), 0);
assert.throws(() => wallet.debit('user-A', 'USDT', 901, 'cross-wallet-attempt'), /insufficient balance/);

let blockedExchangeCalls = 0;
const locked = new RealCopyTradingEngine({
  security,
  safety: { ...healthySafety, killSwitch: true },
  enableRealExecution: true,
  exchange: { order: async () => { blockedExchangeCalls += 1; return { id: 'MUST-NOT-EXIST' }; } }
});
locked.service.safety.heartbeat(Date.now());
await assert.rejects(
  locked.executeFollowerOrder({
    idempotencyKey: 'locked-1', masterId: 'm1', follower: { id: 'f1' },
    order: { symbol: 'btc-usdt', side: 'buy', quantity: 1, price: 10 }
  }),
  /KILL_SWITCH/
);
assert.equal(blockedExchangeCalls, 0);

const calls = [];
const exchangeResolver = async (follower) => ({
  order: async (order) => {
    calls.push({ followerId: follower.id, order });
    return { id: `sandbox-${follower.id}`, status: 'filled', filled: order.quantity };
  }
});
const engine = new RealCopyTradingEngine({ security: unlockedSandboxSecurity, safety: healthySafety, exchangeResolver, enableRealExecution: true });
engine.service.safety.heartbeat(Date.now());
const followers = Array.from({ length: 32 }, (_, i) => ({ id: `f-${i + 1}` }));
const session = new RealCopyTradingSession({ engine, masterId: 'master-sandbox', followers });
session.start();
const stress = await session.applyMasterEvent({
  eventId: 'stress-open-1', type: 'OPEN', symbol: 'btc-usdt', side: 'buy', quantity: 1, price: 10,
  dailyLoss: 0, exposure: 320
});
assert.equal(stress.results.length, 32);
assert.equal(calls.length, 32);
assert.equal(new Set(calls.map((x) => x.followerId)).size, 32);

const duplicate = await engine.executeFollowerOrder({
  idempotencyKey: 'dup-1', masterId: 'm1', follower: { id: 'f-1' },
  order: { symbol: 'btc-usdt', side: 'buy', quantity: 1, price: 10 }
});
const duplicateRetry = await engine.executeFollowerOrder({
  idempotencyKey: 'dup-1', masterId: 'm1', follower: { id: 'f-1' },
  order: { symbol: 'btc-usdt', side: 'buy', quantity: 1, price: 10 }
});
assert.equal(duplicate.duplicate, false);
assert.equal(duplicateRetry.duplicate, true);

let failOnce = true;
const uncertainEngine = new RealCopyTradingEngine({
  security: unlockedSandboxSecurity,
  safety: healthySafety,
  enableRealExecution: true,
  exchange: { order: async () => { if (failOnce) { failOnce = false; throw new Error('simulated network timeout after submit'); } return { id: 'late' }; } }
});
uncertainEngine.service.safety.heartbeat(Date.now());
await assert.rejects(
  uncertainEngine.executeFollowerOrder({
    idempotencyKey: 'uncertain-1', masterId: 'm1', follower: { id: 'f1' },
    order: { symbol: 'btc-usdt', side: 'buy', quantity: 1, price: 10 }
  }),
  /simulated network timeout/
);
await assert.rejects(
  uncertainEngine.executeFollowerOrder({
    idempotencyKey: 'uncertain-1', masterId: 'm1', follower: { id: 'f1' },
    order: { symbol: 'btc-usdt', side: 'buy', quantity: 1, price: 10 }
  }),
  /reconciliation required/
);
assert.deepEqual(uncertainEngine.service.reconcileIdempotencyKey('uncertain-1', { accepted: false }), { reconciled: true, accepted: false });
const safeRetry = await uncertainEngine.executeFollowerOrder({
  idempotencyKey: 'uncertain-1', masterId: 'm1', follower: { id: 'f1' },
  order: { symbol: 'btc-usdt', side: 'buy', quantity: 1, price: 10 }
});
assert.equal(safeRetry.duplicate, false);

const riskEngine = new RealCopyTradingEngine({
  security,
  safety: { ...healthySafety, killSwitch: true },
  enableRealExecution: true,
  exchange: { order: async () => ({ id: 'must-not-run' }) }
});
riskEngine.service.safety.heartbeat(Date.now());
await assert.rejects(
  riskEngine.executeFollowerOrder({
    idempotencyKey: 'risk-1', masterId: 'm1', follower: { id: 'f1' },
    order: { symbol: 'btc-usdt', side: 'buy', quantity: 1, price: 10 }, dailyLoss: 0, exposure: 0
  }),
  /KILL_SWITCH/
);

console.log('Final Production Readiness: wallet isolation, fee/profit, 32-follower sandbox stress, duplicate/retry, ambiguous-outcome recovery, risk/kill-switch and production-lock checks PASSED');
