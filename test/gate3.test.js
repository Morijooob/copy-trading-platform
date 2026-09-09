import assert from "node:assert/strict";
import { ExecutionEngine } from "../src/execution-engine.js";
import { PersistenceStore } from "../src/persistence-store.js";
import { PersistentNetworkResilience } from "../src/persistent-network-resilience.js";
import { NetworkPersistenceStore } from "../src/network-persistence-store.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(`      ${error.message}`);
  }
}

test("Execution state survives restart with IDs and audit sequence intact", () => {
  const store = new PersistenceStore();
  const first = new ExecutionEngine({ persistence: store });
  const order = first.createOrder({ symbol: "BTCUSDT", side: "BUY", quantity: 2, clientOrderId: "restart-gate3", eventSequence: 1 });
  first.onExchangeFill(order.id, 1, "fill-1", 2);

  const persisted = store.load();
  const restarted = new ExecutionEngine({ persistence: store, state: persisted });
  const recovered = restarted.require(order.id);

  assert.equal(recovered.filledQty, 1);
  assert.equal(recovered.status, "PARTIAL");
  assert.equal(recovered.lastEventSequence, 2);
  assert.deepEqual(restarted.getAuditLog(order.id).map((e) => e.eventId), ["1", "2"]);

  const next = restarted.createOrder({ symbol: "ETHUSDT", side: "SELL", quantity: 1, eventSequence: 3 });
  assert.equal(next.id, "2");
  assert.equal(restarted.getAuditLog(next.id)[0].eventId, "3");
});

test("Corrupt persistence envelope is rejected before execution starts", () => {
  const valid = new PersistenceStore().load();
  assert.throws(() => new PersistenceStore({ ...valid, nextEventId: 0 }), /invalid persisted next event id/);
  assert.throws(() => new PersistenceStore({ ...valid, orders: {} }), /invalid persisted collections/);
  assert.throws(() => new PersistenceStore({ ...valid, version: 2 }), /unsupported persistence version/);
});

test("Persistent network recovery reconciles without resubmitting an ambiguous request", () => {
  const store = new NetworkPersistenceStore();
  let submits = 0;
  const first = new PersistentNetworkResilience({
    store,
    submit: () => { submits += 1; throw new Error("response lost"); },
    reconcile: () => ({ confirmed: false })
  });
  first.execute({ clientRequestId: "gate3-ambiguous", order: { symbol: "ETHUSDT", side: "BUY", quantity: 1 } });
  assert.equal(submits, 1);

  let reconciles = 0;
  const restarted = new PersistentNetworkResilience({
    store,
    submit: () => { submits += 1; return { accepted: true, exchangeOrderId: "must-not-submit" }; },
    reconcile: () => { reconciles += 1; return { confirmed: true, exchangeOrderId: "exchange-1", filledQty: 1 }; }
  });
  const recovered = restarted.recoverAfterRestart();
  assert.equal(recovered[0].status, "CONFIRMED");
  assert.equal(recovered[0].filledQty, 1);
  assert.equal(reconciles, 1);
  assert.equal(submits, 1);
});

test("Persistent network retry is allowed only after explicit not-found reconciliation", () => {
  const store = new NetworkPersistenceStore();
  let submits = 0;
  const first = new PersistentNetworkResilience({
    store,
    submit: () => { submits += 1; throw new Error("connection lost"); },
    reconcile: () => ({ confirmed: false })
  });
  first.execute({ clientRequestId: "gate3-retry", order: { symbol: "SOLUSDT", side: "SELL", quantity: 3 } });

  const restarted = new PersistentNetworkResilience({
    store,
    submit: () => { submits += 1; return { accepted: true, exchangeOrderId: "exchange-retry" }; },
    reconcile: () => ({ confirmed: false })
  });
  assert.equal(restarted.recoverAfterRestart()[0].status, "UNKNOWN");
  const retried = restarted.retry("gate3-retry");
  assert.equal(retried.status, "CONFIRMED");
  assert.equal(retried.exchangeOrderId, "exchange-retry");
  assert.equal(submits, 2);
});

test("Ambiguous reconciliation response fails closed", () => {
  const store = new NetworkPersistenceStore();
  const engine = new PersistentNetworkResilience({
    store,
    submit: () => { throw new Error("response lost"); },
    reconcile: () => ({ confirmed: "maybe" })
  });
  engine.execute({ clientRequestId: "gate3-invalid-reconcile", order: { symbol: "BTCUSDT", side: "BUY", quantity: 1 } });
  assert.throws(() => engine.recoverAfterRestart(), /invalid reconciliation response/);
});

console.log(`\nGate 3 Test Runner: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
