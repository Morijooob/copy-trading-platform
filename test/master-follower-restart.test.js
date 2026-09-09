import assert from "node:assert/strict";
import { MasterFollowerCoordinator } from "../src/master-follower-coordinator.js";

function pipeline(calls) {
  return {
    submit(request) {
      calls.push(structuredClone(request));
      return { accepted: true, status: "CONFIRMED", order: { clientOrderId: request.clientOrderId } };
    }
  };
}

// A persisted coordinator restores its two active followers and the completed signal ledger.
// Re-delivery after restart must return the persisted result without submitting again.
{
  const calls1 = [];
  const original = new MasterFollowerCoordinator();
  original.joinFollower({ followerId: "F1", pipeline: pipeline(calls1) });
  original.joinFollower({ followerId: "F2", pipeline: pipeline(calls1) });

  const first = original.publishSignal({
    masterSignalId: "RESTART-1",
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 1,
    price: 100
  });
  assert.equal(calls1.length, 2);

  const persisted = original.exportState();

  const calls2 = [];
  const restored = new MasterFollowerCoordinator();
  restored.restoreState(persisted, {
    F1: pipeline(calls2),
    F2: pipeline(calls2)
  });

  assert.deepEqual(restored.getFollowerStatus("F1"), { userId: "F1", status: "ACTIVE", slot: 1 });
  assert.deepEqual(restored.getFollowerStatus("F2"), { userId: "F2", status: "ACTIVE", slot: 2 });

  const replay = restored.publishSignal({
    masterSignalId: "RESTART-1",
    symbol: "ETHUSDT",
    side: "SELL",
    quantity: 99,
    price: 99999
  });

  assert.deepEqual(replay, first);
  assert.equal(calls2.length, 0);
}

// Waitlist order and queue IDs survive restart; the third follower remains queued until a slot opens.
{
  const original = new MasterFollowerCoordinator();
  const noop = () => ({ accepted: true, status: "CONFIRMED" });
  original.joinFollower({ followerId: "F1", pipeline: { submit: noop } });
  original.joinFollower({ followerId: "F2", pipeline: { submit: noop } });
  const queued = original.joinFollower({ followerId: "F3", pipeline: { submit: noop } });
  assert.equal(queued.position, 1);

  const restored = new MasterFollowerCoordinator();
  restored.restoreState(original.exportState(), {
    F1: { submit: noop },
    F2: { submit: noop }
  });

  assert.deepEqual(restored.getFollowerStatus("F3"), {
    userId: "F3",
    status: "WAITLISTED",
    queueId: queued.queueId,
    position: 1
  });
}

// Invalid or incomplete restart state must fail closed rather than silently creating an unsafe state.
{
  const coordinator = new MasterFollowerCoordinator();
  assert.throws(() => coordinator.restoreState({ version: 999, queue: {}, signals: [], audit: [] }), /unsupported coordinator state version/);
  assert.throws(() => coordinator.restoreState({ version: 1, queue: FollowerQueueShape(), signals: [], audit: [] }), /missing pipeline for active follower/);
}

function FollowerQueueShape() {
  return { capacity: 2, nextQueueId: 1, active: [{ userId: "F1", status: "ACTIVE", slot: 1 }], waiting: [] };
}

console.log("Master/Follower restart tests: all passed");
