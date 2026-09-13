import assert from 'node:assert/strict';
import { MasterFollowerCapacity } from '../src/master-follower-capacity.js';

assert.throws(() => new MasterFollowerCapacity({ maxActive: 3 }), /invalid maxActive/);
assert.throws(() => new MasterFollowerCapacity({ maxActive: 8 }), /invalid maxActive/);

for (const load of [2, 8, 32]) {
  const manager = new MasterFollowerCapacity({ maxActive: 2 });
  const masterId = `gate13-${load}`;
  const followers = Array.from({ length: load }, (_, i) => `f-${i + 1}`);
  const results = await Promise.all(
    followers.map((followerId) => Promise.resolve(manager.join({ masterId, followerId }))),
  );

  const snapshot = manager.snapshot(masterId);
  assert.equal(snapshot.maxActive, 2);
  assert.equal(snapshot.active.length, Math.min(2, load));
  assert.equal(snapshot.queue.length, Math.max(0, load - 2));
  assert.deepEqual(snapshot.active, followers.slice(0, 2));
  assert.deepEqual(snapshot.queue, followers.slice(2));
  assert.equal(results.filter((x) => x.status === 'active').length, Math.min(2, load));
  assert.equal(results.filter((x) => x.status === 'queued').length, Math.max(0, load - 2));

  const duplicateQueued = manager.join({ masterId, followerId: followers[followers.length - 1] });
  assert.equal(duplicateQueued.duplicate, true);
  if (load > 2) assert.equal(duplicateQueued.position, load - 2);

  if (load > 2) {
    const first = manager.leave({ masterId, followerId: 'f-1' });
    assert.equal(first.promoted, 'f-3');
    assert.equal(first.snapshot.active.length, 2);
    assert.equal(first.snapshot.queue[0], 'f-4');

    const second = manager.leave({ masterId, followerId: 'f-2' });
    assert.equal(second.promoted, 'f-4');
    assert.equal(second.snapshot.active.length, 2);
    assert.equal(second.snapshot.active.includes('f-3'), true);
    assert.equal(second.snapshot.active.includes('f-4'), true);
  }
}

console.log('Gate 13 capacity/queue torture: hard 2-follower cap, FIFO promotion, duplicate safety and 2/8/32-load checks PASSED');
