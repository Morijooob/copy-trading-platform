import assert from 'node:assert/strict';
import { WalletLedger } from '../src/real/wallet-ledger.js';
import { WithdrawalService } from '../src/real/withdrawal-service.js';

class WithdrawalStateStore {
  constructor() { this.state = null; }
  save(state) { this.state = structuredClone(state); }
  load() { return this.state ? structuredClone(this.state) : null; }
}

const wallet = new WalletLedger();
wallet.credit('user-A', 'USDT', 1000, 'seed');

const provider = { send: ({ id }) => ({ reference: `provider-${id}` }) };
const service = new WithdrawalService({ wallet, enabled: true, provider, maxAmount: 500 });

assert.throws(() => service.request({ userId: 'user-A', amount: 10, destination: 'wallet-1' }), /idempotency key required/);
assert.throws(() => service.request({ userId: 'user-A', amount: 0, destination: 'wallet-1', idempotencyKey: 'k0' }), /amount must be positive/);
assert.throws(() => service.request({ userId: 'user-A', amount: 501, destination: 'wallet-1', idempotencyKey: 'k1' }), /maximum/);

const first = service.request({ userId: 'user-A', amount: 400, destination: 'wallet-1', idempotencyKey: 'same-key' });
assert.equal(first.status, 'PENDING');
assert.equal(service.availableBalance('user-A'), 600);

const duplicate = service.request({ userId: 'user-A', amount: 400, destination: 'wallet-1', idempotencyKey: 'same-key' });
assert.equal(duplicate.duplicate, true);
assert.equal(duplicate.id, first.id);
assert.equal(service.availableBalance('user-A'), 600);

assert.throws(() => service.request({ userId: 'user-A', amount: 601, destination: 'wallet-2', idempotencyKey: 'too-much' }), /insufficient available balance/);

const completed = service.process(first.id);
assert.equal(completed.status, 'COMPLETED');
assert.equal(completed.providerReference, `provider-${first.id}`);
assert.equal(wallet.balance('user-A'), 600);
assert.equal(service.availableBalance('user-A'), 600);
assert.equal(service.snapshot().audit.at(-1).event, 'completed');

const second = service.request({ userId: 'user-A', amount: 100, destination: 'wallet-2', idempotencyKey: 'cancel-me' });
assert.equal(service.cancel(second.id).status, 'CANCELLED');
assert.equal(service.availableBalance('user-A'), 600);
assert.equal(wallet.balance('user-A'), 600);

let sends = 0;
const ambiguousProvider = { send: () => { sends += 1; throw new Error('provider timeout'); } };
const failing = new WithdrawalService({ wallet, enabled: true, provider: ambiguousProvider });
const ambiguousRequest = failing.request({ userId: 'user-A', amount: 50, destination: 'wallet-3', idempotencyKey: 'ambiguous-once' });
const ambiguous = failing.process(ambiguousRequest.id);
assert.equal(sends, 1);
assert.equal(ambiguous.status, 'RECONCILIATION_REQUIRED');
assert.equal(ambiguous.failureReason, 'provider timeout');
assert.equal(failing.availableBalance('user-A'), 550);
assert.equal(wallet.balance('user-A'), 600);
assert.throws(() => failing.process(ambiguousRequest.id), /invalid transition/);

const reconciledFailed = failing.reconcile(ambiguousRequest.id, { outcome: 'FAILED' });
assert.equal(reconciledFailed.status, 'FAILED');
assert.equal(failing.availableBalance('user-A'), 600);
assert.equal(wallet.balance('user-A'), 600);

const store = new WithdrawalStateStore();
const restartProvider = { send: ({ id }) => ({ reference: `restart-provider-${id}` }) };
const beforeRestart = new WithdrawalService({ wallet, enabled: true, provider: restartProvider, stateStore: store });
const persisted = beforeRestart.request({ userId: 'user-A', amount: 75, destination: 'wallet-restart', idempotencyKey: 'restart-safe' });
assert.equal(beforeRestart.availableBalance('user-A'), 525);

const afterRestart = new WithdrawalService({ wallet, enabled: true, provider: restartProvider, stateStore: store });
assert.equal(afterRestart.get(persisted.id).status, 'PENDING');
assert.equal(afterRestart.availableBalance('user-A'), 525);
const duplicateAfterRestart = afterRestart.request({ userId: 'user-A', amount: 75, destination: 'wallet-restart', idempotencyKey: 'restart-safe' });
assert.equal(duplicateAfterRestart.duplicate, true);
assert.equal(duplicateAfterRestart.id, persisted.id);
assert.equal(afterRestart.process(persisted.id).status, 'COMPLETED');
assert.equal(wallet.balance('user-A'), 525);
assert.equal(afterRestart.availableBalance('user-A'), 525);

const ambiguousStore = new WithdrawalStateStore();
const ambiguousBeforeRestart = new WithdrawalService({ wallet, enabled: true, provider: ambiguousProvider, stateStore: ambiguousStore });
const pendingUnknown = ambiguousBeforeRestart.request({ userId: 'user-A', amount: 25, destination: 'wallet-unknown', idempotencyKey: 'unknown-restart' });
assert.equal(ambiguousBeforeRestart.process(pendingUnknown.id).status, 'RECONCILIATION_REQUIRED');
assert.equal(ambiguousBeforeRestart.availableBalance('user-A'), 500);
const ambiguousAfterRestart = new WithdrawalService({ wallet, enabled: true, provider: ambiguousProvider, stateStore: ambiguousStore });
assert.equal(ambiguousAfterRestart.get(pendingUnknown.id).status, 'RECONCILIATION_REQUIRED');
assert.equal(ambiguousAfterRestart.availableBalance('user-A'), 500);
const completedAfterReconcile = ambiguousAfterRestart.reconcile(pendingUnknown.id, { outcome: 'COMPLETED', providerReference: 'provider-confirmed-after-restart' });
assert.equal(completedAfterReconcile.status, 'COMPLETED');
assert.equal(wallet.balance('user-A'), 500);
assert.equal(ambiguousAfterRestart.availableBalance('user-A'), 500);

const disabled = new WithdrawalService({ wallet, enabled: false, provider });
assert.throws(() => disabled.request({ userId: 'user-A', amount: 10, destination: 'wallet-4', idempotencyKey: 'disabled' }), /withdrawals disabled/);

const raceA = service.request({ userId: 'user-A', amount: 300, destination: 'wallet-A', idempotencyKey: 'race-a' });
assert.throws(() => service.request({ userId: 'user-A', amount: 301, destination: 'wallet-B', idempotencyKey: 'race-b' }), /insufficient available balance/);
service.cancel(raceA.id);
assert.equal(service.availableBalance('user-A'), 600);

console.log('Withdrawal service tests passed.');
