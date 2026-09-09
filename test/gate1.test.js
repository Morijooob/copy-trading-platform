import assert from "node:assert/strict";
import { ExecutionEngine } from "../src/execution-engine.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${name}`);
    console.error(`      ${error.message}`);
  }
}

test("Crash: unfinished order becomes CRASHED and can recover", () => {
  const engine = new ExecutionEngine();
  const order = engine.createOrder({ symbol: "BTCUSDT", side: "BUY", quantity: 1 });
  assert.equal(engine.crash(order.id).status, "CRASHED");
  assert.equal(engine.recover(order.id).status, "PENDING");
  assert.equal(engine.recover(order.id).recovered, true);
});

test("Timeout: order times out exactly at timeout threshold and can recover", () => {
  const engine = new ExecutionEngine();
  const order = engine.createOrder({
    symbol: "ETHUSDT",
    side: "BUY",
    quantity: 2,
    timeoutMs: 5000
  });
  assert.equal(engine.tick(order.id, 4999).status, "PENDING");
  assert.equal(engine.tick(order.id, 1).status, "TIMED_OUT");
  assert.equal(engine.recover(order.id).status, "PENDING");
});

test("Partial Fill: filled quantity is preserved and status is PARTIAL", () => {
  const engine = new ExecutionEngine();
  const order = engine.createOrder({ symbol: "SOLUSDT", side: "SELL", quantity: 10 });
  const partial = engine.onExchangeFill(order.id, 4, "fill-1");
  assert.equal(partial.status, "PARTIAL");
  assert.equal(partial.filledQty, 4);
  const complete = engine.onExchangeFill(order.id, 6, "fill-2");
  assert.equal(complete.status, "FILLED");
  assert.equal(complete.filledQty, 10);
});

test("Recovery: timeout after partial fill preserves fill and resumes as PARTIAL", () => {
  const engine = new ExecutionEngine();
  const order = engine.createOrder({
    symbol: "XRPUSDT",
    side: "BUY",
    quantity: 10,
    timeoutMs: 1000
  });
  engine.onExchangeFill(order.id, 3, "fill-1");
  assert.equal(engine.tick(order.id, 1000).status, "TIMED_OUT");
  const recovered = engine.recover(order.id);
  assert.equal(recovered.status, "PARTIAL");
  assert.equal(recovered.filledQty, 3);
  assert.equal(recovered.recovered, true);
});

test("Idempotency: duplicate exchange fill ID must not double-fill", () => {
  const engine = new ExecutionEngine();
  const order = engine.createOrder({ symbol: "BTCUSDT", side: "BUY", quantity: 10 });
  assert.equal(engine.onExchangeFill(order.id, 4, "fill-42").filledQty, 4);
  assert.equal(engine.onExchangeFill(order.id, 4, "fill-42").filledQty, 4);
  assert.equal(engine.onExchangeFill(order.id, 6, "fill-43").status, "FILLED");
  assert.equal(engine.onExchangeFill(order.id, 6, "fill-43").filledQty, 10);
});

test("Late Fill: fill arriving after timeout is reconciled instead of discarded", () => {
  const engine = new ExecutionEngine();
  const order = engine.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 5,
    timeoutMs: 1000
  });
  assert.equal(engine.tick(order.id, 1000).status, "TIMED_OUT");
  assert.equal(engine.onExchangeFill(order.id, 5, "late-fill-1").status, "FILLED");
  assert.equal(engine.onExchangeFill(order.id, 5, "late-fill-1").filledQty, 5);
});

test("Late Partial Fill: partial fill after crash is preserved and recoverable", () => {
  const engine = new ExecutionEngine();
  const order = engine.createOrder({ symbol: "ETHUSDT", side: "SELL", quantity: 8 });
  assert.equal(engine.crash(order.id).status, "CRASHED");
  assert.equal(engine.onExchangeFill(order.id, 3, "late-fill-2").status, "PARTIAL");
  const recovered = engine.recover(order.id);
  assert.equal(recovered.status, "PARTIAL");
  assert.equal(recovered.filledQty, 3);
});

test("Duplicate Order: same clientOrderId returns the original order", () => {
  const engine = new ExecutionEngine();
  const first = engine.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 2,
    clientOrderId: "client-100"
  });
  const duplicate = engine.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 2,
    clientOrderId: "client-100"
  });
  assert.equal(duplicate.id, first.id);
});

test("Conflicting Duplicate Order: same clientOrderId with different payload is rejected", () => {
  const engine = new ExecutionEngine();
  engine.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 2,
    clientOrderId: "client-200"
  });
  assert.throws(() => engine.createOrder({
    symbol: "BTCUSDT",
    side: "SELL",
    quantity: 2,
    clientOrderId: "client-200"
  }), /conflicting client order id/);
});

test("Conflicting Fill: same fill ID with different quantity is rejected", () => {
  const engine = new ExecutionEngine();
  const order = engine.createOrder({ symbol: "SOLUSDT", side: "BUY", quantity: 10 });
  engine.onExchangeFill(order.id, 4, "fill-conflict");
  assert.throws(() => engine.onExchangeFill(order.id, 5, "fill-conflict"), /conflicting fill id/);
});

test("Audit Log: records deterministic order lifecycle events", () => {
  const engine = new ExecutionEngine();
  const order = engine.createOrder({
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 2,
    clientOrderId: "audit-1",
    eventSequence: 1
  });
  engine.onExchangeFill(order.id, 1, "fill-a", 2);
  engine.tick(order.id, 100, 3);
  const log = engine.getAuditLog(order.id);

  assert.deepEqual(log.map((event) => event.type), ["ORDER_CREATED", "EXCHANGE_FILL", "TICK"]);
  assert.deepEqual(log.map((event) => event.eventSequence), [1, 2, 3]);
  assert.deepEqual(log.map((event) => event.eventId), ["1", "2", "3"]);
  assert.equal(log[1].payload.fillId, "fill-a");
  assert.equal(log[1].payload.quantity, 1);
});

test("Event Ordering: out-of-order event is rejected without changing state", () => {
  const engine = new ExecutionEngine();
  const order = engine.createOrder({ symbol: "ETHUSDT", side: "BUY", quantity: 5, eventSequence: 10 });
  engine.onExchangeFill(order.id, 2, "fill-ordered", 20);
  assert.throws(() => engine.tick(order.id, 100, 19), /out-of-order event/);

  const current = engine.require(order.id);
  assert.equal(current.filledQty, 2);
  assert.equal(current.elapsedMs, 0);
  assert.equal(current.lastEventSequence, 20);
  assert.equal(engine.getAuditLog(order.id).length, 2);
});

test("Event Ordering: duplicate sequence is rejected", () => {
  const engine = new ExecutionEngine();
  const order = engine.createOrder({ symbol: "SOLUSDT", side: "SELL", quantity: 3, eventSequence: 1 });
  assert.throws(() => engine.onExchangeFill(order.id, 1, "fill-1", 1), /out-of-order event/);
});

test("Event Sequence Validation: zero, negative, and fractional sequences are rejected", () => {
  const engine = new ExecutionEngine();
  assert.throws(() => engine.createOrder({ symbol: "BTCUSDT", side: "BUY", quantity: 1, eventSequence: 0 }), /invalid event sequence/);
  assert.throws(() => engine.createOrder({ symbol: "BTCUSDT", side: "BUY", quantity: 1, eventSequence: -1 }), /invalid event sequence/);
  assert.throws(() => engine.createOrder({ symbol: "BTCUSDT", side: "BUY", quantity: 1, eventSequence: 1.5 }), /invalid event sequence/);
});

test("Validation: invalid fills, elapsed time, timeout, and client order ID are rejected", () => {
  const engine = new ExecutionEngine();
  const order = engine.createOrder({ symbol: "ETHUSDT", side: "BUY", quantity: 1 });
  assert.throws(() => engine.onExchangeFill(order.id, -1, "bad-fill"), /invalid fill/);
  assert.throws(() => engine.onExchangeFill(order.id, 0, "bad-fill"), /invalid fill/);
  assert.throws(() => engine.tick(order.id, -1), /invalid elapsed time/);
  assert.throws(() => engine.createOrder({ symbol: "ETHUSDT", side: "BUY", quantity: 1, timeoutMs: 0 }), /invalid timeout/);
  assert.throws(() => engine.createOrder({ symbol: "ETHUSDT", side: "BUY", quantity: 1, clientOrderId: 123 }), /invalid client order id/);
});

console.log(`\nGate 1 Test Runner: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
