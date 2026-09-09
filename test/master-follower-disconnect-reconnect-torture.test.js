import assert from "node:assert/strict";
import { DemoExchangeSimulator } from "../src/demo-exchange-simulator.js";
import { DemoExecutionPipeline } from "../src/demo-execution-pipeline.js";
import { MasterFollowerCoordinator } from "../src/master-follower-coordinator.js";
import { RiskEngine } from "../src/risk-engine.js";

const TOTAL = 300;
const followers = ["F1", "F2", "F3"];

function makePipeline(id) {
  const exchange = new DemoExchangeSimulator({ marketPrice: 100 });
  const riskEngine = new RiskEngine({
    maxOrderNotional: 5_000,
    maxDailyLoss: 5_000,
    maxExposure: 10_000_000,
  });
  const pipeline = new DemoExecutionPipeline({
    followerId: id,
    riskEngine,
    exchange,
  });
  return { pipeline, exchange };
}

const pipelines = Object.fromEntries(followers.map((id) => [id, makePipeline(id)]));
const coordinator = new MasterFollowerCoordinator({ capacity: 2 });

for (const followerId of followers) {
  coordinator.joinFollower({ followerId, pipeline: pipelines[followerId].pipeline });
}

// First wave: F1/F2 are active; F3 is queued and must not execute historical signals.
for (let i = 1; i <= TOTAL; i += 1) {
  const masterSignalId = `DISCONNECT-${i}`;
  const signal = {
    masterSignalId,
    symbol: "BTCUSDT",
    side: i % 2 === 0 ? "BUY" : "SELL",
    quantity: (i % 3) + 1,
    price: 100,
  };
  const conflictingReplay = {
    ...signal,
    side: signal.side === "BUY" ? "SELL" : "BUY",
    quantity: 99,
    price: 9_999,
  };

  coordinator.publishSignal(signal);
  coordinator.publishSignal(conflictingReplay);
}

assert.equal(coordinator.exportState().signals.length, TOTAL);
assert.equal(pipelines.F1.pipeline.executionEngine.exportState().orders.length, TOTAL);
assert.equal(pipelines.F2.pipeline.executionEngine.exportState().orders.length, TOTAL);
assert.equal(pipelines.F3.pipeline.executionEngine.exportState().orders.length, 0);
assert.equal(pipelines.F1.exchange.exportState().orders.length, TOTAL);
assert.equal(pipelines.F2.exchange.exportState().orders.length, TOTAL);
assert.equal(pipelines.F3.exchange.exportState().orders.length, 0);

// Disconnect F1 and promote F3. Promotion must not replay historical signals.
coordinator.leaveFollower("F1");
coordinator.attachPromotedFollower({ followerId: "F3", pipeline: pipelines.F3.pipeline });

const stateAfterPromotion = coordinator.exportState();
assert.deepEqual(stateAfterPromotion.queue.active.map((entry) => entry.userId), ["F2", "F3"]);
assert.equal(stateAfterPromotion.queue.waiting.length, 0);
assert.equal(pipelines.F3.pipeline.executionEngine.exportState().orders.length, 0);
assert.equal(pipelines.F3.exchange.exportState().orders.length, 0);

// Second wave: only F2 and newly promoted F3 are active.
for (let i = 1; i <= TOTAL; i += 1) {
  const masterSignalId = `RECONNECT-${i}`;
  const signal = {
    masterSignalId,
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 1,
    price: 100,
  };
  const conflictingReplay = {
    ...signal,
    side: "SELL",
    quantity: 99,
    price: 9_999,
  };

  coordinator.publishSignal(signal);
  coordinator.publishSignal(conflictingReplay);
}

// F2 was active for both waves: 300 + 300 = 600.
assert.equal(pipelines.F2.pipeline.executionEngine.exportState().orders.length, TOTAL * 2);
assert.equal(pipelines.F2.exchange.exportState().orders.length, TOTAL * 2);

// F3 joined as active only after wave 1: it must execute only wave 2, i.e. 300.
assert.equal(pipelines.F3.pipeline.executionEngine.exportState().orders.length, TOTAL);
assert.equal(pipelines.F3.exchange.exportState().orders.length, TOTAL);

// F1 disconnected after wave 1 and must remain at exactly its historical 300 executions.
assert.equal(pipelines.F1.pipeline.executionEngine.exportState().orders.length, TOTAL);
assert.equal(pipelines.F1.exchange.exportState().orders.length, TOTAL);

// Every master signal is unique; each duplicate/conflicting replay must be idempotently ignored.
assert.equal(coordinator.exportState().signals.length, TOTAL * 2);

console.log(
  `DISCONNECT-RECONNECT: ${TOTAL} first-wave signals + ${TOTAL} second-wave signals; ` +
  `F1=${TOTAL}, F2=${TOTAL * 2}, F3=${TOTAL}; 0 duplicate side effects; 0 historical replay`
);
console.log("master-follower disconnect/reconnect torture tests: all passed");
