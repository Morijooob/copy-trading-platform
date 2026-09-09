import assert from "node:assert/strict";
import { ExecutionEngine } from "../src/execution-engine.js";
import { RiskEngine } from "../src/risk-engine.js";
import { RiskControlledExecution } from "../src/risk-controlled-execution.js";

function makeSystem(limits = {}, state = null) {
  const execution = new ExecutionEngine();
  const risk = new RiskEngine({ maxOrderNotional: 1000, maxDailyLoss: 200, maxExposure: 1000, ...limits });
  const gateway = new RiskControlledExecution({ riskEngine: risk, executionEngine: execution, state });
  return { execution, risk, gateway };
}

// 1. Partial fill converts only the filled portion from reserved to actual exposure.
{
  const { risk, gateway } = makeSystem({ maxExposure: 1000 });
  const submitted = gateway.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 10, price: 100, clientOrderId: "g6-partial" });
  assert.equal(risk.reservedExposure, 1000);
  gateway.onExchangeFill(submitted.order.id, 3, "fill-1");
  assert.equal(risk.exposure, 300);
  assert.equal(risk.reservedExposure, 700);
}

// 2. Full fill consumes the remaining reservation exactly once.
{
  const { risk, gateway } = makeSystem({ maxExposure: 1000 });
  const submitted = gateway.submit({ symbol: "ETHUSDT", side: "BUY", quantity: 5, price: 100, clientOrderId: "g6-full" });
  gateway.onExchangeFill(submitted.order.id, 5, "fill-full");
  assert.equal(risk.exposure, 500);
  assert.equal(risk.reservedExposure, 0);
  gateway.onExchangeFill(submitted.order.id, 5, "fill-full");
  assert.equal(risk.exposure, 500);
  assert.equal(risk.reservedExposure, 0);
}

// 3. Confirmed exchange absence releases all remaining pending exposure.
{
  const { risk, gateway } = makeSystem({ maxExposure: 1000 });
  const submitted = gateway.submit({ symbol: "SOLUSDT", side: "BUY", quantity: 6, price: 100, clientOrderId: "g6-not-found" });
  assert.equal(risk.reservedExposure, 600);
  gateway.reconcileExchangeState(submitted.order.id, { found: false });
  assert.equal(risk.exposure, 0);
  assert.equal(risk.reservedExposure, 0);
}

// 4. Ambiguous reconciliation never releases the reservation.
{
  const { risk, gateway } = makeSystem({ maxExposure: 1000 });
  const submitted = gateway.submit({ symbol: "XRPUSDT", side: "BUY", quantity: 4, price: 100, clientOrderId: "g6-ambiguous" });
  assert.throws(() => gateway.reconcileExchangeState(submitted.order.id, { found: "unknown" }), /exchange reconciliation must explicitly resolve/);
  assert.equal(risk.reservedExposure, 400);
}

// 5. Reservation lifecycle survives gateway restart and can continue safely.
{
  const { risk, gateway } = makeSystem({ maxExposure: 1000 });
  const submitted = gateway.submit({ symbol: "ADAUSDT", side: "BUY", quantity: 8, price: 50, clientOrderId: "g6-restart" });
  const state = gateway.exportState();
  const restored = new RiskControlledExecution({ riskEngine: risk, executionEngine: gateway.executionEngine, state });
  restored.onExchangeFill(submitted.order.id, 2, "fill-restart");
  assert.equal(risk.exposure, 100);
  assert.equal(risk.reservedExposure, 300);
  const duplicate = restored.submit({ symbol: "ADAUSDT", side: "BUY", quantity: 8, price: 50, clientOrderId: "g6-restart" });
  assert.equal(duplicate.accepted, true);
  assert.equal(risk.reservedExposure, 300);
}

// 6. A pending order whose reservation state is missing fails closed instead of creating untracked exposure.
{
  const { execution, risk } = makeSystem({ maxExposure: 1000 });
  const order = execution.createOrder({ symbol: "DOGEUSDT", side: "BUY", quantity: 2, timeoutMs: 5000, clientOrderId: "g6-missing" });
  const gateway = new RiskControlledExecution({ riskEngine: risk, executionEngine: execution });
  assert.throws(
    () => gateway.submit({ symbol: "DOGEUSDT", side: "BUY", quantity: 2, price: 100, clientOrderId: order.clientOrderId }),
    /missing exposure reservation/
  );
}

console.log("Gate 6 Test Runner: 6 passed, 0 failed");
