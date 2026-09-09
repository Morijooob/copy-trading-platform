import assert from "node:assert/strict";
import { DemoExchangeSimulator } from "../src/demo-exchange-simulator.js";
import { DemoExecutionPipeline } from "../src/demo-execution-pipeline.js";
import { RiskEngine } from "../src/risk-engine.js";

function makePipeline({ scenarios = {}, maxExposure = 1000 } = {}) {
  const risk = new RiskEngine({ maxOrderNotional: 1000, maxDailyLoss: 200, maxExposure });
  const exchange = new DemoExchangeSimulator({ marketPrice: 100, scenarios });
  const pipeline = new DemoExecutionPipeline({ riskEngine: risk, exchange });
  return { risk, exchange, pipeline };
}

{
  const { risk, pipeline } = makePipeline();
  const result = pipeline.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 5, price: 100, clientOrderId: "full-1" });
  assert.equal(result.status, "CONFIRMED"); assert.equal(result.order.status, "FILLED"); assert.equal(result.order.filledQty, 5); assert.equal(risk.exposure, 500); assert.equal(risk.reservedExposure, 0);
}

{
  const { risk, pipeline } = makePipeline({ scenarios: { partial: "PARTIAL_FILL" } });
  const result = pipeline.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 10, price: 100, clientOrderId: "partial" });
  assert.equal(result.status, "CONFIRMED"); assert.equal(result.order.status, "PARTIAL"); assert.equal(result.order.filledQty, 5); assert.equal(risk.exposure, 500); assert.equal(risk.reservedExposure, 500);
}

{
  const { risk, pipeline } = makePipeline({ scenarios: { timeout: "TIMEOUT" } });
  const first = pipeline.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 2, price: 100, clientOrderId: "timeout" });
  assert.equal(first.status, "UNKNOWN"); assert.equal(risk.reservedExposure, 200);
  const recovered = pipeline.recover("timeout");
  assert.equal(recovered.status, "CONFIRMED"); assert.equal(recovered.order.filledQty, 0); assert.equal(risk.exposure, 0); assert.equal(risk.reservedExposure, 200);
}

{
  const { risk, exchange, pipeline } = makePipeline();
  exchange.disconnect();
  const first = pipeline.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 3, price: 100, clientOrderId: "disconnect" });
  assert.equal(first.status, "UNKNOWN"); assert.equal(risk.reservedExposure, 300);
  exchange.reconnect();
  const recovered = pipeline.recover("disconnect");
  assert.equal(recovered.status, "CONFIRMED"); assert.equal(recovered.order.status, "FILLED"); assert.equal(risk.exposure, 300); assert.equal(risk.reservedExposure, 0);
}

{
  const { risk, pipeline } = makePipeline({ maxExposure: 1000 });
  const first = risk.reserve({ side: "BUY", quantity: 6, price: 100 }); assert.equal(first.approved, true);
  const second = risk.reserve({ side: "BUY", quantity: 5, price: 100 }); assert.equal(second.approved, false); assert.deepEqual(second.failedChecks, ["MAX_EXPOSURE"]); assert.equal(risk.reservedExposure, 600);
  risk.releaseReservation(first.reservationId); assert.equal(risk.reservedExposure, 0);
  assert.equal(pipeline.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 5, price: 100, clientOrderId: "after-release" }).status, "CONFIRMED");
}

{
  const { pipeline } = makePipeline();
  const first = pipeline.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 1, price: 100, clientOrderId: "idempotent" });
  const second = pipeline.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 1, price: 100, clientOrderId: "idempotent" });
  assert.deepEqual(second, first);
}

console.log("demo-execution-pipeline tests: ok");
