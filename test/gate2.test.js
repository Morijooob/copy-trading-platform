import assert from "node:assert/strict";
import { ExecutionEngine } from "../src/execution-engine.js";

function expectThrow(fn, message) {
  assert.throws(fn, message);
}

// A valid event sequence must advance monotonically through the full order lifecycle.
{
  const engine = new ExecutionEngine();
  const order = engine.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 2,
    clientOrderId: "g2-1",
    eventSequence: 1
  });

  engine.markSubmissionUnknown(order.id, "timeout", 2);
  engine.reconcileExchangeState(order.id, {
    found: true,
    exchangeOrderId: "ex-1",
    filledQty: 1
  }, 3);
  engine.onExchangeFill(order.id, 1, "fill-1", 4);

  const finalOrder = engine.onExchangeFill(order.id, 1, "fill-2", 5);
  assert.equal(finalOrder.status, "FILLED");
  assert.equal(finalOrder.lastEventSequence, 5);
}

// Replaying the same client order must remain idempotent when it carries the next sequence.
{
  const engine = new ExecutionEngine();
  const first = engine.createOrder({
    symbol: "ETHUSDT",
    side: "SELL",
    quantity: 3,
    timeoutMs: 1000,
    clientOrderId: "g2-idempotent",
    eventSequence: 1
  });
  const duplicate = engine.createOrder({
    symbol: "ETHUSDT",
    side: "SELL",
    quantity: 3,
    timeoutMs: 1000,
    clientOrderId: "g2-idempotent",
    eventSequence: 2
  });

  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.requestedQty, 3);
  assert.equal(engine.getAuditLog(first.id).at(-1).type, "DUPLICATE_ORDER");
}

// Old or invalid sequence numbers must never mutate order state.
{
  const engine = new ExecutionEngine();
  const order = engine.createOrder({
    symbol: "SOLUSDT",
    side: "BUY",
    quantity: 1,
    eventSequence: 10
  });

  expectThrow(() => engine.tick(order.id, 100, 10), /out-of-order event/);
  expectThrow(() => engine.tick(order.id, 100, 9), /out-of-order event/);
  expectThrow(() => engine.tick(order.id, 100, 0), /invalid event sequence/);

  const unchanged = engine.require(order.id);
  assert.equal(unchanged.elapsedMs, 0);
  assert.equal(unchanged.lastEventSequence, 10);
}

// Duplicate fills are idempotent and conflicting reuse of a fill id is rejected.
{
  const engine = new ExecutionEngine();
  const order = engine.createOrder({ symbol: "XRPUSDT", side: "BUY", quantity: 5, eventSequence: 1 });

  engine.onExchangeFill(order.id, 2, "fill-a", 2);
  const duplicate = engine.onExchangeFill(order.id, 2, "fill-a", 3);
  assert.equal(duplicate.filledQty, 2);
  assert.equal(duplicate.status, "PARTIAL");

  expectThrow(() => engine.onExchangeFill(order.id, 3, "fill-a", 4), /conflicting fill id/);
  assert.equal(engine.require(order.id).filledQty, 2);
}

console.log("Gate 2 tests passed: event ordering, idempotency, replay protection, and fill de-duplication.");
