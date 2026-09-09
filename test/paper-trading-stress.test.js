import test from 'node:test';
import assert from 'node:assert/strict';
import { PaperExchange } from '../src/paper-exchange.js';
import { PaperTradingApi } from '../src/paper-trading-api.js';
import { MultiAccountCopyExecution } from '../src/multi-account-copy-execution.js';
import { RiskEngine } from '../src/risk-engine.js';
import { ExecutionEngine } from '../src/execution-engine.js';

function makeAccount(accountId, maxExposure = 100000, maxOrderNotional = 100000, maxDailyLoss = 100000) {
  return { accountId, riskEngine: new RiskEngine({ maxOrderNotional, maxDailyLoss, maxExposure }), executionEngine: new ExecutionEngine({ accountId }), enabled: true };
}

test('multi-account API stress: isolation, many orders, replay, partial/full fill', async () => {
  const exchange = new PaperExchange();
  const api = new PaperTradingApi({ paperExchange: exchange, accounts: ['A', 'B', 'C'].map((accountId) => ({ accountId })) });
  const sessions = await Promise.all(['A', 'B', 'C'].map((accountId) => api.createSession({ accountId })));
  const tokens = Object.fromEntries(sessions.map((s) => [s.accountId, s.token]));
  const placed = [];
  for (const accountId of ['A', 'B', 'C']) for (let i = 0; i < 40; i += 1) placed.push(await api.placeOrder({ token: tokens[accountId], symbol: i % 2 ? 'BTCUSDT' : 'ETHUSDT', side: i % 3 === 0 ? 'SELL' : 'BUY', quantity: 1 + i / 100, price: 100 + i, clientOrderId: `stress:${accountId}:${i}` }));
  assert.equal(placed.length, 120);
  assert.equal((await api.listOrders({ token: tokens.A })).length, 40);
  assert.equal((await api.listOrders({ token: tokens.B })).length, 40);
  assert.equal((await api.listOrders({ token: tokens.C })).length, 40);
  await exchange.fillOrder('stress:A:0', 0.4, 100);
  await exchange.fillOrder('stress:A:0', 0.6, 110);
  await exchange.fillOrder('stress:B:0', 1.0, 120);
  assert.equal((await api.dashboard({ token: tokens.A })).orderCount, 40);
  assert.equal((await api.dashboard({ token: tokens.B })).orderCount, 40);
  assert.ok((await api.dashboard({ token: tokens.A })).filledNotional > 0);
  assert.ok((await api.dashboard({ token: tokens.B })).filledNotional > 0);
  assert.throws(() => api.getOrder({ token: tokens.A, clientOrderId: 'stress:B:0' }), /order not found|forbidden/i);
  assert.throws(() => api.getOrder({ token: tokens.B, clientOrderId: 'stress:A:0' }), /order not found|forbidden/i);
});

test('multi-account copy stress: 25 accounts × 20 signals with fill replay isolation', async () => {
  const exchange = new PaperExchange();
  const accounts = Array.from({ length: 25 }, (_, i) => makeAccount(`acct-${i}`));
  const copy = new MultiAccountCopyExecution({ accounts, exchangeAdapter: exchange });
  const summaries = [];
  for (let signal = 0; signal < 20; signal += 1) summaries.push(copy.executeCopy({ signalId: `stress-signal-${signal}`, symbol: signal % 2 ? 'BTCUSDT' : 'ETHUSDT', side: signal % 3 === 0 ? 'SELL' : 'BUY', quantity: 1, price: 100 + signal, timeoutMs: 1000 }));
  assert.equal(summaries.length, 20);
  assert.equal(summaries.reduce((total, summary) => total + summary.submitted, 0), 500);
  const results = summaries.flatMap((s) => s.results);
  assert.equal(results.length, 500);
  assert.equal(results.filter((r) => r.status === 'SUBMITTED').length, 500);
  assert.equal(exchange.orders.size, 500);

  const first = results.find((r) => r.accountId === 'acct-0' && r.order.clientOrderId === 'copy:stress-signal-0:acct-0');
  assert.ok(first);
  const order = first.order;
  const fill1 = exchange.fillOrder(order.clientOrderId, 0.5, 100);
  assert.equal(fill1.status, 'PARTIALLY_FILLED');
  const firstFill = copy.onExchangeFill('acct-0', order.id, 0.5, 100, 1, { fillId: 'stress-fill-1' });
  assert.equal(firstFill.filledQty, 0.5);
  assert.equal(firstFill.remainingQuantity, 0.5);
  assert.equal(copy.accounts.get('acct-0').riskEngine.exposure, 50);
  assert.equal(copy.accounts.get('acct-1').riskEngine.exposure, 0);

  const duplicate = copy.onExchangeFill('acct-0', order.id, 0.5, 100, 1, { fillId: 'stress-fill-1' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(copy.accounts.get('acct-0').riskEngine.exposure, 50);
  assert.equal(copy.accounts.get('acct-0').riskEngine.reservedExposure, 50);

  const fill2 = exchange.fillOrder(order.clientOrderId, 0.5, 100);
  assert.equal(fill2.status, 'FILLED');
  const finalFill = copy.onExchangeFill('acct-0', order.id, 0.5, 100, 2, { fillId: 'stress-fill-2' });
  assert.equal(finalFill.filledQty, 1);
  assert.equal(copy.accounts.get('acct-0').riskEngine.exposure, 100);
  assert.equal(copy.accounts.get('acct-0').riskEngine.reservedExposure, 0);
  assert.equal(copy.accounts.get('acct-1').riskEngine.exposure, 0);

  const replaySummary = copy.executeCopy({ signalId: 'stress-signal-0', symbol: 'ETHUSDT', side: 'SELL', quantity: 1, price: 100, timeoutMs: 1000 });
  assert.equal(replaySummary.idempotent, 25);
  assert.equal(exchange.orders.size, 500);
});

test('kill-switch style account isolation: disabled account stops while others continue', async () => {
  const exchange = new PaperExchange();
  const accounts = [makeAccount('live'), makeAccount('stopped')];
  const copy = new MultiAccountCopyExecution({ accounts, exchangeAdapter: exchange });
  copy.setAccountEnabled('stopped', false);
  const summary = copy.executeCopy({ signalId: 'ks-1', symbol: 'BTCUSDT', side: 'BUY', quantity: 1, price: 100 });
  const stopped = summary.results.find((r) => r.accountId === 'stopped');
  const live = summary.results.find((r) => r.accountId === 'live');
  assert.equal(stopped.status, 'SKIPPED');
  assert.equal(stopped.reason, 'ACCOUNT_DISABLED');
  assert.equal(live.status, 'SUBMITTED');
  assert.equal(exchange.orders.size, 1);
});
