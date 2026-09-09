import assert from "node:assert/strict";
import { DemoExchangeSimulator } from "../src/demo-exchange-simulator.js";
import { DemoExecutionPipeline } from "../src/demo-execution-pipeline.js";
import { ExecutionEngine } from "../src/execution-engine.js";
import { RiskEngine } from "../src/risk-engine.js";
import { MasterFollowerCoordinator } from "../src/master-follower-coordinator.js";

function makePipeline() {
  const risk = new RiskEngine({ maxOrderNotional: 5000, maxDailyLoss: 5000, maxExposure: 1000000 });
  const exchange = new DemoExchangeSimulator({ marketPrice: 100 });
  const execution = new ExecutionEngine();
  const pipeline = new DemoExecutionPipeline({ riskEngine: risk, exchange, executionEngine: execution });
  return { exchange, execution, pipeline };
}

const TOTAL = 300;
const followers = ["F1", "F2", "F3"];
const pipelines = Object.fromEntries(followers.map((id) => [id, makePipeline()]));
const coordinator = new MasterFollowerCoordinator();

coordinator.joinFollower({ followerId: "F1", pipeline: pipelines.F1.pipeline });
coordinator.joinFollower({ followerId: "F2", pipeline: pipelines.F2.pipeline });
coordinator.joinFollower({ followerId: "F3", pipeline: pipelines.F3.pipeline });

assert.deepEqual(coordinator.exportState().queue.active.map((x) => x.userId), ["F1", "F2"]);
assert.deepEqual(coordinator.exportState().queue.waiting.map((x) => x.userId), ["F3"]);

const firstWave = Array.from({ length: TOTAL }, (_, i) => ({
  masterSignalId: `DISC-${String(i).padStart(4, "0")}`,
  symbol: i % 2 ? "ETHUSDT" : "BTCUSDT",
  side: i % 2 ? "SELL" : "BUY",
  quantity: 1 + (i % 3),
  price: 100
}));

// F1/F2 process the first wave while every intent is replayed with contradictory data.
await Promise.all(firstWave.flatMap((signal) => [
  Promise.resolve().then(() => coordinator.publishSignal(signal)),
  Promise.resolve().then(() => coordinator.publishSignal({ ...signal, side: signal.side === "BUY" ? "SELL" : "BUY", quantity: 999, price: 1 }))
]));

assert.equal(coordinator.exportState().signals.length, TOTAL);
for (const id of ["F1", "F2"]) {
  assert.equal(pipelines[id].execution.orders.size, TOTAL);
  assert.equal(pipelines[id].exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, TOTAL);
}

// Disconnect F1 after execution. Its slot promotes F3, but F3 must not retroactively
// execute historical signals. New signals must go only to the currently active pair.
coordinator.leaveFollower("F1");
coordinator.attachPromotedFollower({ followerId: "F3", pipeline: pipelines.F3.pipeline });
assert.deepEqual(coordinator.exportState().queue.active.map((x) => x.userId), ["F2", "F3"]);
assert.equal(pipelines.F3.execution.orders.size, 0);

const secondWave = Array.from({ length: TOTAL }, (_, i) => ({
  masterSignalId: `DISC-NEW-${String(i).padStart(4, "0")}`,
  symbol: "BTCUSDT",
  side: "BUY",
  quantity: 1,
  price: 100
}));

await Promise.all(secondWave.flatMap((signal) => [
  Promise.resolve().then(() => coordinator.publishSignal(signal)),
  Promise.resolve().then(() => coordinator.publishSignal({ ...signal, side: "SELL", quantity: 777, price: 2 }))
]));

for (const id of ["F2", "F3"]) {
  assert.equal(pipelines[id].execution.orders.size, TOTAL * 2);
  assert.equal(pipelines[id].exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, TOTAL * 2);
}
assert.equal(pipelines.F1.execution.orders.size, TOTAL);

// Simulate restart/reconnect: persisted state is restored with F2/F3, then the disconnected
// F1 rejoins the queue. Replaying old signals must cause zero side effects.
const snapshot = coordinator.exportState();
const restored = new MasterFollowerCoordinator();
restored.restoreState(snapshot, new Map([
  ["F2", pipelines.F2.pipeline],
  ["F3", pipelines.F3.pipeline]
]));
const beforeReplay = {
  F2: pipelines.F2.execution.orders.size,
  F3: pipelines.F3.execution.orders.size
};

const oldReplay = await Promise.all(firstWave.slice(0, 50).map((signal) => restored.publishSignal({
  ...signal,
  side: "SELL",
  quantity: 1234,
  price: 3
})));
assert(oldReplay.every((r) => r.status === "PROCESSED"));
assert.equal(pipelines.F2.execution.orders.size, beforeReplay.F2);
assert.equal(pipelines.F3.execution.orders.size, beforeReplay.F3);

restored.joinFollower({ followerId: "F1", pipeline: pipelines.F1.pipeline });
const finalQueue = restored.exportState().queue;
assert.equal(finalQueue.waiting.some((x) => x.userId === "F1"), true);
assert.deepEqual(finalQueue.active.map((x) => x.userId), ["F2", "F3"]);

console.log(`DISCONNECT-RC: ${TOTAL * 2} master intents across disconnect/reconnect + restart/replay; active capacity preserved; 0 duplicate side effects; 0 lost signals`);
console.log("master-follower disconnect/reconnect torture tests: all passed");
