import assert from "node:assert/strict";
import { DemoExchangeSimulator } from "../src/demo-exchange-simulator.js";
import { DemoExecutionPipeline } from "../src/demo-execution-pipeline.js";
import { ExecutionEngine } from "../src/execution-engine.js";
import { RiskEngine } from "../src/risk-engine.js";

function makeComponents({ scenarios = {}, exchangeState = null, riskState = null, executionState = null, pipelineState = null } = {}) {
  const risk = new RiskEngine({ maxOrderNotional: 1000, maxDailyLoss: 200, maxExposure: 1000, state: riskState });
  const exchange = new DemoExchangeSimulator({ marketPrice: 100, scenarios });
  if (exchangeState) exchange.restore(exchangeState);
  const execution = new ExecutionEngine({ state: executionState });
  const pipeline = new DemoExecutionPipeline({ riskEngine: risk, exchange, executionEngine: execution, state: pipelineState });
  return { risk, exchange, execution, pipeline };
}

{
  const first = makeComponents({ scenarios: { "restart-crash": "CRASH" } });
  const submitted = first.pipeline.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 2, price: 100, clientOrderId: "restart-crash" });
  assert.equal(submitted.status, "UNKNOWN");
  assert.equal(first.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, 1);

  const state = first.pipeline.exportState();
  const second = makeComponents({ exchangeState: first.exchange.exportState(), riskState: state.risk, executionState: state.execution, pipelineState: state });
  const recovered = second.pipeline.recoverAfterRestart();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].status, "CONFIRMED");
  assert.equal(recovered[0].order.status, "FILLED");
  assert.equal(second.risk.exposure, 200);
  assert.equal(second.risk.reservedExposure, 0);
  assert.equal(second.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, 1);

  const replay = second.pipeline.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 2, price: 100, clientOrderId: "restart-crash" });
  assert.equal(replay.order.exchangeOrderId, recovered[0].order.exchangeOrderId);
  assert.equal(second.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, 1);
}

{
  const first = makeComponents({ scenarios: { "restart-timeout": "TIMEOUT" } });
  const submitted = first.pipeline.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 10, price: 100, clientOrderId: "restart-timeout" });
  assert.equal(submitted.status, "UNKNOWN");
  const exchangeOrder = first.exchange.reconcile("restart-timeout");
  assert.equal(exchangeOrder.confirmed, true);
  assert.equal(exchangeOrder.filledQty, 0);

  const state = first.pipeline.exportState();
  const second = makeComponents({ exchangeState: first.exchange.exportState(), riskState: state.risk, executionState: state.execution, pipelineState: state });
  const recovered = second.pipeline.recoverAfterRestart();
  assert.equal(recovered[0].status, "CONFIRMED");
  assert.equal(recovered[0].order.filledQty, 0);
  assert.equal(second.risk.exposure, 1000);
  assert.equal(second.risk.reservedExposure, 0);
  assert.equal(second.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, 1);
}

{
  const first = makeComponents();
  first.exchange.disconnect();
  const submitted = first.pipeline.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 3, price: 100, clientOrderId: "restart-disconnect" });
  assert.equal(submitted.status, "UNKNOWN");
  assert.equal(first.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, 0);

  const state = first.pipeline.exportState();
  first.exchange.reconnect();
  const second = makeComponents({ exchangeState: first.exchange.exportState(), riskState: state.risk, executionState: state.execution, pipelineState: state });
  const recovered = second.pipeline.recoverAfterRestart();
  assert.equal(recovered[0].status, "UNKNOWN");
  assert.equal(second.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, 0);

  const retried = second.pipeline.recover("restart-disconnect");
  assert.equal(retried.status, "CONFIRMED");
  assert.equal(retried.order.status, "FILLED");
  assert.equal(second.risk.exposure, 300);
  assert.equal(second.risk.reservedExposure, 0);
  assert.equal(second.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, 1);
}

{
  const a = makeComponents({ scenarios: { f1: "CRASH" } });
  const b = makeComponents();
  const r1 = a.pipeline.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 2, price: 100, clientOrderId: "f1" });
  const r2 = b.pipeline.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 1, price: 100, clientOrderId: "f2" });
  assert.equal(r1.status, "UNKNOWN");
  assert.equal(r2.status, "CONFIRMED");
  assert.equal(b.risk.exposure, 100);

  const stateA = a.pipeline.exportState();
  const stateB = b.pipeline.exportState();
  const ar = makeComponents({ exchangeState: a.exchange.exportState(), riskState: stateA.risk, executionState: stateA.execution, pipelineState: stateA });
  const br = makeComponents({ exchangeState: b.exchange.exportState(), riskState: stateB.risk, executionState: stateB.execution, pipelineState: stateB });
  assert.equal(ar.pipeline.recoverAfterRestart()[0].order.status, "FILLED");
  assert.equal(br.pipeline.recoverAfterRestart().length, 0);
  assert.equal(br.risk.exposure, 100);
  assert.equal(ar.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, 1);
  assert.equal(br.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, 1);
}

{
  const first = makeComponents();
  first.exchange.disconnect();
  first.pipeline.submit({ symbol: "BTCUSDT", side: "BUY", quantity: 2, price: 100, clientOrderId: "tamper" });
  const state = first.pipeline.exportState();
  state.risk.reservedExposure = 0;
  assert.throws(() => makeComponents({ exchangeState: first.exchange.exportState(), riskState: state.risk, executionState: state.execution, pipelineState: state }), /reserved exposure mismatch/);
}

console.log("demo-execution-pipeline-restart tests: ok");
