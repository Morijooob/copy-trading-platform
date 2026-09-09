import test from 'node:test';
import assert from 'node:assert/strict';
import { PaperExchange } from '../src/paper-exchange.js';
import { PaperTradingApi } from '../src/paper-trading-api.js';
import { MultiAccountCopyExecution } from '../src/multi-account-copy-execution.js';
import { RiskEngine } from '../src/risk-engine.js';
import { ExecutionEngine } from '../src/execution-engine.js';

function makeAccount(accountId, maxExposure = 100000) {
  return {
    accountId,
    riskEngine: new RiskEngine({ maxExposure }),
    executionEngine: new ExecutionEngine({ accountId }),
    enabled: true,
  };
}

test('multi-account API stress: isolation, many orders, replay, partial/full fill', async () => {
  const exchange = new PaperExchange();
  const api = new PaperTradingApi({
    paperExchange: exchange,
    accounts: ['A', 'B', 'C'].map((accountId) => ({ accountId })),
  });

  const sessions = await Promise.all(['A', 'B', 'C'].map((accountId) => api.createSession({ accountId })));
  const tokens = Object.fromEntries(sessions.map((s) => [s.accountId, s.token]));

  const placed = [];
  for (const accountId of ['A', 'B', 'C']) {
    for (let i = 0; i < 40; i += 1) {
      placed.push(await api.placeOrder({
        token: tokens[accountId],
        symbol: i % 2 ? 'BTCUSDT' : 'ETHUSDT',
        side: i % 3 === 0 ? 'SELL' : 'BUY',
        quantity: 1 + i / 100,
        price: 100 + i,
        clientOrderId: `stress:${accountId}:${i}`,
      }));
    }
  }

  assert.equal(placed.length, 120);
  assert.equal((await api.listOrders({ token: tokens.A })).length, 40);
  assert.equal((await api.listOrders({ token: tokens.B })).length, 40);
  assert.equal((await api.listOrders({ token: tokens.C })).length, 40);

  await exchange.fillOrder('stress:A:0', 0.4, 100);
  await exchange.fillOrder('stress:A:0', 0.6, 110);
  await exchange.fillOrder('stress:B:0', 1.0, 120);

  const dashboardA = await api.dashboard({ token: tokens.A });
  const dashboardB = await api.dashboard({ token: tokens.B });
  assert.equal(dashboardA.orderCount, 40);
  assert.equal(dashboardB.orderCount, 40);
  assert.ok(dashboardA.filledNotional > 0);
  assert.ok(dashboardB.filledNotional > 0);

  await assert.rejects(() => api.getOrder({ token: tokens.A, clientOrderId: 'stress:B:0' }), /forbidden/i);
  await assert.rejects(() => api.getOrder({ token: tokens.B, clientOrderId: 'stress:A:0' }), /forbidden/i);
});

test('multi-account copy stress: 25 accounts × 20 signals with fill replay isolation', async () => {
  const exchange = new PaperExchange();
  const accounts = Array.from({ length: 25 }, (_, i) => makeAccount(`acct-${i}`));
  const copy = new MultiAccountCopyExecution({ accounts, exchangeAdapter: exchange });

  const results = [];
  for (let signal = 0; signal < 20; signal += 1) {
    for (let account = 0; account < accounts.length; account += 1) {
      const result = await copy.executeCopy({
        signalId: `stress-signal-${signal}`,
        symbol: signal % 2 ? 'BTCUSDT' : 'ETHUSDT',
        side: signal % 3 === 0 ? 'SELL' : 'BUY',
        quantity: 1,
        price: 100 + signal,
        timeoutMs: 1000,
      });
      results.push(result);
    }
  }

  assert.equal(results.length, 500);
  assert.equal(results.filter((r) => r.status === 'FILLED').length, 500);
  assert.equal(exchange.orders.size, 500);

  const first = results.find((r) => r.accountId === 'acct-0');
  const order = first.order;
  const firstFill = await copy.onExchangeFill('acct-0', order.id, 0.5, 100, 1, { fillId: 'stress-fill-1' });
  assert.equal(firstFill.duplicate, false);
  assert.equal(firstFill.remainingQuantity, 0.5);

  const duplicate = await copy.onExchangeFill('acct-0', order.id, 0.5, 100, 1, { fillId: 'stress-fill-1' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.remainingQuantity, 0.5);

  const finalFill = await copy.onExchangeFill('acct-0', order.id, 0.5, 100, 2, { fillId: 'stress-fill-2' });
  assert.equal(finalFill.remainingQuantity, 0);

  assert.equal(copy.getAccount('acct-1').riskEngine.getState().exposure, 2000);
  assert.equal(copy.getAccount('acct-0').riskEngine.getState().exposure, 2000);
});

test('kill-switch style account isolation: disabled account stops while others continue', async () => {
  const exchange = new PaperExchange();
  const accounts = [makeAccount('live'), makeAccount('stopped')];
  const copy = new MultiAccountCopyExecution({ accounts, exchangeAdapter: exchange });

  copy.setAccountEnabled('stopped', false);
  const stopped = await copy.executeCopy({ signalId: 'ks-1', symbol: 'BTCUSDT', side: 'BUY', quantity: 1, price: 100 });
  const live = await copy.executeCopy({ signalId: 'ks-1', symbol: 'BTCUSDT', side: 'BUY', quantity: 1, price: 100 });

  assert.equal(stopped.status, 'ACCOUNT_DISABLED');
  assert.equal(live.status, 'FILLED');
  assert.equal(exchange.orders.size, 1);
});
