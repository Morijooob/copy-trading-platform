import assert from 'node:assert/strict';
import { RealUserPreflight } from '../src/real/real-user-preflight.js';

const securityGate = { evaluate: () => ({ readyForRealMoney: false, failedControls: ['twoFactorForRealTrading'] }) };
const account = { state: 'verified', available: 42, currency: 'USDT', withdrawPermission: false };
const market = {
  candleTime: 1700000000000,
  price: 100,
  source: 'test-feed',
  closes: Array.from({ length: 60 }, (_, i) => 100 + i * 0.2),
  volumes: Array.from({ length: 60 }, () => 10),
};

const run = async () => {
  const preflight = new RealUserPreflight({
    securityGate,
    userId: 'user-1',
    accountId: 'account-1',
    exchangeClient: { getAccount: async () => account },
    marketFeed: { fetch: async () => market },
  });
  const result = await preflight.run({ symbol: 'BTCUSDT' });
  assert.equal(result.readyForMoney, undefined);
  assert.equal(result.readyForRealMoney, false);
  assert.equal(result.readyForOrder, false);
  assert.equal(result.orderPlaced, false);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.balance, { available: 42, currency: 'USDT' });
  assert.ok(result.failures.includes('security:twoFactorForRealTrading'));
  assert.equal(result.checks.exchange.readOnly, true);
  assert.equal(result.checks.strategy.dryRun, true);

  const bad = new RealUserPreflight({
    securityGate: { evaluate: () => ({ readyForRealMoney: true, failedControls: [] }) },
    userId: 'user-1',
    accountId: 'account-1',
    exchangeClient: { getAccount: async () => ({ ...account, state: 'pending' }) },
    marketFeed: { fetch: async () => market },
  });
  const badResult = await bad.run();
  assert.equal(badResult.readyForRealMoney, false);
  assert.ok(badResult.failures.includes('exchange:account_not_verified'));
  assert.equal(badResult.orderPlaced, false);

  console.log('real-user-preflight tests passed');
};

await run();
