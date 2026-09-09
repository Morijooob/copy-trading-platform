import assert from "node:assert/strict";
import { FollowerCapacityQueue } from "../src/follower-capacity-queue.js";

{
  const queue = new FollowerCapacityQueue({ capacity: 2 });
  assert.equal(queue.join("follower-1").status, "ACTIVE");
  assert.equal(queue.join("follower-2").status, "ACTIVE");
  const third = queue.join("follower-3");
  assert.equal(third.status, "WAITLISTED");
  assert.equal(third.queueId, "QUEUE-1");
  assert.equal(third.position, undefined);
  assert.equal(queue.snapshot().active.length, 2);
  assert.equal(queue.getStatus("follower-3").position, 1);
}

{
  const queue = new FollowerCapacityQueue({ capacity: 2 });
  queue.join("follower-1");
  queue.join("follower-2");
  queue.join("follower-3");
  queue.join("follower-4");

  const released = queue.leave("follower-1");
  assert.equal(released.status, "RELEASED");
  assert.equal(released.promoted.userId, "follower-3");
  assert.equal(released.promoted.status, "ACTIVE");
  assert.equal(released.promoted.slot, 1);
  assert.equal(queue.getStatus("follower-2").slot, 2);
  assert.equal(queue.getStatus("follower-4").position, 1);
  assert.equal(queue.snapshot().active.length, 2);
  assert.equal(queue.snapshot().waiting.length, 1);
  assert.deepEqual(
    queue.snapshot().active.map((entry) => entry.slot).sort((a, b) => a - b),
    [1, 2]
  );
}

{
  const queue = new FollowerCapacityQueue({ capacity: 2 });
  queue.join("follower-1");
  queue.join("follower-2");
  queue.join("follower-3");
  const firstSnapshot = queue.snapshot();
  firstSnapshot.active[1].slot = firstSnapshot.active[0].slot;
  assert.throws(() => queue.restore(firstSnapshot), /duplicate follower or slot/);
}

{
  const queue = new FollowerCapacityQueue({ capacity: 2 });
  const first = queue.join("follower-1");
  const duplicateActive = queue.join("follower-1");
  assert.deepEqual(duplicateActive, first);

  queue.join("follower-2");
  const waiting = queue.join("follower-3");
  const duplicateWaiting = queue.join("follower-3");
  assert.deepEqual(duplicateWaiting, waiting);
  assert.equal(queue.snapshot().waiting.length, 1);
}

{
  const queue = new FollowerCapacityQueue({ capacity: 2 });
  queue.join("follower-1");
  queue.join("follower-2");
  queue.join("follower-3");
  const before = queue.snapshot();
  before.active[0].userId = "tampered";
  before.waiting[0].position = 999;
  assert.equal(queue.getStatus("follower-1").userId, "follower-1");
  assert.equal(queue.getStatus("follower-3").position, 1);
}

{
  assert.throws(() => new FollowerCapacityQueue({ capacity: 0 }), /invalid follower capacity/);
  assert.throws(() => new FollowerCapacityQueue({ capacity: 1.5 }), /invalid follower capacity/);
  const queue = new FollowerCapacityQueue();
  assert.throws(() => queue.join(""), /invalid user id/);
  assert.throws(() => queue.leave(""), /invalid user id/);
}

console.log("follower-capacity-queue tests: ok");
