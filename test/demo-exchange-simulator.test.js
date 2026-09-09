import assert from "node:assert/strict";
import { DemoExchangeSimulator } from "../src/demo-exchange-simulator.js";

const order = (clientOrderId, quantity = 10) => ({ clientOrderId, symbol: "BTCUSDT", side: "BUY", quantity });

{
  const ex = new DemoExchangeSimulator({ marketPrice: 100, latencyMs: 25 });
  const result = ex.submitOrder(order("normal"));
  assert.equal(result.status, "FILLED");
  assert.equal(result.filledQty, 10);
  assert.equal(result.averagePrice, 100);
  assert.equal(result.latencyMs, 25);
}

{
  const ex = new DemoExchangeSimulator({ scenarios: { partial: "PARTIAL_FILL" } });
  const first = ex.submitOrder(order("partial"));
  assert.equal(first.status, "PARTIAL");
  assert.equal(first.filledQty, 5);
  const done = ex.completePartialFill("partial");
  assert.equal(done.status, "FILLED");
  assert.equal(done.filledQty, 10);
}

{
  const ex = new DemoExchangeSimulator({ marketPrice: 100, slippageBps: 50 });
  const result = ex.submitOrder(order("slippage", 2));
  assert.equal(result.averagePrice, 100.5);
}

{
  const ex = new DemoExchangeSimulator({ marketPrice: 100, slippageBps: 50 });
  const result = ex.submitOrder({ clientOrderId: "sell-slippage", symbol: "BTCUSDT", side: "SELL", quantity: 0.1 });
  assert.equal(result.averagePrice, 99.5);
  assert.equal(result.filledQty, 0.1);
}

for (const scenario of ["TIMEOUT", "CRASH", "NETWORK_FAILURE"]) {
  const ex = new DemoExchangeSimulator({ scenarios: { failure: scenario } });
  assert.throws(() => ex.submitOrder(order("failure")), /simulated after acceptance/);
  const reconciliation = ex.reconcile("failure");
  assert.equal(reconciliation.confirmed, true);
  assert.equal(reconciliation.filledQty, 0);
}

{
  const ex = new DemoExchangeSimulator();
  ex.disconnect();
  assert.throws(() => ex.submitOrder(order("offline")), /network disconnected/);
  ex.reconnect();
  assert.equal(ex.submitOrder(order("offline")).status, "FILLED");
}

{
  const ex = new DemoExchangeSimulator();
  const first = ex.submitOrder(order("duplicate"));
  const second = ex.submitOrder(order("duplicate"));
  assert.equal(second.exchangeOrderId, first.exchangeOrderId);
  assert.equal(ex.getAuditLog().filter((event) => event.type === "ORDER_ACCEPTED").length, 1);
}

{
  const ex1 = new DemoExchangeSimulator({ marketPrice: 123.45, latencyMs: 77, slippageBps: 25, scenarios: { restart: "TIMEOUT", after: "FULL_FILL" } });
  assert.throws(() => ex1.submitOrder(order("restart")), /simulated after acceptance/);
  const state = ex1.exportState();
  const ex2 = new DemoExchangeSimulator({ state });
  assert.equal(ex2.marketPrice, 123.45);
  assert.equal(ex2.latencyMs, 77);
  assert.equal(ex2.slippageBps, 25);
  const reconciliation = ex2.reconcile("restart");
  assert.equal(reconciliation.confirmed, true);
  assert.equal(reconciliation.exchangeOrderId, "DEMO-1");
  assert.equal(ex2.getOrder("restart").status, "OPEN");
}

{
  const ex = new DemoExchangeSimulator();
  ex.submitOrder(order("decimal", 0.3));
  assert.equal(ex.getOrder("decimal").filledQty, 0.3);
  assert.equal(ex.getOrder("decimal").status, "FILLED");
}

{
  const ex = new DemoExchangeSimulator();
  ex.submitOrder(order("audit"));
  const audit = ex.getAuditLog();
  assert.deepEqual(audit.map((event) => event.eventId), ["DEVENT-1", "DEVENT-2"]);
  audit[0].payload.clientOrderId = "tampered";
  assert.equal(ex.getAuditLog()[0].payload.clientOrderId, "audit");
}

console.log("demo-exchange-simulator tests: ok");
