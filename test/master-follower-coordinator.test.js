import assert from "node:assert/strict";
import { MasterFollowerCoordinator } from "../src/master-follower-coordinator.js";

function pipeline(status = "CONFIRMED", calls = []) {
  return {
    calls,
    submit(request) {
      calls.push(structuredClone(request));
      return { accepted: true, status };
    }
  };
}

// Exactly two followers are active; the third and fourth wait in FIFO order.
{
  const coordinator = new MasterFollowerCoordinator();
  const first = pipeline();
  const second = pipeline();
  const third = pipeline();
  const fourth = pipeline();

  assert.equal(coordinator.joinFollower({ followerId: "F1", pipeline: first }).status, "ACTIVE");
  assert.equal(coordinator.joinFollower({ followerId: "F2", pipeline: second }).status, "ACTIVE");
  assert.equal(coordinator.joinFollower({ followerId: "F3", pipeline: third }).status, "WAITLISTED");
  assert.equal(coordinator.joinFollower({ followerId: "F4", pipeline: fourth }).position, 2);
  assert.equal(coordinator.getFollowerStatus("F3").position, 1);

  const left = coordinator.leaveFollower("F1");
  assert.equal(left.promoted.userId, "F3");
  assert.equal(coordinator.getFollowerStatus("F3").status, "ACTIVE");
  assert.equal(coordinator.attachPromotedFollower({ followerId: "F3", pipeline: third }).slot, 2);
}

// A duplicate join is idempotent and does not replace an active pipeline.
{
  const coordinator = new MasterFollowerCoordinator();
  const original = pipeline();
  const replacement = pipeline();
  coordinator.joinFollower({ followerId: "F1", pipeline: original });
  const result = coordinator.joinFollower({ followerId: "F1", pipeline: replacement });
  assert.equal(result.status, "ACTIVE");
  coordinator.publishSignal({ masterSignalId: "M1", symbol: "BTCUSDT", side: "BUY", quantity: 1, price: 100 });
  assert.equal(original.calls.length, 1);
  assert.equal(replacement.calls.length, 0);
}

// Master signal fans out deterministically and creates unique copyOrderIds.
{
  const coordinator = new MasterFollowerCoordinator();
  const f1 = pipeline();
  const f2 = pipeline();
  coordinator.joinFollower({ followerId: "F1", pipeline: f1 });
  coordinator.joinFollower({ followerId: "F2", pipeline: f2 });

  const result = coordinator.publishSignal({ masterSignalId: "MASTER-1", symbol: "ETHUSDT", side: "SELL", quantity: 2, price: 2000 });
  assert.deepEqual(result.followerResults.map((x) => x.copyOrderId), ["COPY-MASTER-1-F1", "COPY-MASTER-1-F2"]);
  assert.equal(f1.calls[0].clientOrderId, "COPY-MASTER-1-F1");
  assert.equal(f2.calls[0].clientOrderId, "COPY-MASTER-1-F2");
}

// A failure on one follower does not roll back or block the other follower.
{
  const coordinator = new MasterFollowerCoordinator();
  const good = pipeline();
  const bad = { calls: [], submit() { throw new Error("simulated follower failure"); } };
  coordinator.joinFollower({ followerId: "F1", pipeline: good });
  coordinator.joinFollower({ followerId: "F2", pipeline: bad });

  const result = coordinator.publishSignal({ masterSignalId: "MASTER-2", symbol: "BTCUSDT", side: "BUY", quantity: 1, price: 100 });
  assert.equal(result.followerResults[0].result.status, "CONFIRMED");
  assert.equal(result.followerResults[1].result.status, "EXECUTION_ERROR");
  assert.equal(good.calls.length, 1);
}

// Duplicate master signal is exactly-once at coordinator level.
{
  const coordinator = new MasterFollowerCoordinator();
  const f1 = pipeline();
  const f2 = pipeline();
  coordinator.joinFollower({ followerId: "F1", pipeline: f1 });
  coordinator.joinFollower({ followerId: "F2", pipeline: f2 });

  const first = coordinator.publishSignal({ masterSignalId: "MASTER-3", symbol: "BTCUSDT", side: "BUY", quantity: 1, price: 100 });
  const second = coordinator.publishSignal({ masterSignalId: "MASTER-3", symbol: "BTCUSDT", side: "SELL", quantity: 9, price: 999 });
  assert.deepEqual(second, first);
  assert.equal(f1.calls.length, 1);
  assert.equal(f2.calls.length, 1);
}

// Demo capacity cannot be silently changed above two.
{
  assert.throws(() => new MasterFollowerCoordinator({ queue: { capacity: 3 } }), /invalid follower capacity queue|demo follower capacity must be 2/);
}

console.log("Master/Follower Coordinator tests: all passed");
