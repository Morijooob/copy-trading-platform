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

function order() {
  return { symbol: "BTCUSDT", side: "BUY", quantity: 1 };
}

test("Network Failure: transport error produces UNKNOWN outcome", () => {
  const engine = new NetworkResilience({
    submit: () => { throw new Error("network disconnected"); },
    reconcile: () => ({ confirmed: false })
  });
  const result = engine.execute({ clientRequestId: "net-1", order: order() });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.attempts, 1);
  assert.equal(result.lastError, "network disconnected");
});

test("Unknown Outcome: reconciliation finds an exchange-accepted order before retry", () => {
  let submitCalls = 0;
  let reconcileCalls = 0;
  const engine = new NetworkResilience({
    submit: () => {
      submitCalls++;
      throw new Error("response lost after acceptance");
    },
    reconcile: () => {
      reconcileCalls++;
      return { confirmed: true, exchangeOrderId: "ex-100" };
    }
  });

  engine.execute({ clientRequestId: "unknown-1", order: order() });
  const result = engine.retry("unknown-1");
  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.exchangeOrderId, "ex-100");
  assert.equal(result.attempts, 1);
  assert.equal(submitCalls, 1);
  assert.equal(reconcileCalls, 1);
});

test("Retry: reconciliation proves no execution and retry succeeds once", () => {
  let submitCalls = 0;
  let reconcileCalls = 0;
  const engine = new NetworkResilience({
    submit: () => {
      submitCalls++;
      if (submitCalls === 1) throw new Error("timeout");
      return { accepted: true, exchangeOrderId: "ex-200" };
    },
    reconcile: () => {
      reconcileCalls++;
      return { confirmed: false };
    }
  });

  engine.execute({ clientRequestId: "retry-1", order: order() });
  const result = engine.retry("retry-1");
  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.exchangeOrderId, "ex-200");
  assert.equal(result.attempts, 2);
  assert.equal(submitCalls, 2);
  assert.equal(reconcileCalls, 1);
});

test("Duplicate Request: same client request never submits twice after confirmation", () => {
  let submitCalls = 0;
  const engine = new NetworkResilience({
    submit: () => {
      submitCalls++;
      return { accepted: true, exchangeOrderId: "ex-300" };
    },
    reconcile: () => ({ confirmed: false })
  });

  const first = engine.execute({ clientRequestId: "dup-1", order: order() });
  const duplicate = engine.execute({ clientRequestId: "dup-1", order: order() });
  assert.equal(first.id, duplicate.id);
  assert.equal(duplicate.status, "CONFIRMED");
  assert.equal(submitCalls, 1);
});

test("Duplicate Request: retry after unknown outcome is blocked by positive reconciliation", () => {
  let submitCalls = 0;
  const engine = new NetworkResilience({
    submit: () => {
      submitCalls++;
      throw new Error("timeout");
    },
    reconcile: () => ({ confirmed: true, exchangeOrderId: "ex-400" })
  });

  engine.execute({ clientRequestId: "dup-2", order: order() });
  const firstRetry = engine.retry("dup-2");
  const secondRetry = engine.retry("dup-2");
  assert.equal(firstRetry.status, "CONFIRMED");
  assert.equal(secondRetry.status, "CONFIRMED");
  assert.equal(submitCalls, 1);
});

test("Idempotency Safety: same client request id with different order is rejected", () => {
  let submitCalls = 0;
  const engine = new NetworkResilience({
    submit: () => {
      submitCalls++;
      return { accepted: true, exchangeOrderId: "ex-500" };
    },
    reconcile: () => ({ confirmed: false })
  });

  engine.execute({ clientRequestId: "conflict-1", order: order() });
  assert.throws(
    () => engine.execute({ clientRequestId: "conflict-1", order: { symbol: "ETHUSDT", side: "SELL", quantity: 2 } }),
    /conflicting order for existing client request id/
  );
  assert.equal(submitCalls, 1);
});

test("Reconciliation Safety: confirmed result must include exchange order id", () => {
  const engine = new NetworkResilience({
    submit: () => { throw new Error("timeout"); },
    reconcile: () => ({ confirmed: true })
  });

  engine.execute({ clientRequestId: "missing-ex-id", order: order() });
  assert.throws(() => engine.retry("missing-ex-id"), /confirmed reconciliation missing exchange order id/);
  assert.equal(engine.get("missing-ex-id").status, "UNKNOWN");
});

test("Validation: malformed requests and reconciliation responses are rejected", () => {
  assert.throws(() => new NetworkResilience({ submit: null, reconcile: () => ({ confirmed: false }) }), /invalid network handlers/);

  const invalid = new NetworkResilience({
    submit: () => { throw new Error("timeout"); },
    reconcile: () => ({ confirmed: "yes" })
  });
  assert.throws(() => invalid.execute({ clientRequestId: "", order: order() }), /invalid client request id/);
  assert.throws(() => invalid.execute({ clientRequestId: "bad-order", order: { symbol: "BTCUSDT", side: "BUY", quantity: 0 } }), /invalid order/);
  invalid.execute({ clientRequestId: "bad-reconcile", order: order() });
  assert.throws(() => invalid.retry("bad-reconcile"), /invalid reconciliation response/);
});

console.log(`\nNetwork Resilience Test Runner: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
