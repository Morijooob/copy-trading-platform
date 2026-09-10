import assert from 'node:assert/strict';
import { MasterFollowerCapacity } from '../src/master-follower-capacity.js';

const manager = new MasterFollowerCapacity({ maxActive: 2 });
const masterId = 'master-1';
const followers = Array.from({ length: 12 }, (_, i) => `f-${i + 1}`);

const results = await Promise.all(followers.map((followerId) => Promise.resolve(manager.join({ masterId, followerId }))));
const snapshot = manager.snapshot(masterId);
assert.equal(snapshot.active.length, 2);
assert.equal(snapshot.queue.length, 10);
assert.deepEqual(snapshot.active, ['f-1', 'f-2']);
assert.deepEqual(snapshot.queue, followers.slice(2));
assert.equal(results.filter((x) => x.status === 'active').length, 2);
assert.equal(results.filter((x) => x.status === 'queued').length, 10);

const duplicateActive = manager.join({ masterId, followerId: 'f-1' });
const duplicateQueued = manager.join({ masterId, followerId: 'f-12' });
assert.deepEqual(duplicateActive, { status: 'active', position: null, duplicate: true });
assert.deepEqual(duplicateQueued, { status: 'queued', position: 10, duplicate: true });

const firstLeave = manager.leave({ masterId, followerId: 'f-1' });
assert.equal(firstLeave.promoted, 'f-3');
assert.equal(firstLeave.snapshot.active.length, 2);
assert.deepEqual(firstLeave.snapshot.active, ['f-2', 'f-3']);
assert.deepEqual(firstLeave.snapshot.queue, followers.slice(3));

const secondLeave = manager.leave({ masterId, followerId: 'f-2' });
assert.equal(secondLeave.promoted, 'f-4');
assert.deepEqual(secondLeave.snapshot.active, ['f-3', 'f-4']);

const removedQueued = manager.leave({ masterId, followerId: 'f-8' });
assert.equal(removedQueued.removed, true);
assert.equal(manager.snapshot(masterId).queue.includes('f-8'), false);

for (const followerId of manager.snapshot(masterId).active) manager.join({ masterId, followerId });
assert.equal(manager.snapshot(masterId).active.length, 2);
console.log('Master follower capacity: 12-follower race/queue stress PASSED');
