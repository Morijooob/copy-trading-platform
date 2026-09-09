import assert from "node:assert/strict";
import { MasterFollowerCoordinator } from "../src/master-follower-coordinator.js";

function scriptedPipeline(script, calls = []) {
  return {
    calls,
    submit(request) {
      calls.push(structuredClone(request));
      const step = typeof script === "function" ? script(request, calls.length) : script;
      if (step instanceof Error) throw step;
      return structuredClone(step);
    }
  };
}

// Follower failures are isolated: timeout/crash/network/partial outcomes do not stop fan-out.
{
  const coordinator = new MasterFollowerCoordinator();
  const f1 = scriptedPipeline({ accepted: true, status: "TIMEOUT" });
  const f2 = scriptedPipeline({ accepted: true, status: "PARTIAL" });
  coordinator.joinFollower({ followerId: "F1", pipeline: f1 });
  coordinator.joinFollower({ followerId: "F2", pipeline: f2 });

  const result = coordinator.publishSignal({
    masterSignalId: "ADV-FAILURES-1",
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 1,
    price: 100
  });

  assert.equal(result.followerResults[0].result.status, "TIMEOUT");
  assert.equal(result.followerResults[1].result.status, "PARTIAL");
  assert.equal(f1.calls.length, 1);
  assert.equal(f2.calls.length, 1);
}

// An exception on the first follower must not prevent the second follower from executing.
{
  const coordinator = new MasterFollowerCoordinator();
  const failing = scriptedPipeline(new Error("simulated crash"));
  const healthy = scriptedPipeline({ accepted: true, status: "CONFIRMED" });
  coordinator.joinFollower({ followerId: "F1", pipeline: failing });
  coordinator.joinFollower({ followerId: "F2", pipeline: healthy });

  const result = coordinator.publishSignal({
    masterSignalId: "ADV-CRASH-1",
    symbol: "ETHUSDT",
    side: "SELL",
    quantity: 2,
    price: 2000
  });

  assert.equal(result.followerResults[0].result.status, "EXECUTION_ERROR");
  assert.equal(result.followerResults[1].result.status, "CONFIRMED");
  assert.equal(healthy.calls.length, 1);
}

// A follower risk rejection is isolated and cannot cancel another follower's accepted order.
{
  const coordinator = new MasterFollowerCoordinator();
  const rejected = scriptedPipeline({
    accepted: false,
    status: "RISK_REJECTED",
    order: null
  });
  const accepted = scriptedPipeline({ accepted: true, status: "CONFIRMED" });
  coordinator.joinFollower({ followerId: "F1", pipeline: rejected });
  coordinator.joinFollower({ followerId: "F2", pipeline: accepted });

  const result = coordinator.publishSignal({
    masterSignalId: "ADV-RISK-1",
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 10,
    price: 100
  });

  assert.equal(result.followerResults[0].result.status, "RISK_REJECTED");
  assert.equal(result.followerResults[1].result.status, "CONFIRMED");
  assert.equal(accepted.calls.length, 1);
}

// Duplicate signal delivery is exactly-once even when the first delivery contains failures.
{
  const coordinator = new MasterFollowerCoordinator();
  const f1 = scriptedPipeline({ accepted: true, status: "NETWORK_UNKNOWN" });
  const f2 = scriptedPipeline({ accepted: true, status: "TIMEOUT" });
  coordinator.joinFollower({ followerId: "F1", pipeline: f1 });
  coordinator.joinFollower({ followerId: "F2", pipeline: f2 });

  const first = coordinator.publishSignal({
    masterSignalId: "ADV-DUP-1",
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 1,
    price: 100
  });
  const second = coordinator.publishSignal({
    masterSignalId: "ADV-DUP-1",
    symbol: "BTCUSDT",
    side: "SELL",
    quantity: 99,
    price: 99999
  });

  assert.deepEqual(second, first);
  assert.equal(f1.calls.length, 1);
  assert.equal(f2.calls.length, 1);
}

// copyOrderId remains deterministic and unique per master/follower pair.
{
  const coordinator = new MasterFollowerCoordinator();
  const calls = [];
  const f1 = scriptedPipeline((request) => ({ accepted: true, status: "CONFIRMED", echoed: request.clientOrderId }));
  const f2 = scriptedPipeline((request) => ({ accepted: true, status: "CONFIRMED", echoed: request.clientOrderId }));
  coordinator.joinFollower({ followerId: "F1", pipeline: f1 });
  coordinator.joinFollower({ followerId: "F2", pipeline: f2 });

  const result = coordinator.publishSignal({
    masterSignalId: "ADV-ID-1",
    symbol: "SOLUSDT",
    side: "SELL",
    quantity: 3,
    price: 150
  });

  calls.push(...result.followerResults.map((entry) => entry.copyOrderId));
  assert.deepEqual(calls, ["COPY-ADV-ID-1-F1", "COPY-ADV-ID-1-F2"]);
  assert.notEqual(calls[0], calls[1]);
  assert.equal(f1.calls[0].clientOrderId, calls[0]);
  assert.equal(f2.calls[0].clientOrderId, calls[1]);
}

// Promoted waitlisted followers are not allowed to receive signals until their pipeline is explicitly attached.
{
  const coordinator = new MasterFollowerCoordinator();
  const f1 = scriptedPipeline({ accepted: true, status: "CONFIRMED" });
  const f2 = scriptedPipeline({ accepted: true, status: "CONFIRMED" });
  const f3 = scriptedPipeline({ accepted: true, status: "CONFIRMED" });
  coordinator.joinFollower({ followerId: "F1", pipeline: f1 });
  coordinator.joinFollower({ followerId: "F2", pipeline: f2 });
  coordinator.joinFollower({ followerId: "F3", pipeline: f3 });

  coordinator.leaveFollower("F1");
  const beforeAttach = coordinator.publishSignal({
    masterSignalId: "ADV-PROMOTION-1",
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 1,
    price: 100
  });
  assert.deepEqual(beforeAttach.followerResults.map((x) => x.followerId), ["F2"]);
  assert.equal(f3.calls.length, 0);

  coordinator.attachPromotedFollower({ followerId: "F3", pipeline: f3 });
  const afterAttach = coordinator.publishSignal({
    masterSignalId: "ADV-PROMOTION-2",
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 1,
    price: 100
  });
  assert.deepEqual(afterAttach.followerResults.map((x) => x.followerId), ["F2", "F3"]);
  assert.equal(f3.calls.length, 1);
}

console.log("Master/Follower adversarial tests: all passed");
