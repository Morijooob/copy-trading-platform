import assert from "node:assert/strict";
import { ExecutionEngine } from "../src/execution-engine.js";
import { RiskEngine } from "../src/risk-engine.js";
import { RiskControlledExecution } from "../src/risk-controlled-execution.js";

function makeSystem(limits = {}) {
  const execution = new ExecutionEngine();
  const risk = new RiskEngine({ maxOrderNotional: 1000, maxDailyLoss: 200, maxExposure: 1500, ...limits });
  return { execution, risk, gateway: new RiskControlledExecution({ riskEngine: risk, executionEngine: execution }) };
}

{
  const { execution, risk, gateway } = makeSystem();
  const result = gateway.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 2, price: 100, clientOrderId: "r1" });
  assert.equal(result.accepted, true);
  assert.equal(result.order.status, "PENDING");
  assert.equal(execution.getRecoverableOrders().length, 1);
  assert.equal(risk.exposure, 200);
  assert.equal(risk.reservedExposure, 0);
}

{
  const { execution, gateway } = makeSystem({ maxOrderNotional: 100 });
  const result = gateway.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 2, price: 100, clientOrderId: "blocked-notional" });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.risk.failedChecks, ["ORDER_NOTIONAL"]);
  assert.equal(execution.getRecoverableOrders().length, 0);
}

{
  const { execution, risk, gateway } = makeSystem();
  risk.setExposure(1400);
  const result = gateway.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 2, price: 100, clientOrderId: "blocked-exposure" });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.risk.failedChecks, ["MAX_EXPOSURE"]);
  assert.equal(execution.getRecoverableOrders().length, 0);
}

{
  const { execution, risk, gateway } = makeSystem();
  risk.recordRealizedPnl(-201);
  const result = gateway.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 1, price: 100, clientOrderId: "blocked-loss" });
  assert.equal(result.accepted, false);
  assert.deepEqual(result.risk.failedChecks, ["DAILY_LOSS"]);
  assert.equal(execution.getRecoverableOrders().length, 0);
}

{
  const { execution, risk, gateway } = makeSystem();
  risk.setKillSwitch(true, "test");
  const result = gateway.submit({ symbol: "BTCUSDT", side: "SELL", quantity: 1, price: 10, clientOrderId: "blocked-kill" });
  assert.equal(result.accepted, false);
  assert.ok(result.risk.failedChecks.includes("KILL_SWITCH"));
  assert.equal(execution.getRecoverableOrders().length, 0);
}

{
  const { execution, risk, gateway } = makeSystem({ maxExposure: 150 });
  const first = gateway.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 1, price: 100, clientOrderId: "atomic-1" });
  assert.equal(first.accepted, true);
  assert.equal(risk.exposure, 100);

  const second = gateway.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 1, price: 100, clientOrderId: "atomic-2" });
  assert.equal(second.accepted, false);
  assert.deepEqual(second.risk.failedChecks, ["MAX_EXPOSURE"]);
  assert.equal(risk.reservedExposure, 0);
  assert.equal(execution.getRecoverableOrders().length, 1);
}

{
  const { execution, gateway } = makeSystem();
  assert.throws(() => gateway.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 0, price: 100 }), /invalid quantity/);
  assert.equal(execution.getRecoverableOrders().length, 0);
}

{
  const risk = new RiskEngine({ maxOrderNotional: 1000, maxDailyLoss: 200, maxExposure: 1500 });
  const failingExecution = { createOrder() { throw new Error("simulated execution failure"); } };
  const gateway = new RiskControlledExecution({ riskEngine: risk, executionEngine: failingExecution });
  assert.throws(() => gateway.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 1, price: 100, clientOrderId: "release-1" }), /simulated execution failure/);
  assert.equal(risk.reservedExposure, 0);
  assert.equal(risk.exposure, 0);
  assert.equal(risk.getReservation("RISKRES-1").status, "RELEASED");
}

{
  const { gateway } = makeSystem();
  gateway.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 1, price: 100, clientOrderId: "audit-1" });
  const audit = gateway.getAuditLog();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].execution, "COMMITTED");
  assert.equal(audit[0].reservationId, "RISKRES-1");
}

console.log("risk-controlled-execution tests: ok");
