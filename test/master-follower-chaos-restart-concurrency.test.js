import assert from "node:assert/strict";
import { MasterFollowerCoordinator } from "../src/master-follower-coordinator.js";

function pipeline(calls, followerId, restartEpoch) {
  return {
    submit(request) {
      calls.push({ followerId, restartEpoch, request: structuredClone(request) });
      return {
        accepted: true,
        status: "CONFIRMED",
        order: { clientOrderId: request.clientOrderId }
      };
    }
  };
}

const TOTAL = 200;
const followerIds = ["F1", "F2"];
const callsBeforeRestart = [];
const original = new MasterFollowerCoordinator();

for (const followerId of followerIds) {
  original.joinFollower({
    followerId,
    pipeline: pipeline(callsBeforeRestart, followerId, 0)
  });
}

// Phase 1: 100 concurrent intents, each delivered twice with conflicting replay data.
const phase1 = Array.from({ length: 100 }, (_, i) => `CHAOS-RC-${String(i).padStart(3, "0")}`);
const phase1Ops = phase1.flatMap((masterSignalId, i) => [
  Promise.resolve().then(() => original.publishSignal({
    masterSignalId,
    symbol: "BTCUSDT",
    side: i % 2 === 0 ? "BUY" : "SELL",
    quantity: i + 1,
    price: 100 + i
  })),
  Promise.resolve().then(() => original.publishSignal({
    masterSignalId,
    symbol: "ETHUSDT",
    side: i % 2 === 0 ? "SELL" : "BUY",
    quantity: 999,
    price: 999999
  }))
]);
const phase1Results = await Promise.all(phase1Ops);

for (let i = 0; i < phase1.length; i += 1) {
  assert.deepEqual(phase1Results[i * 2 + 1], phase1Results[i * 2]);
}
assert.equal(original.exportState().signals.length, 100);
assert.equal(callsBeforeRestart.length, 200);

// Chaos point: snapshot and restore into a fresh coordinator while the completed ledger is hot.
const persisted = original.exportState();
const callsAfterRestart = [];
const restarted = new MasterFollowerCoordinator();
restarted.restoreState(persisted, {
  F1: pipeline(callsAfterRestart, "F1", 1),
  F2: pipeline(callsAfterRestart, "F2", 1)
});

// Phase 2: another 100 concurrent intents, plus replay storms for the first 100 after restart.
const phase2 = Array.from({ length: 100 }, (_, i) => `CHAOS-RC-${String(i + 100).padStart(3, "0")}`);
const phase2Ops = [
  ...phase2.map((masterSignalId, i) => Promise.resolve().then(() => restarted.publishSignal({
    masterSignalId,
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: i + 1,
    price: 200 + i
  }))),
  ...phase1.flatMap((masterSignalId) => [
    Promise.resolve().then(() => restarted.publishSignal({
      masterSignalId,
      symbol: "SOLUSDT",
      side: "SELL",
      quantity: 777,
      price: 777777
    })),
    Promise.resolve().then(() => restarted.publishSignal({
      masterSignalId,
      symbol: "XRPUSDT",
      side: "SELL",
      quantity: 888,
      price: 888888
    }))
  ])
];
const phase2Results = await Promise.all(phase2Ops);

assert.equal(restarted.exportState().signals.length, TOTAL);
assert.equal(callsAfterRestart.length, 200);

for (const replay of phase2Results.slice(100)) {
  assert.equal(replay.status, "PROCESSED");
  assert.equal(replay.followerResults.length, 2);
}

const allState = restarted.exportState();
const acceptedByFollower = new Map(followerIds.map((id) => [id, 0]));
for (const call of [...callsBeforeRestart, ...callsAfterRestart]) {
  acceptedByFollower.set(call.followerId, acceptedByFollower.get(call.followerId) + 1);
}
for (const followerId of followerIds) {
  assert.equal(acceptedByFollower.get(followerId), TOTAL, `${followerId} execution count mismatch`);
}

assert.equal(
  allState.audit.filter((entry) => entry.type === "MASTER_SIGNAL_PROCESSED").length,
  TOTAL
);
assert.equal(
  allState.audit.filter((entry) => entry.type === "FOLLOWER_SIGNAL_RESULT").length,
  TOTAL * followerIds.length
);

// Final persistence round-trip: replaying any completed intent must still be side-effect free.
const finalCalls = [];
const final = new MasterFollowerCoordinator();
final.restoreState(allState, {
  F1: pipeline(finalCalls, "F1", 2),
  F2: pipeline(finalCalls, "F2", 2)
});
const finalReplay = await Promise.all(
  phase1.slice(0, 10).map((masterSignalId) => Promise.resolve().then(() => final.publishSignal({
    masterSignalId,
    symbol: "DOGEUSDT",
    side: "SELL",
    quantity: 12345,
    price: 123456
  })))
);
assert.equal(finalCalls.length, 0);
assert.equal(finalReplay.length, 10);

console.log(`CHAOS-RC: ${TOTAL} intents across restart + concurrent replay storms; 0 duplicates; 0 lost signals`);
console.log("master-follower chaos restart concurrency tests: all passed");
