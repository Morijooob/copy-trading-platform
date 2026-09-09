import assert from "node:assert/strict";
import { ExecutionEngine } from "../src/execution-engine.js";
import { RiskEngine } from "../src/risk-engine.js";
import { RiskControlledExecution } from "../src/risk-controlled-execution.js";

function makeSystem(limits = {}) {
  const execution = new ExecutionEngine();
  const risk = new RiskEngine({ maxOrderNotional: 1000, maxDailyLoss: 200, maxExposure: 1000, ...limits });
  const gateway = new RiskControlledExecution({ riskEngine: risk, executionEngine: execution });
  return { execution, risk, gateway };
}

{
  const { risk, gateway } = makeSystem({ maxExposure: 1000 });
  const first = gateway.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 4, price: 100, clientOrderId: "g5-1" });
  assert.equal(first.accepted, true);
  assert.equal(risk.reservedExposure, 400);

  const second = gateway.submit({ symbol: "ETHUSDT", side: "BUY", quantity: 5, price: 100, clientOrderId: "g5-2" });
  assert.equal(second.accepted, true);
  assert.equal(risk.reservedExposure, 900);

  const blocked = gateway.submit({ symbol: "SOLUSDT", side: "BUY", quantity: 2, price: 100, clientOrderId: "g5-3" });
  assert.equal(blocked.accepted, false);
  assert.deepEqual(blocked.risk.failedChecks, ["MAX_EXPOSURE"]);
  assert.equal(risk.reservedExposure, 900);
}

{
  const { risk, gateway } = makeSystem({ maxExposure: 500 });
  gateway.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 3, price: 100, clientOrderId: "g5-idem" });
  const duplicate = gateway.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 3, price: 100, clientOrderId: "g5-idem" });
  assert.equal(duplicate.accepted, true);
  assert.equal(risk.reservedExposure, 300);
}

{
  const { risk, gateway } = makeSystem({ maxExposure: 500 });
  gateway.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 3, price: 100, clientOrderId: "g5-conflict" });
  assert.throws(
    () => gateway.submit({ symbol: "ETHUSDT", side: "SELL", quantity: 3, price: 100, clientOrderId: "g5-conflict" }),
    /conflicting client order id/
  );
  assert.equal(risk.reservedExposure, 300);
}

{
  const { risk } = makeSystem({ maxExposure: 500 });
  risk.reserveExposure(300);
  assert.throws(() => risk.reserveExposure(201), /max exposure exceeded/);
  assert.equal(risk.reservedExposure, 300);
  risk.releaseExposure(300);
  assert.equal(risk.reservedExposure, 0);
}

{
  const { risk } = makeSystem({ maxExposure: 500 });
  risk.setExposure(400);
  assert.throws(() => risk.reserveExposure(101), /max exposure exceeded/);
  assert.equal(risk.reservedExposure, 0);
}

console.log("Gate 5 Test Runner: 5 passed, 0 failed");
