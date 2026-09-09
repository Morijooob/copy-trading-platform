const test = require('node:test');
const assert = require('node:assert/strict');
const { PaperExchange } = require('../src/paper-exchange');
const { PaperTradingApi } = require('../src/paper-trading-api');

test('paper trading API authenticates and isolates account orders', async () => {
  const exchange = new PaperExchange();
  const api = new PaperTradingApi({ paperExchange: exchange, accounts: [{ accountId: 'acct-1' }, { accountId: 'acct-2' }] });
  const a = api.createSession({ accountId: 'acct-1' });
  const b = api.createSession({ accountId: 'acct-2' });
  const order = await api.placeOrder({ token: a.token, symbol: 'BTCUSDT', side: 'BUY', quantity: 2, price: 100, clientOrderId: 'ui-1' });
  assert.equal(order.accountId, 'acct-1');
  assert.equal(api.listOrders({ token: a.token }).length, 1);
  assert.equal(api.listOrders({ token: b.token }).length, 0);
  assert.throws(() => api.getOrder({ token: b.token, clientOrderId: 'ui-1' }), /order not found/);
});

test('paper trading API dashboard reflects fills and rejects bad sessions/orders', async () => {
  const exchange = new PaperExchange();
  const api = new PaperTradingApi({ paperExchange: exchange, accounts: [{ accountId: 'acct-1' }] });
  const session = api.createSession({ accountId: 'acct-1' });
  assert.throws(() => api.dashboard({ token: 'bad' }), /unauthorized/);
  await api.placeOrder({ token: session.token, symbol: 'ETHUSDT', side: 'SELL', quantity: 3, price: 200, clientOrderId: 'ui-2' });
  exchange.fillOrder('ui-2', 1, 190);
  const dashboard = api.dashboard({ token: session.token });
  assert.equal(dashboard.mode, 'PAPER');
  assert.equal(dashboard.orderCount, 1);
  assert.equal(dashboard.filledNotional, 190);
  assert.equal(dashboard.orders[0].status, 'PARTIALLY_FILLED');
  assert.throws(() => api.placeOrder({ token: session.token, symbol: 'BTCUSDT', side: 'BAD', quantity: 1, price: 1 }), /invalid order/);
});