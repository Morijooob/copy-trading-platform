import assert from "node:assert/strict";
import { MasterFollowerCoordinator } from "../src/master-follower-coordinator.js";

const TOTAL = 200;
const calls = { F1: [], F2: [] };
const accepted = { F1: new Set(), F2: new Set() };

function makePipeline(followerId, epoch) {
  return {
    submit(input) {
      calls[followerId].push({ epoch, input: structuredClone(input) });

      // F2 intermittently reaches the execution boundary, records the side effect,
      // and then throws. This simulates "accepted by exchange, timeout to caller".
      if (followerId === "F2" && Number(input.clientOrderId.slice(-3)) % 5 === 0) {
        if (accepted[followerId].has(input.clientOrderId)) {
          throw new Error(`duplicate side effect after restart: ${input.clientOrderId}`);
        }
        accepted[followerId].add(input.clientOrderId);
        throw new Error(`timeout after acceptance: ${input.clientOrderId}`);
      }

      if (accepted[followerId].has(input.clientOrderId)) {
        throw new Error(`duplicate side effect: ${input.clientOrderId}`);
      }
      accepted[followerId].add(input.clientOrderId);
      return {
        accepted: true,
        status: "ORDER_ACCEPTED",
        exchangeOrderId: `EX-${epoch}-${input.clientOrderId}`
      };
    }
  };
}

function publish(coordinator, i) {
  return coordinator.publishSignal({
    masterSignalId: `FAIL-RS-${String(i).padStart(3, "0")}`,
    symbol: "BTCUSDT",
    side: i % 2 ? "SELL" : "BUY",
    quantity: 0.01 + (i % 7) / 1000,
    price: 100000 + i,
    timeoutMs: 250
  });
}

const coordinator = new MasterFollowerCoordinator();
coordinator.joinFollower({ followerId: "F1", pipeline: makePipeline("F1", 1) });
coordinator.joinFollower({ followerId: "F2", pipeline: makePipeline("F2", 1) });

const firstWave = Array.from({ length: TOTAL }, (_, i) => publish(coordinator, i));
assert.equal(firstWave.length, TOTAL);
assert.equal(coordinator.exportState().signals.length, TOTAL);
assert.equal(calls.F1.length, TOTAL);
assert.equal(calls.F2.length, TOTAL);
assert.equal(firstWave.filter((x) => x.followerResults.some((r) => r.result.status === "EXECUTION_ERROR")).length, 40);

const snapshot = coordinator.exportState();
const callsBeforeRestart = {
  F1: calls.F1.length,
  F2: calls.F2.length
};

const recovered = new MasterFollowerCoordinator();
recovered.restoreState(snapshot, {
  F1: makePipeline("F1", 2),
  F2: makePipeline("F2", 2)
});

// Replay storm after restart: every old signal is replayed with contradictory payload.
// Persisted master intent must win, and no follower side effect may run again.
const replayed = Array.from({ length: TOTAL }, (_, i) =>
  recovered.publishSignal({
    masterSignalId: `FAIL-RS-${String(i).padStart(3, "0")}`,
    symbol: "ETHUSDT",
    side: "BUY",
    quantity: 9,
    price: 1,
    timeoutMs: 1
  })
);

for (let i = 0; i < TOTAL; i += 1) {
  assert.deepEqual(replayed[i], firstWave[i]);
}
assert.equal(calls.F1.length, callsBeforeRestart.F1);
assert.equal(calls.F2.length, callsBeforeRestart.F2);
assert.equal(accepted.F1.size, TOTAL);
assert.equal(accepted.F2.size, TOTAL);

const audit = recovered.getAuditLog();
assert.equal(audit.filter((x) => x.type === "MASTER_SIGNAL_PROCESSED").length, TOTAL);
assert.equal(audit.filter((x) => x.type === "FOLLOWER_SIGNAL_RESULT").length, TOTAL * 2);
assert.equal(audit.filter((x) => x.type === "FOLLOWER_SIGNAL_RESULT" && x.payload.status === "EXECUTION_ERROR").length, 40);

// Persist/recover again and verify a second replay storm remains side-effect free.
const secondSnapshot = recovered.exportState();
const recoveredAgain = new MasterFollowerCoordinator();
recoveredAgain.restoreState(secondSnapshot, {
  F1: makePipeline("F1", 3),
  F2: makePipeline("F2", 3)
});

for (let i = 0; i < TOTAL; i += 1) {
  const replay = recoveredAgain.publishSignal({
    masterSignalId: `FAIL-RS-${String(i).padStart(3, "0")}`,
    symbol: "SOLUSDT",
    side: "SELL",
    quantity: 99,
    price: 2,
    timeoutMs: 1
  });
  assert.deepEqual(replay, firstWave[i]);
}

assert.equal(calls.F1.length, callsBeforeRestart.F1);
assert.equal(calls.F2.length, callsBeforeRestart.F2);
console.log("FAIL-RS: 200 signals + 40 post-acceptance failures + 2 restarts + replay storms; 0 duplicate side effects; 0 lost signals");
console.log("master-follower failure/restart torture tests: all passed");
