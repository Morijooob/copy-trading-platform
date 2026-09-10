import assert from 'node:assert/strict';
import { SafeExecutionSimulator } from '../src/real/safe-execution-simulator.js';

const audit = [];
const simulator = new SafeExecutionSimulator({ audit: (entry) => audit.push(entry) });
const order = { symbol: 'BTC/USDT', side: 'buy', quantity: 0.01, price: 50000 };

const crash = await simulator.run({ idempotencyKey: 'fault-crash', followerId: 'f1', masterId: 'm1', order, scenario: 'crash' });
assert.equal(crash.simulated, true);
assert.equal(crash.externalOrderPlaced, false);
assert.equal(crash.intent.status, 'unknown_after_crash');
assert.equal(simulator.recover('fault-crash').intent.status, 'recovery_required');

const timeout = await simulator.run({ idempotencyKey: 'fault-timeout', followerId: 'f1', masterId: 'm1', order, scenario: 'timeout' });
assert.equal(timeout.intent.status, 'timeout');
assert.equal(timeout.externalOrderPlaced, false);
assert.equal(simulator.recover('fault-timeout').intent.status, 'recovery_required');

const partial = await simulator.run({ idempotencyKey: 'fault-partial', followerId: 'f1', masterId: 'm1', order, scenario: 'partial_fill' });
assert.equal(partial.intent.status, 'partial');
assert.equal(partial.externalOrderPlaced, false);
assert.equal(partial.intent.filledQuantity, 0.005);
assert.equal(partial.intent.remainingQuantity, 0.005);
assert.equal(simulator.recover('fault-partial').intent.status, 'partial_recovery_required');

const recovered = await simulator.run({ idempotencyKey: 'fault-recovery', followerId: 'f1', masterId: 'm1', order, scenario: 'recovery' });
assert.equal(recovered.intent.status, 'filled');
assert.equal(recovered.intent.remainingQuantity, 0);
assert.equal(recovered.externalOrderPlaced, false);

const duplicate = await simulator.run({ idempotencyKey: 'fault-recovery', followerId: 'f1', masterId: 'm1', order, scenario: 'recovery' });
assert.equal(duplicate.duplicate, true);
assert.ok(audit.some((entry) => entry.type === 'SIM_CRASH'));
assert.ok(audit.some((entry) => entry.type === 'SIM_TIMEOUT'));
assert.ok(audit.some((entry) => entry.type === 'SIM_PARTIAL_FILL'));
assert.ok(audit.some((entry) => entry.type === 'SIM_RECOVERY_COMPLETE'));

console.log('safe execution fault simulator tests: ok');
