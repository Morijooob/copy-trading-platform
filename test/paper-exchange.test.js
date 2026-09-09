import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PaperExchange } from '../src/paper-exchange.js';

test('paper exchange submits idempotently', () => {
  const exchange = new PaperExchange();
  const order = { clientOrderId: 'copy:s1:a1', symbol: 'BTCUSDT', side: 'BUY', quantity: 2, type: 'MARKET' };
  const first = exchange.submitOrder(order);
  const second = exchange.submitOrder(order);
  assert.equal(first.exchangeOrderId, second.exchangeOrderId);
  assert.equal(second.status, 'OPEN');
  assert.throws(() => exchange.submitOrder({ ...order, quantity: 3 }), /conflicting clientOrderId/);
});

test('paper exchange supports partial then full fill', () => {
  const exchange = new PaperExchange();
  exchange.submitOrder({ clientOrderId: 'copy:s2:a1', quantity: 2, symbol: 'ETHUSDT', side: 'SELL' });
  const partial = exchange.fillOrder('copy:s2:a1', 0.5, 100);
  assert.equal(partial.status, 'PARTIALLY_FILLED');
  const full = exchange.fillOrder('copy:s2:a1', 1.5, 110);
  assert.equal(full.status, 'FILLED');
  assert.equal(full.filledQuantity, 2);
  assert.equal(full.averageFillPrice, 107.5);
  assert.throws(() => exchange.fillOrder('copy:s2:a1', 1, 120), /cannot|FILLED|/i);
});

test('paper exchange reconciles known and unknown orders', () => {
  const exchange = new PaperExchange();
  exchange.submitOrder({ clientOrderId: 'copy:s3:a1', quantity: 1 });
  assert.equal(exchange.reconcile('copy:s3:a1').confirmed, true);
  assert.equal(exchange.reconcile('missing').confirmed, false);
});
