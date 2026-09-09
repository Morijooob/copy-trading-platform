import assert from "node:assert/strict";
import { DemoExchangeSimulator } from "../src/demo-exchange-simulator.js";
import { DemoExecutionPipeline } from "../src/demo-execution-pipeline.js";
import { ExecutionEngine } from "../src/execution-engine.js";
import { RiskEngine } from "../src/risk-engine.js";
import { MasterFollowerCoordinator } from "../src/master-follower-coordinator.js";

function makePipeline({ scenarios = {}, state = null } = {}) {
  const risk = new RiskEngine({ maxOrderNotional: 1000, maxDailyLoss: 200, maxExposure: 1000, state: state?.risk ?? null });
  const exchange = new DemoExchangeSimulator({ marketPrice: 100, scenarios });
  if (state?.exchange) exchange.restore(state.exchange);
  const execution = new ExecutionEngine({ state: state?.execution ?? null });
  const pipeline = new DemoExecutionPipeline({
    riskEngine: risk,
    exchange,
    executionEngine: execution,
    state: state?.pipeline ?? null
  });
  return { risk, exchange, execution, pipeline };
}

// Full-chain torture: Master -> two real follower pipelines -> timeout/partial + crash -> restart -> recovery.
{
  const f1 = makePipeline({ scenarios: { "COPY-TORTURE-1-F1": "TIMEOUT_PARTIAL" } });
  const f2 = makePipeline({ scenarios: { "COPY-TORTURE-1-F2": "CRASH" } });
  const coordinator = new MasterFollowerCoordinator();
  coordinator.joinFollower({ followerId: "F1", pipeline: f1.pipeline });
  coordinator.joinFollower({ followerId: "F2", pipeline: f2.pipeline });

  const first = coordinator.publishSignal({
    masterSignalId: "TORTURE-1",
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 10,
    price: 100
  });

  assert.equal(first.status, "PROCESSED");
  assert.equal(first.followerResults.length, 2);
  assert.equal(first.followerResults[0].copyOrderId, "COPY-TORTURE-1-F1");
  assert.equal(first.followerResults[1].copyOrderId, "COPY-TORTURE-1-F2");
  assert.equal(f1.risk.exposure, 0);
  assert.equal(f1.risk.reservedExposure, 1000);
  assert.equal(f2.risk.exposure, 0);
  assert.equal(f2.risk.reservedExposure, 1000);

  // Persist every layer before the simulated process dies.
  const coordinatorState = coordinator.exportState();
  const f1State = { pipeline: f1.pipeline.exportState(), exchange: f1.exchange.exportState(), risk: f1.risk.exportState(), execution: f1.execution.exportState() };
  const f2State = { pipeline: f2.pipeline.exportState(), exchange: f2.exchange.exportState(), risk: f2.risk.exportState(), execution: f2.execution.exportState() };

  const r1 = makePipeline({ state: f1State });
  const r2 = makePipeline({ state: f2State });
  const restartedCoordinator = new MasterFollowerCoordinator();
  restartedCoordinator.restoreState(coordinatorState, { F1: r1.pipeline, F2: r2.pipeline });

  // Recovery must discover the already accepted exchange orders without creating duplicates.
  const recovered1 = r1.pipeline.recoverAfterRestart();
  const recovered2 = r2.pipeline.recoverAfterRestart();
  assert.equal(recovered1[0].order.status, "PARTIAL");
  assert.equal(recovered1[0].order.filledQty, 5);
  assert.equal(r1.risk.exposure, 500);
  assert.equal(r1.risk.reservedExposure, 500);
  assert.equal(recovered2[0].order.status, "PENDING");
  assert.equal(recovered2[0].order.filledQty, 0);
  assert.equal(r2.risk.exposure, 0);
  assert.equal(r2.risk.reservedExposure, 1000);

  // Late fill completes F1; settlement must account only for the new delta.
  r1.exchange.completePartialFill("COPY-TORTURE-1-F1");
  const completed = r1.pipeline.recover("COPY-TORTURE-1-F1");
  assert.equal(completed.order.status, "FILLED");
  assert.equal(completed.order.filledQty, 10);
  assert.equal(r1.risk.exposure, 1000);
  assert.equal(r1.risk.reservedExposure, 0);

  // Replaying the exact same master signal after coordinator restart must be a no-op.
  const f1AcceptedBefore = r1.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length;
  const f2AcceptedBefore = r2.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length;
  const replay = restartedCoordinator.publishSignal({
    masterSignalId: "TORTURE-1",
    symbol: "BTCUSDT",
    side: "SELL",
    quantity: 999,
    price: 99999
  });
  assert.deepEqual(replay, coordinatorState.signals[0]);
  assert.equal(r1.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, f1AcceptedBefore);
  assert.equal(r2.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, f2AcceptedBefore);
}

// Kill switch must stop a new copy-trade at both follower risk boundaries.
{
  const f1 = makePipeline();
  const f2 = makePipeline();
  f1.risk.setKillSwitch(true, "torture-test");
  f2.risk.setKillSwitch(true, "torture-test");
  const coordinator = new MasterFollowerCoordinator();
  coordinator.joinFollower({ followerId: "F1", pipeline: f1.pipeline });
  coordinator.joinFollower({ followerId: "F2", pipeline: f2.pipeline });

  const blocked = coordinator.publishSignal({
    masterSignalId: "TORTURE-KILL-1",
    symbol: "ETHUSDT",
    side: "BUY",
    quantity: 1,
    price: 100
  });

  assert.deepEqual(blocked.followerResults.map((x) => x.result.status), ["RISK_REJECTED", "RISK_REJECTED"]);
  assert.equal(f1.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, 0);
  assert.equal(f2.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, 0);
}

console.log("master-follower torture tests: all passed");
