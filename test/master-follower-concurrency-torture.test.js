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
  return { risk, exchange, execution, pipeline };
}

// 100 concurrent callers publish the exact same master intent. The coordinator must fan out once.
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

// STRESS-200: 200 distinct master intents are submitted concurrently, with an exact replay
// racing alongside each first submission. Every logical master/follower pair must produce
// exactly one demo exchange order. This intentionally stresses concurrency + idempotency;
// dedicated risk tests cover exposure rejection.
{
  const followers = ["F1", "F2"];
  const pipelines = Object.fromEntries(followers.map((id) => [id, makePipeline()]));
  const coordinator = new MasterFollowerCoordinator();
  for (const followerId of followers) coordinator.joinFollower({ followerId, pipeline: pipelines[followerId].pipeline });

  const signals = Array.from({ length: 200 }, (_, i) => ({
    masterSignalId: `STRESS-200-${String(i).padStart(3, "0")}`,
    symbol: i % 2 === 0 ? "BTCUSDT" : "ETHUSDT",
    side: i % 3 === 0 ? "SELL" : "BUY",
    quantity: 1 + (i % 5),
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
  for (let i = 0; i < signals.length; i += 1) {
    const first = results[i * 2];
    const replay = results[i * 2 + 1];
    assert.deepEqual(replay, first, `concurrent replay must be immutable for ${signals[i].masterSignalId}`);
  }

  assert.equal(coordinator.exportState().signals.length, 200, "STRESS-200 must persist 200 unique master signals");
  for (const followerId of followers) {
    const accepted = pipelines[followerId].exchange.getAuditLog().filter((e) => e.type === "ORDER_ACCEPTED");
    assert.equal(accepted.length, 200, `${followerId} must have exactly 200 exchange orders`);
    assert.equal(pipelines[followerId].execution.orders.size, 200, `${followerId} must have exactly 200 executions`);
  }

  const audit = coordinator.getAuditLog();
  assert.equal(audit.filter((e) => e.type === "MASTER_SIGNAL_PROCESSED").length, 200);
  assert.equal(audit.filter((e) => e.type === "FOLLOWER_SIGNAL_RESULT").length, 400);

  console.log("STRESS-200: 200 concurrent master intents x 2 followers = 400 follower executions; 0 duplicates; 0 lost signals");
}

console.log("master-follower concurrency torture tests: all passed");
