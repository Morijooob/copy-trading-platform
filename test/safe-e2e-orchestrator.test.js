import assert from 'node:assert/strict';
import { SafeE2EOrchestrator } from '../src/real/safe-e2e-orchestrator.js';
import { OperationalSafety } from '../src/real/operational-safety.js';

let orderCalls = 0;
const audit = [];
const safety = new OperationalSafety({ maxOrderNotional: 1000, maxDailyLoss: 200, maxExposure: 1500 });
safety.heartbeat();
const orchestrator = new SafeE2EOrchestrator({
  safety,
  exchange: { order: async () => { orderCalls += 1; return { id: 'MUST_NOT_EXIST' }; } },
  audit: (entry) => audit.push(entry)
});

const order = { symbol: 'BTC/USDT', side: 'buy', quantity: 0.01, price: 50000 };
const first = await orchestrator.execute({
  idempotencyKey: 'e2e-001', followerId: 'f1', masterId: 'm1', order
});
assert.equal(first.dryRun, true);
assert.equal(first.executed, false);
assert.equal(first.intent.status, 'dry_run_approved');
assert.equal(orderCalls, 0);

const duplicate = await orchestrator.execute({
  idempotencyKey: 'e2e-001', followerId: 'f1', masterId: 'm1', order
});
assert.equal(duplicate.duplicate, true);
assert.equal(orderCalls, 0);

safety.setKillSwitch(true, 'E2E test');
const blocked = await orchestrator.execute({
  idempotencyKey: 'e2e-002', followerId: 'f1', masterId: 'm1', order
});
assert.equal(blocked.dryRun, true);
assert.equal(blocked.executed, false);
assert.equal(blocked.intent.status, 'blocked');
assert.deepEqual(blocked.intent.reason, ['KILL_SWITCH']);
assert.equal(orderCalls, 0);

const recovered = await orchestrator.recover('e2e-001');
assert.equal(recovered.recovered, true);
assert.ok(audit.some((entry) => entry.type === 'EXECUTION_INTENT_CREATED'));
assert.ok(audit.some((entry) => entry.type === 'DRY_RUN_APPROVED'));
assert.ok(audit.some((entry) => entry.type === 'EXECUTION_BLOCKED'));

console.log('safe E2E orchestrator tests: ok');
