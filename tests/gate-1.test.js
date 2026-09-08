import test from 'node:test';
import assert from 'node:assert/strict';
import { VirtualExchange } from '../src/simulator/virtual-exchange.js';
import { Ledger } from '../src/domain/ledger.js';
import { assertTransition } from '../src/domain/order-state.js';

const order = () => ({
  clientOrderId: 'COPY-GATE1-000001',
  symbol: 'ETHUSDT',
  side: 'BUY',
  quantity: 0.011
});

test('T01 Partial Fill: tracks filled and remaining quantity', () => {
  const exchange = new VirtualExchange();
  const o = order();
  exchange.submit({ ...o });
  const state = exchange.applyFills(o.clientOrderId, [
    { quantity: 0.007, price: 3425 },
  ]);
  assert.equal(state.status, 'PARTIALLY_FILLED');
  assert.equal(state.filledQuantity, 0.007);
  assert.ok(Math.abs(o.quantity - state.filledQuantity - 0.004) < 1e-12);
});

test('T02 Timeout: moves local order to UNKNOWN without creating a retry', () => {
  const exchange = new VirtualExchange();
  const o = order();
  exchange.submit({ ...o });
  assertTransition('SENT', 'UNKNOWN');
  const before = exchange.reconcile(o.clientOrderId);
  assert.equal(before.orderId, 'VEX-000001');
  assert.equal(before.filledQuantity, 0);
});

test('T03 Timeout + Fill: reconciliation discovers fill after timeout', () => {
  const exchange = new VirtualExchange();
  const o = order();
  exchange.submit({ ...o });
  exchange.applyFills(o.clientOrderId, [{ quantity: 0.007, price: 3425 }]);
  const reconciled = exchange.reconcile(o.clientOrderId);
  assert.equal(reconciled.status, 'PARTIALLY_FILLED');
  assert.equal(reconciled.filledQuantity, 0.007);
});

test('T04 Crash Recovery: restart reconciles existing order without duplicate', () => {
  const exchange = new VirtualExchange();
  const o = order();
  const first = exchange.submit({ ...o });
  exchange.applyFills(o.clientOrderId, [{ quantity: 0.007, price: 3425 }]);

  // Simulated process restart: exchange remains authoritative.
  const recovered = exchange.reconcile(o.clientOrderId);
  assert.equal(recovered.orderId, first.orderId);
  assert.equal(recovered.filledQuantity, 0.007);

  const retry = exchange.submit({ ...o });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.orderId, first.orderId);
});

test('T05 Ledger: partial fill updates position and available balance exactly once', () => {
  const ledger = new Ledger(1000);
  ledger.applyFill({ symbol: 'ETHUSDT', side: 'BUY', quantity: 0.007, price: 3425, fee: 0 });
  assert.equal(ledger.position('ETHUSDT'), 0.007);
  assert.equal(ledger.availableBalance, 1000 - 0.007 * 3425);
});

test('T06 Ledger: duplicate fill is not silently accepted as a second exchange order', () => {
  const exchange = new VirtualExchange();
  const o = order();
  exchange.submit({ ...o });
  const first = exchange.applyFills(o.clientOrderId, [{ quantity: 0.007, price: 3425 }]);
  const second = exchange.submit({ ...o });
  assert.equal(second.duplicate, true);
  assert.equal(second.orderId, 'VEX-000001');
  assert.equal(second.filledQuantity, first.filledQuantity);
});
