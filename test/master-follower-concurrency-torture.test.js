import assert from "node:assert/strict";
import { DemoExchangeSimulator } from "../src/demo-exchange-simulator.js";
import { DemoExecutionPipeline } from "../src/demo-execution-pipeline.js";
import { ExecutionEngine } from "../src/execution-engine.js";
import { RiskEngine } from "../src/risk-engine.js";
import { MasterFollowerCoordinator } from "../src/master-follower-coordinator.js";

function makePipeline() {
  const risk = new RiskEngine({ maxOrderNotional: 5000, maxDailyLoss: 5000, maxExposure: 5000 });
  const exchange = new DemoExchangeSimulator({ marketPrice: 100 });
  const execution = new ExecutionEngine();
  const pipeline = new DemoExecutionPipeline({ riskEngine: risk, exchange, executionEngine: execution });
  return { risk, exchange, execution, pipeline };
}

// Many concurrent callers publish the exact same master intent. The coordinator must fan out once.
{
  const followers = ["F1", "F2"];
  const pipelines = Object.fromEntries(followers.map((id) => [id, makePipeline()]));
  const coordinator = new MasterFollowerCoordinator();
  for (const followerId of followers) coordinator.joinFollower({ followerId, pipeline: pipelines[followerId].pipeline });

  const calls = await Promise.all(Array.from({ length: 100 }, () => Promise.resolve().then(() => coordinator.publishSignal({
    masterSignalId: "CONCURRENT-MASTER-1",
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 10,
    price: 100
  }))));

  for (const result of calls) assert.deepEqual(result, calls[0]);
  assert.equal(coordinator.exportState().signals.length, 1);

  for (const followerId of followers) {
    const accepted = pipelines[followerId].exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED");
    assert.equal(accepted.length, 1, `${followerId} must receive exactly one exchange order`);
    assert.equal(pipelines[followerId].execution.orders.size, 1, `${followerId} must persist exactly one execution`);
  }
}

// Conflicting payloads with the same masterSignalId cannot mutate an already accepted intent.
{
  const f1 = makePipeline();
  const f2 = makePipeline();
  const coordinator = new MasterFollowerCoordinator();
  coordinator.joinFollower({ followerId: "F1", pipeline: f1.pipeline });
  coordinator.joinFollower({ followerId: "F2", pipeline: f2.pipeline });

  const accepted = coordinator.publishSignal({
    masterSignalId: "CONCURRENT-MASTER-2",
    symbol: "ETHUSDT",
    side: "SELL",
    quantity: 2,
    price: 100
  });
  const replay = coordinator.publishSignal({
    masterSignalId: "CONCURRENT-MASTER-2",
    symbol: "ETHUSDT",
    side: "BUY",
    quantity: 999,
    price: 1
  });

  assert.deepEqual(replay, accepted);
  assert.equal(f1.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, 1);
  assert.equal(f2.exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED").length, 1);
}

// Burst test: many distinct master intents are interleaved with exact replays.
// Every logical master/follower pair must produce exactly one demo exchange order.
{
  const followers = ["F1", "F2"];
  const pipelines = Object.fromEntries(followers.map((id) => [id, makePipeline()]));
  const coordinator = new MasterFollowerCoordinator();
  for (const followerId of followers) coordinator.joinFollower({ followerId, pipeline: pipelines[followerId].pipeline });

  const signals = Array.from({ length: 200 }, (_, i) => ({
    masterSignalId: `BURST-${String(i).padStart(3, "0")}`,
    symbol: i % 2 === 0 ? "BTCUSDT" : "ETHUSDT",
    side: i % 3 === 0 ? "SELL" : "BUY",
    quantity: 1 + (i % 5),
    price: 100
  }));

  for (const signal of signals) {
    const first = coordinator.publishSignal(signal);
    const replay = coordinator.publishSignal({ ...signal, side: signal.side === "BUY" ? "SELL" : "BUY", quantity: 999 });
    assert.deepEqual(replay, first, `replay must be immutable for ${signal.masterSignalId}`);
  }

  assert.equal(coordinator.exportState().signals.length, signals.length);
  for (const followerId of followers) {
    const accepted = pipelines[followerId].exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED");
    assert.equal(accepted.length, signals.length, `${followerId} must have one exchange order per distinct master signal`);
    assert.equal(pipelines[followerId].execution.orders.size, signals.length, `${followerId} must have one execution per distinct master signal`);
  }

  const audit = coordinator.getAuditLog();
  assert.equal(audit.filter((e) => e.type === "MASTER_SIGNAL_PROCESSED").length, signals.length);
  assert.equal(audit.filter((e) => e.type === "FOLLOWER_SIGNAL_RESULT").length, signals.length * followers.length);
}

console.log("master-follower concurrency torture tests: all passed");
