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
  const partial = engine.onExchangeFill(order.id, 4);
  assert.equal(partial.status, "PARTIAL");
  assert.equal(partial.filledQty, 4);
  const complete = engine.onExchangeFill(order.id, 6);
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
  engine.onExchangeFill(order.id, 3);
  assert.equal(engine.tick(order.id, 1000).status, "TIMED_OUT");
  const recovered = engine.recover(order.id);
  assert.equal(recovered.status, "PARTIAL");
  assert.equal(recovered.filledQty, 3);
  assert.equal(recovered.recovered, true);
});

console.log(`\nGate 1 Test Runner: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
