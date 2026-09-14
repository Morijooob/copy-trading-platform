import assert from 'node:assert/strict';
import { WalletLedger } from '../src/real/wallet-ledger.js';
import { WithdrawalService } from '../src/real/withdrawal-service.js';

const wallet = new WalletLedger();
wallet.credit('user-A', 'USDT', 1000, 'seed');

let sends = 0;
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

const failingProvider = { send: () => { sends += 1; throw new Error('provider timeout'); } };
const failing = new WithdrawalService({ wallet, enabled: true, provider: failingProvider });
const failedRequest = failing.request({ userId: 'user-A', amount: 50, destination: 'wallet-3', idempotencyKey: 'fail-once' });
const failed = failing.process(failedRequest.id);
assert.equal(sends, 1);
assert.equal(failed.status, 'FAILED');
assert.equal(failed.failureReason, 'provider timeout');
assert.equal(failing.availableBalance('user-A'), 600);
assert.equal(wallet.balance('user-A'), 600);

const disabled = new WithdrawalService({ wallet, enabled: false, provider });
assert.throws(() => disabled.request({ userId: 'user-A', amount: 10, destination: 'wallet-4', idempotencyKey: 'disabled' }), /withdrawals disabled/);

const raceA = service.request({ userId: 'user-A', amount: 300, destination: 'wallet-A', idempotencyKey: 'race-a' });
assert.throws(() => service.request({ userId: 'user-A', amount: 301, destination: 'wallet-B', idempotencyKey: 'race-b' }), /insufficient available balance/);
service.cancel(raceA.id);
assert.equal(service.availableBalance('user-A'), 600);

console.log('Withdrawal service tests passed.');
