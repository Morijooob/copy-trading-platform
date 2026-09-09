import assert from "node:assert/strict";
import { NetworkResilience } from "../src/network-resilience.js";

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

const order = { symbol: "BTCUSDT", side: "BUY", quantity: 1 };

test("transport failure fails closed as UNKNOWN", () => {
  const engine = new NetworkResilience({
    submit: () => { throw new Error("timeout"); },
    reconcile: () => ({ confirmed: false })
  });
  const result = engine.execute({ clientRequestId: "g4-timeout", order });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.attempts, 1);
});

test("positive reconciliation prevents duplicate submission", () => {
  let submits = 0;
  const engine = new NetworkResilience({
    submit: () => {
      submits++;
      throw new Error("response lost after acceptance");
    },
    reconcile: () => ({ confirmed: true, exchangeOrderId: "ex-g4" })
  });
  engine.execute({ clientRequestId: "g4-unknown", order });
  const result = engine.retry("g4-unknown");
  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.exchangeOrderId, "ex-g4");
  assert.equal(submits, 1);
});

test("conflicting idempotency key cannot change the order", () => {
  const engine = new NetworkResilience({
    submit: () => ({ accepted: true, exchangeOrderId: "ex-idem" }),
    reconcile: () => ({ confirmed: false })
  });
  engine.execute({ clientRequestId: "g4-idem", order });
  assert.throws(
    () => engine.execute({ clientRequestId: "g4-idem", order: { symbol: "ETHUSDT", side: "SELL", quantity: 2 } }),
    /conflicting order/
  );
});

test("confirmed reconciliation without exchange id fails closed", () => {
  const engine = new NetworkResilience({
    submit: () => { throw new Error("timeout"); },
    reconcile: () => ({ confirmed: true })
  });
  engine.execute({ clientRequestId: "g4-invalid-confirm", order });
  assert.throws(() => engine.retry("g4-invalid-confirm"), /missing exchange order id/);
  assert.equal(engine.get("g4-invalid-confirm").status, "UNKNOWN");
});

console.log(`\nGate 4 Test Runner: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
