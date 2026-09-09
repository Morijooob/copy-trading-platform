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

const ACTIVE = ["F1", "F2"];
const QUEUED = Array.from({ length: 8 }, (_, i) => `Q${i + 1}`);
const TOTAL = 1000;

// Capacity pressure: two active followers plus eight queued followers. The queue must
// remain deterministic while the active slots process a heavy concurrent signal storm.
{
  const pipelines = Object.fromEntries([...ACTIVE, ...QUEUED].map((id) => [id, makePipeline()]));
  const coordinator = new MasterFollowerCoordinator();

  for (const followerId of ACTIVE) {
    coordinator.joinFollower({ followerId, pipeline: pipelines[followerId].pipeline });
  }
  for (const followerId of QUEUED) {
    coordinator.joinFollower({ followerId, pipeline: pipelines[followerId].pipeline });
  }

  assert.deepEqual(coordinator.statusResponse().active.map((x) => x.followerId), ACTIVE);
  assert.equal(coordinator.statusResponse().queue.length, QUEUED.length);

  const signals = Array.from({ length: TOTAL }, (_, i) => ({
    masterSignalId: `HEAVY-${String(i).padStart(4, "0")}`,
    symbol: i % 2 === 0 ? "BTCUSDT" : "ETHUSDT",
    side: i % 2 === 0 ? "BUY" : "SELL",
    quantity: 1 + (i % 4),
    price: 100
  }));

  const operations = signals.flatMap((signal) => [
    Promise.resolve().then(() => coordinator.publishSignal(signal)),
    Promise.resolve().then(() => coordinator.publishSignal({
      ...signal,
      side: signal.side === "BUY" ? "SELL" : "BUY",
      quantity: 999,
      price: 1
    }))
  ]);

  const results = await Promise.all(operations);
  for (let i = 0; i < TOTAL; i += 1) {
    assert.deepEqual(results[i * 2 + 1], results[i * 2], `replay must remain immutable for ${signals[i].masterSignalId}`);
  }

  assert.equal(coordinator.exportState().signals.length, TOTAL);
  for (const followerId of ACTIVE) {
    const accepted = pipelines[followerId].exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED");
    assert.equal(accepted.length, TOTAL, `${followerId} must receive exactly ${TOTAL} orders`);
    assert.equal(pipelines[followerId].execution.orders.size, TOTAL, `${followerId} must persist exactly ${TOTAL} executions`);
  }

  for (const followerId of QUEUED) {
    assert.equal(pipelines[followerId].exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, 0);
  }

  // Exercise capacity promotion after the heavy storm without losing queue ordering.
  coordinator.leaveFollower("F1");
  coordinator.attachPromotedFollower({ followerId: "Q1", pipeline: pipelines.Q1.pipeline });
  const status = coordinator.statusResponse();
  assert.deepEqual(status.active.map((x) => x.followerId), ["F2", "Q1"]);
  assert.equal(status.queue.length, QUEUED.length - 1);

  console.log(`HEAVY-STRESS: ${TOTAL} concurrent master intents x ${ACTIVE.length} active followers = ${TOTAL * ACTIVE.length} executions; ${QUEUED.length} queued; 0 duplicates; 0 lost signals`);
}

console.log("master-follower capacity heavy stress tests: all passed");
